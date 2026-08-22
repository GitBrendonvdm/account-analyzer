import {
  AVG_RECENCY_DECAY,
  CASH_EXTEND_DAYS,
  CASH_HISTORY_CYCLES,
  CASH_SMOOTH_DAYS,
  INCOME_BAND_TOLERANCE,
  LATE_SALARY_MIN_RISK,
} from '../constants';
import { parseTransactionDate } from '../utils/date';
import { accountIdOf } from './accounts';
import { cycleDay } from './cycleCurve';
import { isSalaryLikeIncome } from './effectivePayMonth';
import { completeMonths } from './flows';
import { accountRows, balanceAt } from './ledger';
// Written by scripts/backtest-cash.mjs: how this path has scored on past cycles (aggregates only).
import backtest from './cashBacktest.json';

/**
 * Cash, day by day, until the next salary — and the week after it.
 *
 * The question is "will I make it to the 23rd", and the old answer (a net figure for the cycle)
 * could not say WHEN the money runs out, which is the only thing that decides whether a debit
 * order bounces. So this walks every liquid account one calendar day at a time from the last day
 * the data covers to a week past payday, adding what is known and what is usual:
 *
 *   scheduled       the bills calendar's items on that day, on that account (upcoming.js) —
 *                   only the ones the engine is confident about, never one that already landed
 *   income          income sources the profile places (incomeProfile.js): a salary on the day of
 *                   the cycle it usually lands, anything else on its predicted next date — plus
 *                   the residual inflow below
 *   residual        everything else that usually moves the account at this point in the cycle,
 *                   money in and money out, learned from the last six complete cycles
 *
 * The residual is the part that earned its place the hard way. The first version projected only
 * "unexplained spend" — spend rows no recurring line claimed — and scripts/backtest-cash.mjs showed
 * that this household barely spends from its bank accounts at all: the thing that moves the liquid
 * total after payday is the card repayments, tens of thousands of rand a cycle, which the recurring
 * engine sees (one line per card) but can never schedule, because they are paid ad hoc on no
 * cadence and so sit at `low` confidence with no date to step. Refunds, interest, the small
 * regular credits with no monthly date, and the low-confidence lines were all missing for the same
 * reason. So the residual now takes EVERY row on the account in the history cycles and removes only
 * what the walk already accounts for — rows of a counted line the calendar can step forward, credits
 * matching an income source the profile places, and the legs of a transfer whose other side is
 * another liquid account (a savings sweep nets to nothing on the total) — so nothing is counted
 * twice and nothing that is systematically there is dropped.
 *
 * How the residual is read matters as much as what goes into it. A card repayment falls on a
 * different day each cycle, so per-day statistics across six cycles are mostly zeros: a median
 * loses the money and a mean is hostage to one settlement (one cycle here moved R180 000 in and out
 * on three adjacent days). The curve is therefore the recency-weighted MEDIAN of the CUMULATIVE
 * residual path by day of cycle, differenced day to day: dense, so the mass and the timing of the
 * usual repayments survive, and robust, so an abnormal cycle is one vote rather than the level.
 * Outflows are then shaped by the weekday and the rate is smoothed over three days.
 *
 * The path starts from the ledger's balance at `dataThrough`, anchored at the record's own as-of
 * date, so a balance typed on the 10th is not silently re-based to the 20th. Days between the data
 * and today are projected like any other and flagged `observed:false` — the chart draws them
 * dashed, because they have happened but cannot be seen.
 *
 * Cards are tracked beside the cash, not inside it: card-borne spend never touches liquid cash
 * here, it arrives through the repayment line on the paying account. A card's own path is what
 * tells you the day it reaches its limit.
 *
 * Everything about the residual is an estimate, and the module says so: until the backtest passes
 * its gate on past cycles the output carries `estimate:true` and the Today card labels the chart an
 * estimate. At the time of writing it does not pass: the trough's DAY is decided, in five of the
 * twelve scored cycles, by items under R1 000 landing in an otherwise flat tail — an oracle that
 * knew every future row of R1 000 or more would still miss the 3-day gate at cycle day 7 — so the
 * day-of-trough error is a floor the data sets, not one the model can lower without fitting noise.
 * What the model does get right is the money: the sign of the dip (does the cycle fall more than
 * R10 000 below its opening) at 83% and 100% of cycles at days 7 and 14, where the spend-only
 * version managed 75% and 92%.
 */

