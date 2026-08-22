import {
  AVG_RECENCY_DECAY,
  CASH_EXTEND_DAYS,
  CASH_HISTORY_CYCLES,
  CASH_SMOOTH_DAYS,
  LATE_SALARY_MIN_RISK,
} from '../constants';
import { parseTransactionDate } from '../utils/date';
import { accountIdOf } from './accounts';
import { cycleDay } from './cycleCurve';
import { completeMonths, spendRows } from './flows';
import { accountRows, balanceAt } from './ledger';
import { quantile } from './stats';

/**
 * Cash, day by day, until the next salary — and the week after it.
 *
 * The question is "will I make it to the 23rd", and the old answer (a net figure for the cycle)
 * could not say WHEN the money runs out, which is the only thing that decides whether a debit
 * order bounces. So this walks every liquid account one calendar day at a time from the last day
 * the data covers to a week past payday, adding what is known and subtracting what is usual:
 *
 *   scheduled       the bills calendar's items on that day, on that account (upcoming.js) —
 *                   only the ones the engine is confident about, never one that already landed
 *   income          income sources expected on that day (incomeProfile.js)
 *   discretionary   the account's own pace of unexplained spend for that day of the cycle, shaped
 *                   by the weekday — learned from the last six complete cycles of spend rows that
 *                   no recurring line claims, so a bill is never counted twice
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
 * Everything about the discretionary pace is an estimate, and the module says so: until
 * scripts/backtest-cash.mjs passes its gate on past cycles the output carries `estimate:true` and
 * the Today card labels the chart an estimate.
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

// ---- the discretionary pace ---------------------------------------------------------------------

/**
 * Spend by day of cycle over the history cycles, one vector per cycle (newest last), plus the
 * weekday shape of the same rows. Rows are the account's spend that no recurring line explains.
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
    perCycle[i].byDay[k] += Math.abs(t.AmountNum);
    weekdayMass[d.getDay()] += Math.abs(t.AmountNum);
  });
  const perDay = weekdayMass.map((mass, dow) => (weekdayDays[dow] ? mass / weekdayDays[dow] : 0));
  const overall = sum(perDay) / 7;
  const raw = overall > 0 ? perDay.map((v) => v / overall) : new Array(7).fill(1);
  const scale = sum(raw) > 0 ? 7 / sum(raw) : 1;
  return { perCycle, weekdayFactor: raw.map((v) => v * scale) };
}

/**
 * Spend on cycle day k: the recency-weighted mean over the cycles long enough to have a day k
 * (`q` null), or the q-quantile for the bands. Smoothed over a centred CASH_SMOOTH_DAYS window so
 * one big Tuesday does not become a spike the path expects every cycle.
 */
function paceFunction(perCycle, q = null) {
  const at = (k) => {
    if (k < 1 || k > MAX_CYCLE_DAYS + 1) return null;
    const cycles = perCycle.filter((c) => k <= c.length);
    if (!cycles.length) return null;
    const values = cycles.map((c) => c.byDay[k]);
    if (q != null) return quantile(values, q);
    let weighted = 0;
    let total = 0;
    [...cycles].reverse().forEach((c, i) => {
      const w = AVG_RECENCY_DECAY ** i;
      weighted += c.byDay[k] * w;
      total += w;
    });
    return total ? weighted / total : 0;
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
    const dow = day.date.getDay();
    const disc = rate.mean * rate.weekday[dow];
    balance += inc - sum(counted.map((it) => it.amount)) - disc;
    low += inc - sum(items.map((it) => it.amount)) - rate.low * rate.weekday[dow];
    high += inc - sum(items.filter((it) => it.level === 'high').map((it) => it.amount)) - rate.high * rate.weekday[dow];
    out.push({ ...day, scheduled: counted, income: inc, discretionary: -disc, balance, low, high });
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
    explained = null,
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
  const explainedSet = explained ?? new Set();
  const spend = spendRows(data, { transfers, accounts, months: historyCycles }).filter((t) => !explainedSet.has(t));
  const spendById = new Map();
  spend.forEach((t) => {
    const id = accountIdOf(t.Account);
    if (!spendById.has(id)) spendById.set(id, []);
    spendById.get(id).push(t);
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

  // Income by account and day. A salary source with no predicted date but a known cycle day is
  // placed on that day of the next cycle; the late-salary rerun shifts every salary source.
  const incomeByAccount = new Map();
  (incomeProfile?.sources ?? []).forEach((s) => {
    if (s.presence < INCOME_PRESENCE || !(s.expectedAmount > 0)) return;
    let date = s.expectedNext ? toDay(s.expectedNext) : null;
    if (!date && s.kind === 'salary' && s.timing?.typicalCycleDay != null) {
      date = addDays(nextPayDate, Math.round(s.timing.typicalCycleDay) - 1);
    }
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

  const paceFor = (id) => {
    const history = paceHistory(spendById.get(id) ?? [], historyCycles, calendar);
    const override = overrides?.pace?.[id];
    const flatWeek = new Array(7).fill(1);
    const weekday = override || (overrides && overrides.weekdayFactor === null) ? flatWeek : history.weekdayFactor;
    if (override) {
      const fixed = (k) => override[Math.min(override.length - 1, Math.max(0, k))] ?? 0;
      return (day) => ({ mean: fixed(day.cycleDay), low: fixed(day.cycleDay), high: fixed(day.cycleDay), weekday });
    }
    const mean = paceFunction(history.perCycle);
    const low = paceFunction(history.perCycle, 0.75);
    const high = paceFunction(history.perCycle, 0.25);
    return (day) => ({ mean: mean(day.cycleDay), low: low(day.cycleDay), high: high(day.cycleDay), weekday });
  };

  // Liquid accounts: Bank or Savings by the record's type, not hidden, with rows or external.
  const liquid = accounts.filter((a) => LIQUID.has(typeOfRecord(a)) && !a.hidden);
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
      pace: paceFor(a.id),
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
    const pace = paceFor(card.id);
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
        balance += (repaymentByDay.get(dayKey(day.date)) ?? 0) - sum(counted.map((it) => it.amount)) - rate.mean * rate.weekday[day.date.getDay()];
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
    `Daily spend pace from the last ${historyCycles.length} complete cycles of spend not explained by a recurring line, by day of cycle and weekday.`,
    'Card repayments are assumed at their usual amount on their usual day, leaving the paying account and arriving on the card.',
  );
  if (mediumItems.length) {
    assumptions.push(`${mediumItems.length} medium-confidence item${mediumItems.length === 1 ? '' : 's'} (${formatRand(sum(mediumItems.map((it) => it.amount)))}) counted; low-confidence ones only widen the band.`);
  }
  if (!upcoming) assumptions.push('No bills calendar was given, so only the spend pace is projected.');

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
  };
}

/**
 * @param options  data, accounts: AccountRecord[], calendar, transfers: buildFullTransfers(data),
 *                 lines: RecurringLine[], explained: Set<Transaction>, upcoming: buildUpcoming(...),
 *                 incomeProfile, asOf: Date, dataThrough: Date, buffer = 0, extendDays = 7,
 *                 overrides (tests): { pace: { [accountId]: number[] /* index = cycle day *\/ },
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