/** Flipped by scripts/backtest-cash.mjs passing its gate (minimum-day MAE ≤ 3, sign accuracy ≥ 75%). */
const VALIDATED = false;

const DAY_MS = 86400000;
const LIQUID = new Set(['Bank', 'Savings']);
const COUNTED = new Set(['high', 'medium']);
const INCOME_PRESENCE = 0.6;
const MAX_CYCLE_DAYS = 31;

const dateOf = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
const dayKey = (d) => midnight(d).getTime();
const toDay = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : parseTransactionDate(String(v));
  return d && !Number.isNaN(d.getTime()) ? midnight(d) : null;
};
const typeOfRecord = (a) => a?.typeOverride ?? a?.type ?? 'Other';
const isKnown = (a) => a?.currentBalance != null && Number.isFinite(a.currentBalance);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

function formatRand(n) {
  return `R${Math.round(Math.abs(n)).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- the residual flow ---------------------------------------------------------------------------

/**
 * The rows that moved the account in the history cycles and that nothing else in the walk will
 * put back: every row on the account except the ones the bills calendar will schedule (rows of a
 * counted line with a cadence the calendar can step), the ones the income profile will place, and
 * the legs of a transfer whose other side is another liquid account (a savings sweep moves money
 * between two lines of the same chart and nets to nothing on the total).
 */
function residualRows(rows, { historyCycles, modelled, internalLegs }) {
  const cycles = new Set(historyCycles);
  return rows.filter((t) => cycles.has(t['Pay Month']) && !modelled.has(t) && !internalLegs.has(t.id));
}

/**
 * Net residual by day of cycle over the history cycles, one vector per cycle (newest last) —
 * money in positive, money out negative — plus the weekday shape of the outflows alone.
 */
function paceHistory(rows, historyCycles, calendar) {
  const index = new Map(historyCycles.map((m, i) => [m, i]));
  const perCycle = historyCycles.map((m) => ({
    length: calendar.lengths[m] ?? 30,
    byDay: new Array(MAX_CYCLE_DAYS + 2).fill(0),
  }));
  const weekdayMass = new Array(7).fill(0);
  const weekdayDays = new Array(7).fill(0);
  historyCycles.forEach((m) => {
    const start = calendar.starts[m];
    for (let k = 0; k < (calendar.lengths[m] ?? 30); k += 1) weekdayDays[addDays(start, k).getDay()] += 1;
  });
  rows.forEach((t) => {
    const i = index.get(t['Pay Month']);
    const d = dateOf(t);
    if (i == null || !d) return;
    const m = historyCycles[i];
    const k = cycleDay(d, calendar.starts[m], calendar.lengths[m] ?? 30);
    perCycle[i].byDay[k] += t.AmountNum;
    if (t.AmountNum < 0) weekdayMass[d.getDay()] += -t.AmountNum;
  });
  const perDay = weekdayMass.map((mass, dow) => (weekdayDays[dow] ? mass / weekdayDays[dow] : 0));
  const overall = sum(perDay) / 7;
  const raw = overall > 0 ? perDay.map((v) => v / overall) : new Array(7).fill(1);
  const scale = sum(raw) > 0 ? 7 / sum(raw) : 1;
  return { perCycle, weekdayFactor: raw.map((v) => v * scale) };
}

/**
 * Weighted lower quantile: the smallest value at which the running weight reaches `q` of the
 * total. With six cycles and recency weights the median leans to the recent ones.
 */
function weightedQuantile(pairs, q) {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sum(sorted.map((p) => p.weight));
  let running = 0;
  for (const p of sorted) {
    running += p.weight;
    if (running >= q * total) return p.value;
  }
  return sorted.length ? sorted[sorted.length - 1].value : 0;
}

/**
 * Net residual on cycle day k, read off the CUMULATIVE residual path rather than the day's own
 * rows. A card repayment falls on a different day each cycle, so the quantile of any one day's
 * value across cycles is mostly zero and the mean is hostage to one settlement; the cumulative
 * path is dense and its recency-weighted quantile across cycles keeps both the mass and the
 * timing of what usually happens while one abnormal cycle can only ever be one vote. Day k's
 * rate is the quantile path's step from k−1 to k over the cycles long enough to have a day k,
 * smoothed over a centred CASH_SMOOTH_DAYS window so a repayment that fell on a Tuesday once is
 * spread, not spiked. `q` is 0.5 for the central path, 0.25 and 0.75 for the bands.
 */
function paceFunction(perCycle, q = 0.5) {
  const cumulative = perCycle.map((c) => {
    const out = new Array(MAX_CYCLE_DAYS + 2).fill(0);
    for (let k = 1; k <= MAX_CYCLE_DAYS + 1; k += 1) out[k] = out[k - 1] + c.byDay[k];
    return out;
  });
  const at = (k) => {
    if (k < 1 || k > MAX_CYCLE_DAYS + 1) return null;
    const pairs = [];
    [...perCycle].reverse().forEach((c, i) => {
      if (k <= c.length) pairs.push({ weight: AVG_RECENCY_DECAY ** i, index: perCycle.length - 1 - i });
    });
    if (!pairs.length) return null;
    const level = (day) => weightedQuantile(pairs.map((p) => ({ value: cumulative[p.index][day], weight: p.weight })), q);
    return level(k) - level(k - 1);
  };
  const half = Math.floor(CASH_SMOOTH_DAYS / 2);
  return (k) => {
    const values = [];
    for (let j = k - half; j <= k + half; j += 1) {
      const v = at(j);
      if (v != null) values.push(v);
    }
    return values.length ? sum(values) / values.length : 0;
  };
}

// ---- the walk ----------------------------------------------------------------------------------

/**
 * Walk one account across the horizon. `days[0]` is the anchor (the last observed day); every
 * later day adds income, subtracts the scheduled items and the discretionary pace. Three paths
 * run together: the central one, a low band (the heavier pace, every scheduled item) and a high
 * band (the lighter pace, only the high-confidence items).
 */
function walk({ start, days, scheduled, income, pace, floor, buffer }) {
  const out = [];
  let balance = start;
  let low = start;
  let high = start;
  days.forEach((day, i) => {
    if (i === 0) {
      out.push({ ...day, scheduled: [], income: 0, discretionary: 0, balance, low, high });
      return;
    }
    const items = scheduled(day);
    const counted = items.filter((it) => COUNTED.has(it.level));
    const inc = income(day);
    const rate = pace(day);
    const shaped = (net) => (net < 0 ? net * rate.weekday[day.date.getDay()] : net);
    const net = shaped(rate.mean);
    balance += inc - sum(counted.map((it) => it.amount)) + net;
    low += inc - sum(items.map((it) => it.amount)) + shaped(rate.low);
    high += inc - sum(items.filter((it) => it.level === 'high').map((it) => it.amount)) + shaped(rate.high);
    out.push({
      ...day,
      scheduled: counted,
      income: inc + Math.max(0, net),
      discretionary: Math.min(0, net),
      balance,
      low,
      high,
    });
  });
  return { days: out, ...pathStats(out, floor, buffer) };
}

function pathStats(days, floor, buffer) {
  const point = (d) => (d ? { date: d.date, cycleDay: d.cycleDay, value: d.balance } : null);
  const firstBelowFloor = point(days.find((d) => d.balance < floor));
  const firstBelowBuffer = point(days.find((d) => d.balance < floor + buffer));
  const min = point(days.reduce((best, d) => (best == null || d.balance < best.balance ? d : best), null));
  return {
    firstBelowFloor,
    firstBelowBuffer,
    min,
    daysUnderBuffer: days.filter((d, i) => i > 0 && d.balance < floor + buffer).length,
  };
}

// ---- the builder -------------------------------------------------------------------------------

function buildPath(options, { salaryShiftDays = 0 } = {}) {
  const {
    data,
    accounts = [],
    calendar,
    transfers,
    lines = [],
    upcoming = null,
    incomeProfile = null,
    buffer = 0,
    extendDays = CASH_EXTEND_DAYS,
    overrides = null,
  } = options;
  if (!data?.length || !calendar?.starts || !calendar.currentMonth) return null;
  const dataThrough = toDay(options.dataThrough ?? calendar.dataThrough);
  const asOf = toDay(options.asOf) ?? dataThrough;
  if (!dataThrough) return null;
  const currentMonth = calendar.currentMonth;
  const currentStart = calendar.starts[currentMonth];
  const currentEnd = calendar.ends[currentMonth];
  const cycleLength = calendar.lengths[currentMonth] ?? 30;
  const nextPayDate = addDays(currentEnd, 1);
  const horizonTo = addDays(nextPayDate, extendDays);
  if (horizonTo <= dataThrough) return null;

  // The calendar days of the walk: the anchor, then every day to the end of the horizon.
  const days = [];
  for (let d = dataThrough; d <= horizonTo; d = addDays(d, 1)) {
    const inCurrent = d <= currentEnd;
    days.push({
      date: d,
      cycleDay: inCurrent ? cycleDay(d, currentStart, cycleLength) : daysBetween(nextPayDate, d) + 1,
      cycle: inCurrent ? 'current' : 'next',
      observed: d <= dataThrough,
      elapsed: d <= asOf,
    });
  }

  const historyCycles = completeMonths(calendar).slice(-CASH_HISTORY_CYCLES);

  // Liquid accounts: Bank or Savings by the record's type, not hidden, with rows or external.
  const liquid = accounts.filter((a) => LIQUID.has(typeOfRecord(a)) && !a.hidden);
  const liquidIds = new Set(liquid.map((a) => a.id));

  // Income the profile will place: a salary on its usual day of the cycle (a calendar-month step
  // from its last date can land a salary inside the current cycle on a day it has never come),
  // anything else on its predicted next date; the late-salary rerun shifts every salary source.
  const placed = (incomeProfile?.sources ?? []).filter((s) => s.presence >= INCOME_PRESENCE && s.expectedAmount > 0);
  const incomeByAccount = new Map();
  placed.forEach((s) => {
    const k = s.kind === 'salary' && s.timing?.typicalCycleDay != null ? Math.round(s.timing.typicalCycleDay) : null;
    // A salary that lands late in its own cycle is due this cycle if that day is still ahead.
    const lateInCurrent = k != null && k > cycleLength / 2 ? addDays(currentStart, k - 1) : null;
    let date = k == null ? (s.expectedNext ? toDay(s.expectedNext) : null) : lateInCurrent && lateInCurrent > dataThrough ? lateInCurrent : addDays(nextPayDate, k - 1);
    if (!date) return;
    if (s.kind === 'salary' && salaryShiftDays) date = addDays(date, salaryShiftDays);
    if (!incomeByAccount.has(s.accountId)) incomeByAccount.set(s.accountId, new Map());
    const byDay = incomeByAccount.get(s.accountId);
    byDay.set(dayKey(date), (byDay.get(dayKey(date)) ?? 0) + s.expectedAmount);
  });
  const incomeFor = (id) => {
    const byDay = incomeByAccount.get(id);
    return (day) => byDay?.get(dayKey(day.date)) ?? 0;
  };

  // What the walk already accounts for, so the residual never counts it twice: rows of a counted
  // line the calendar can step forward, and credits that belong to an income source placed above.
  const modelled = new Set();
  (lines ?? []).forEach((line) => {
    if (COUNTED.has(line.level) && line.perYear) (line.items ?? []).forEach((row) => modelled.add(row));
  });
  const placedByAccount = new Map();
  placed.forEach((s) => {
    if (!placedByAccount.has(s.accountId)) placedByAccount.set(s.accountId, []);
    placedByAccount.get(s.accountId).push(s);
  });
  const matchesPlaced = (t) => {
    if (!(t.AmountNum > 0)) return false;
    const sources = placedByAccount.get(accountIdOf(t.Account));
    if (!sources) return false;
    return sources.some(
      (s) =>
        (s.kind === 'salary' && isSalaryLikeIncome(t)) ||
        Math.abs(t.AmountNum - s.expectedAmount) <= INCOME_BAND_TOLERANCE * s.expectedAmount,
    );
  };
  data.forEach((t) => {
    if (matchesPlaced(t)) modelled.add(t);
  });
  const internalLegs = new Set();
  (transfers?.pairs ?? []).forEach((pair) => {
    if (liquidIds.has(accountIdOf(pair.fromAccount)) && liquidIds.has(accountIdOf(pair.toAccount))) {
      pair.items.forEach((t) => internalLegs.add(t.id));
    }
  });

  // Scheduled items by paying account and day, from the bills calendar. Landed items are out: the
  // money already left and is inside the anchor balance.
  const scheduledByAccount = new Map();
  (upcoming?.entries ?? []).forEach((entry) => {
    entry.items.forEach((item) => {
      if (item.status === 'landed') return;
      const id = item.payingAccountId;
      if (!scheduledByAccount.has(id)) scheduledByAccount.set(id, new Map());
      const byDay = scheduledByAccount.get(id);
      const key = dayKey(entry.date);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push({ label: item.label, amount: item.amount, level: item.level, kind: item.kind });
    });
  });
  const scheduledFor = (id) => {
    const byDay = scheduledByAccount.get(id);
    return (day) => byDay?.get(dayKey(day.date)) ?? [];
  };

  // The residual pace of an account: signed net by day of cycle. An override (tests) is a spend
  // per cycle day, so it enters with its sign flipped.
  const paceFor = (id, rows) => {
    const override = overrides?.pace?.[id];
    const flatWeek = new Array(7).fill(1);
    if (override) {
      const fixed = (k) => -(override[Math.min(override.length - 1, Math.max(0, k))] ?? 0);
      return (day) => ({ mean: fixed(day.cycleDay), low: fixed(day.cycleDay), high: fixed(day.cycleDay), weekday: flatWeek });
    }
    const history = paceHistory(residualRows(rows, { historyCycles, modelled, internalLegs }), historyCycles, calendar);
    const weekday = overrides && overrides.weekdayFactor === null ? flatWeek : history.weekdayFactor;
    const mean = paceFunction(history.perCycle);
    const low = paceFunction(history.perCycle, 0.25);
    const high = paceFunction(history.perCycle, 0.75);
    return (day) => ({ mean: mean(day.cycleDay), low: low(day.cycleDay), high: high(day.cycleDay), weekday });
  };

  const assumptions = [];
  const accountPaths = [];
  liquid.forEach((a) => {
    const rows = accountRows(data, { accountId: a.id });
    if (!rows.length && !a.external) return;
    const known = isKnown(a);
    const start = overrides?.start?.[a.id] ?? (known ? balanceAt(rows, a, dataThrough) : 0);
    const floor = -(a.overdraftLimit ?? 0);
    const path = walk({
      start,
      days,
      scheduled: scheduledFor(a.id),
      income: incomeFor(a.id),
      pace: paceFor(a.id, rows),
      floor,
      buffer,
    });
    accountPaths.push({
      accountId: a.id,
      label: a.label || a.rawName || a.id,
      type: typeOfRecord(a),
      start,
      floor,
      known,
      external: Boolean(a.external),
      ...path,
    });
    if (known) {
      assumptions.push(
        `${a.label || a.rawName}: balance as of ${a.balanceAsOf ?? iso(dataThrough)}${a.source === 'statement' ? ' (from your bank summary)' : a.source === 'manual' ? ' (typed)' : ''}.`,
      );
    } else {
      assumptions.push(`${a.label || a.rawName}: no balance entered — its line shows change since ${iso(dataThrough)}.`);
    }
  });
  if (!accountPaths.length) return null;
  const anchored = accountPaths.some((p) => p.known);

  // Cards: their own path, floored at the limit; repayments arrive from the repayment lines.
  const cards = accounts.filter((a) => typeOfRecord(a) === 'Credit Card' && !a.hidden && isKnown(a));
  const cardPaths = cards.map((card) => {
    const rows = accountRows(data, { accountId: card.id });
    const start = overrides?.start?.[card.id] ?? balanceAt(rows, card, dataThrough);
    const limit = card.creditLimit ?? null;
    const scheduled = scheduledFor(card.id);
    const pace = paceFor(card.id, rows);
    const repaymentByDay = new Map();
    (lines ?? [])
      .filter((line) => line.source === 'repayment' && line.cardAccountId === card.id && line.status === 'active' && line.nextDate)
      .forEach((line) => {
        const key = dayKey(line.nextDate);
        repaymentByDay.set(key, (repaymentByDay.get(key) ?? 0) + line.amount);
      });
    let balance = start;
    let firstLimit = null;
    const cardDays = days.map((day, i) => {
      if (i > 0) {
        const rate = pace(day);
        const counted = scheduled(day).filter((it) => COUNTED.has(it.level));
        balance += (repaymentByDay.get(dayKey(day.date)) ?? 0) - sum(counted.map((it) => it.amount)) + (rate.mean < 0 ? rate.mean * rate.weekday[day.date.getDay()] : rate.mean);
        if (limit != null && balance <= -limit) {
          balance = -limit;
          if (!firstLimit) firstLimit = { date: day.date, cycleDay: day.cycleDay, value: balance };
        }
      }
      return { date: day.date, cycleDay: day.cycleDay, balance };
    });
    return { accountId: card.id, label: card.label || card.rawName || card.id, start, limit, days: cardDays, firstLimit };
  });

  // The aggregate: every liquid account summed, floor zero (overdrafts are per account).
  const totalDays = days.map((day, i) => ({
    date: day.date,
    cycleDay: day.cycleDay,
    cycle: day.cycle,
    observed: day.observed,
    elapsed: day.elapsed,
    balance: sum(accountPaths.map((p) => p.days[i].balance)),
    low: sum(accountPaths.map((p) => p.days[i].low)),
    high: sum(accountPaths.map((p) => p.days[i].high)),
    income: sum(accountPaths.map((p) => p.days[i].income)),
    scheduled: accountPaths.flatMap((p) => p.days[i].scheduled),
  }));
  const paydayIndex = totalDays.findIndex((d) => dayKey(d.date) === dayKey(nextPayDate));
  const before = paydayIndex > 0 ? totalDays[paydayIndex - 1].balance : paydayIndex === 0 ? totalDays[0].balance : null;
  const atPayday = {
    before,
    after: before == null ? null : before + (paydayIndex >= 0 ? totalDays[paydayIndex].income : 0),
  };
  const total = {
    days: totalDays,
    ...pathStats(totalDays, 0, buffer),
    atPayday,
    endOfHorizon: totalDays[totalDays.length - 1].balance,
  };

  const mediumItems = totalDays.flatMap((d) => d.scheduled.filter((it) => it.level === 'medium'));
  assumptions.push(
    `Usual movement by day of cycle — card repayments, refunds, interest and spend no confident line explains — from the last ${historyCycles.length} complete cycles, as the median path with the newest cycles weighted most.`,
    'Card repayments leave the paying account at their usual pace and arrive on the card on the day the repayment line usually lands.',
  );
  if (mediumItems.length) {
    assumptions.push(`${mediumItems.length} medium-confidence item${mediumItems.length === 1 ? '' : 's'} (${formatRand(sum(mediumItems.map((it) => it.amount)))}) counted; low-confidence ones only widen the band.`);
  }
  if (!upcoming) assumptions.push('No bills calendar was given, so only the usual movement is projected.');

  return {
    anchored,
    buffer,
    horizon: { from: addDays(dataThrough, 1), to: horizonTo, nextPayDate },
    dataThrough,
    asOf,
    accounts: accountPaths,
    cards: cardPaths,
    total,
    lateSalary: null,
    assumptions,
    estimate: !VALIDATED,
    // The measured reliability, so the card can say how often the call was right rather than
    // only that it is an estimate.
    backtest,
  };
}

/**
 * @param options  data, accounts: AccountRecord[], calendar, transfers: buildFullTransfers(data),
 *                 lines: RecurringLine[] (their `items` are what the residual leaves out; the old
 *                 `explained` set is accepted and ignored, because it also covered the low lines the
 *                 residual must keep), upcoming: buildUpcoming(...), incomeProfile, asOf: Date,
 *                 dataThrough: Date, buffer = 0, extendDays = 7,
 *                 overrides (tests): { pace: { [accountId]: number[] /* spend per cycle day *\/ },
 *                                      start: { [accountId]: number }, weekdayFactor: null }
 * @returns {CashPath|null} — shape at the foot of this file; null without a liquid account
 */
export function buildCashToPayday(options) {
  const path = buildPath(options ?? {});
  if (!path) return null;
  const salary = options?.incomeProfile?.salary;
  if (salary && salary.lateRisk >= LATE_SALARY_MIN_RISK && salary.lateDelayP90 > 0) {
    const delayDays = Math.round(salary.lateDelayP90);
    const late = buildPath(options, { salaryShiftDays: delayDays });
    if (late) {
      path.lateSalary = {
        probability: salary.lateRisk,
        delayDays,
        firstBelowFloor: late.total.firstBelowFloor,
        min: late.total.min,
      };
      const n = salary.cycles ?? 0;
      const k = (salary.missingCycles?.length ?? 0) + (salary.lateCycles?.length ?? 0);
      path.assumptions.push(
        `If the salary is ${delayDays} day${delayDays === 1 ? '' : 's'} late (it has been in ${k} of ${n} cycles) the path is rerun with it shifted.`,
      );
    }
  }
  return path;
}

/**
 * CashPath = {
 *   anchored, buffer, horizon: { from, to, nextPayDate }, dataThrough, asOf, estimate,
 *   accounts: [{ accountId, label, type, start, floor, known, external,
 *                days: [{ date, cycleDay, cycle, observed, elapsed, scheduled: [{ label, amount, level, kind }],
 *                         income, discretionary, balance, low, high }],
 *                firstBelowFloor, firstBelowBuffer, min: { date, cycleDay, value }, daysUnderBuffer }],
 *   cards: [{ accountId, label, start, limit, days: [{ date, cycleDay, balance }], firstLimit }],
 *   total: { days: [{ date, cycleDay, cycle, observed, elapsed, balance, low, high, income, scheduled }],
 *            firstBelowFloor, firstBelowBuffer, min, atPayday: { before, after }, endOfHorizon, daysUnderBuffer },
 *   lateSalary: { probability, delayDays, firstBelowFloor, min } | null, assumptions: string[],
 * }
 * `days[0]` is the anchor — the last observed day — so `firstBelowFloor` etc. are points with a
 * `cycleDay`, and `atPayday.after − atPayday.before` is the income that lands on payday.
 */
