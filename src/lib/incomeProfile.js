import {
  AMOUNT_CLUSTER_MIN_GAP,
  INCOME_BAND_TOLERANCE,
  INCOME_HISTORY_CYCLES,
  INCOME_INTEREST_MAX,
  INCOME_REFUND_WINDOW_DAYS,
  LATE_DAYS,
  SALARY_SHARE_MIN,
} from '../constants';
import { parseTransactionDate } from '../utils/date';
import { accountIdOf } from './accounts';
import { classifyCadence, dayOfMonthMode, nextExpected } from './cadence';
import { cycleDay } from './cycleCurve';
import { isSalaryLikeIncome } from './effectivePayMonth';
import { completeMonths, incomeRows, spendRows } from './flows';
import { isPersonPayment, merchantKeyOf, merchantLabel } from './merchants';
import { isRegularAmount } from './missedPayments';
import { dispersion, median, mode, quantile } from './stats';

/**
 * Where the money comes from, and how reliably.
 *
 * The app used to assume one salary: the first salary-like credit of the cycle was THE salary, and
 * everything about payday followed from it. The real export does not cooperate — two or three
 * salary-like rows a cycle through 2025 from two accounts, one since, mostly on the 23rd–25th but
 * also on the 1st, the 4th and the 17th, and two complete cycles with none at all. So income is
 * read the way spend is: as SOURCES, each identified by who paid, into which account, at what
 * amount band, and each scored on its own for presence, day-of-month and punctuality. "The
 * salary" is then an aggregate over the sources that look like one, not a guess at a single row.
 *
 * Two kinds of credit are removed before any of that: refunds (a credit that mirrors a recent
 * debit at the same merchant is money coming back, not income) and the few-rand interest credits
 * a current account pays, which would otherwise be the most "regular" source in the file.
 *
 * History is the last twelve COMPLETE cycles by raw Pay Month, deliberately: a salary that slips
 * past the 22nd lands in the next Pay Month in the export, and that IS the lateness signal — the
 * cycle it missed reads as missing and the next as doubled, which is exactly what happened.
 */

const DAY_MS = 86400000;
const PRESENT = 0.5;
const DOUBLE_SHARE = 0.8;
const EXPECTED_LAST_N = 3;
const INTEREST_RE = /\binterest\b/i;

const dateOf = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
const toDay = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : parseTransactionDate(String(v));
  return d && !Number.isNaN(d.getTime()) ? midnight(d) : null;
};
const isInterest = (t) => t.Category === 'Interest' || INTEREST_RE.test(t.Description ?? '');

function formatRand(n) {
  return `R${Math.round(Math.abs(n)).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
}

/** Observation: one income row with the few facts the profile needs pulled off it once. */
function observe(row) {
  const date = dateOf(row);
  return {
    row,
    date: date ? midnight(date) : null,
    amount: row.AmountNum,
    key: merchantKeyOf(row.Description),
    accountId: accountIdOf(row.Account),
    cycle: row['Pay Month'],
  };
}

/**
 * A credit that mirrors a recent debit at the same merchant on the same account, no larger than
 * that debit, is a refund. Indexed by merchant|account so the check is a short walk, not a scan.
 */
function refundDetector(data, { transfers, accounts }) {
  const debits = new Map();
  spendRows(data, { transfers, accounts }).forEach((t) => {
    const key = merchantKeyOf(t.Description);
    const date = dateOf(t);
    if (!key || !date) return;
    const id = `${key}|${accountIdOf(t.Account)}`;
    if (!debits.has(id)) debits.set(id, []);
    debits.get(id).push({ date: midnight(date), amount: -t.AmountNum });
  });
  return (o) => {
    if (!o.key) return false;
    const list = debits.get(`${o.key}|${o.accountId}`);
    if (!list) return false;
    return list.some(
      (d) => d.date <= o.date && daysBetween(d.date, o.date) <= INCOME_REFUND_WINDOW_DAYS && d.amount >= o.amount,
    );
  };
}

/**
 * Amount bands by the recurring cluster rule, with the wider income tolerance: sort ascending and
 * open a new band at each gap wider than max(AMOUNT_CLUSTER_MIN_GAP, INCOME_BAND_TOLERANCE × the
 * previous amount). A salary with a small bonus stays one source; two earners at different pay
 * are two. Returns each observation's band index (0 = smallest).
 */
function bandOf(observations) {
  const sorted = [...observations].sort((a, b) => a.amount - b.amount);
  const bands = new Map();
  let band = -1;
  let previous = null;
  sorted.forEach((o) => {
    if (previous == null || o.amount - previous > Math.max(AMOUNT_CLUSTER_MIN_GAP, INCOME_BAND_TOLERANCE * previous)) {
      band += 1;
    }
    bands.set(o, band);
    previous = o.amount;
  });
  return bands;
}

function kindOf({ category, regular, share }) {
  if (/salaries?|wages?/i.test(category ?? '')) return 'salary';
  if (category === 'Rent') return 'rent';
  if (category === 'Interest') return 'interest';
  if (regular && share >= SALARY_SHARE_MIN) return 'salary';
  return 'other';
}

/**
 * When a salary source lands, cycle by cycle: the cycle day of its first row in each cycle since
 * it was first seen, the cycles with no row at all, and the cycles it landed twice.
 */
function timingOf(obs, cyclesSince, calendar, expectedAmount) {
  const byCycle = new Map();
  obs.forEach((o) => {
    if (!byCycle.has(o.cycle)) byCycle.set(o.cycle, []);
    byCycle.get(o.cycle).push(o);
  });
  const landDays = [];
  const missingCycles = [];
  const doubleCycles = [];
  const landDayOf = new Map();
  cyclesSince.forEach((c) => {
    const rows = (byCycle.get(c) ?? []).sort((a, b) => a.date - b.date);
    if (!rows.length) {
      missingCycles.push(c);
      return;
    }
    const day = cycleDay(rows[0].date, calendar.starts[c], calendar.lengths[c]);
    landDays.push(day);
    landDayOf.set(c, day);
    if (rows.filter((o) => o.amount >= DOUBLE_SHARE * expectedAmount).length >= 2) doubleCycles.push(c);
  });
  const typicalCycleDay = landDays.length ? median(landDays) : null;
  const lateCycles = cyclesSince.filter(
    (c) => landDayOf.has(c) && landDayOf.get(c) > typicalCycleDay + LATE_DAYS,
  );
  const delays = [
    ...lateCycles.map((c) => landDayOf.get(c) - typicalCycleDay),
    ...missingCycles.map((c) => (calendar.lengths[c] ?? 30) - (typicalCycleDay ?? 0) + 1),
  ];
  return {
    typicalCycleDay,
    lateRisk: cyclesSince.length ? (lateCycles.length + missingCycles.length) / cyclesSince.length : 0,
    lateDelayP90: delays.length ? quantile(delays, 0.9) : 0,
    missingCycles,
    doubleCycles,
    lateCycles,
  };
}

/**
 * @param data     every row (all accounts)
 * @param options  accounts: AccountRecord[]; calendar: buildCycleCalendar(...); transfers:
 *                 buildFullTransfers(data); asOf: Date; dataThrough: Date; historyCycles = 12
 * @returns {IncomeProfile|null} — see the shape at the foot of this file; null without complete cycles.
 */
export function buildIncomeProfile(data, options = {}) {
  const { accounts = null, calendar, transfers, historyCycles = INCOME_HISTORY_CYCLES } = options;
  if (!data?.length || !calendar?.starts || !transfers) return null;
  const cycles = completeMonths(calendar).slice(-historyCycles);
  if (!cycles.length) return null;
  const cycleSet = new Set(cycles);
  const currentMonth = calendar.currentMonth;
  const dataThrough = toDay(options.dataThrough ?? calendar.dataThrough);

  // Step 1: the candidate credits, less refunds and small interest.
  const isRefund = refundDetector(data, { transfers, accounts });
  let refundsRemoved = 0;
  let interestIncome = 0;
  const kept = [];
  incomeRows(data, { transfers, accounts })
    .map(observe)
    .filter((o) => o.date && (cycleSet.has(o.cycle) || o.cycle === currentMonth))
    .forEach((o) => {
      if (isRefund(o)) {
        refundsRemoved += 1;
        return;
      }
      if (isInterest(o.row) && o.amount < INCOME_INTEREST_MAX) {
        if (cycleSet.has(o.cycle)) interestIncome += o.amount;
        return;
      }
      kept.push(o);
    });

  // Step 2: identity — merchant (or category) | account | amount band.
  const groups = new Map();
  kept.forEach((o) => {
    const base = o.key || o.row.Category || 'Uncategorised';
    const id = `${base}|${o.accountId}`;
    if (!groups.has(id)) groups.set(id, { base, accountId: o.accountId, obs: [] });
    groups.get(id).obs.push(o);
  });
  const raw = [];
  groups.forEach((group) => {
    const bands = bandOf(group.obs);
    const byBand = new Map();
    group.obs.forEach((o) => {
      const b = bands.get(o);
      if (!byBand.has(b)) byBand.set(b, []);
      byBand.get(b).push(o);
    });
    byBand.forEach((obs, band) => {
      raw.push({ id: `${group.base}|${group.accountId}|${band}`, base: group.base, accountId: group.accountId, obs });
    });
  });

  // Step 3: per source over the window (current-cycle rows inform the dates only).
  const windowTotal = raw.reduce(
    (s, src) => s + src.obs.filter((o) => cycleSet.has(o.cycle)).reduce((x, o) => x + o.amount, 0),
    0,
  );
  const sources = [];
  raw.forEach((src) => {
    const windowObs = src.obs.filter((o) => cycleSet.has(o.cycle)).sort((a, b) => a.date - b.date);
    if (!windowObs.length) return;
    const allObs = [...src.obs].sort((a, b) => a.date - b.date);
    const byCycle = new Map();
    windowObs.forEach((o) => byCycle.set(o.cycle, (byCycle.get(o.cycle) ?? 0) + o.amount));
    const firstCycle = [...byCycle.keys()].sort()[0];
    const cyclesSince = cycles.filter((c) => c >= firstCycle);
    const cyclesPresent = byCycle.size;
    const presence = cyclesSince.length ? cyclesPresent / cyclesSince.length : 0;
    const dates = allObs.map((o) => o.date);
    const doms = dates.map((d) => d.getDate());
    const dom = dayOfMonthMode(dates);
    const expectedAmount = median(allObs.slice(-EXPECTED_LAST_N).map((o) => o.amount));
    const perCycleTotals = cyclesSince.map((c) => byCycle.get(c) ?? 0);
    const regular = isRegularAmount(perCycleTotals);
    const total = windowObs.reduce((s, o) => s + o.amount, 0);
    const share = windowTotal > 0 ? total / windowTotal : 0;
    const category = mode(windowObs.map((o) => o.row.Category ?? ''));
    const kind = kindOf({ category, regular, share });
    const cadence = classifyCadence(dates).cadence;
    const expectedNext =
      presence >= PRESENT && cadence === 'monthly' ? nextExpected(dates, 'monthly', { dayOfMonth: dom }) : null;
    const sample = windowObs[windowObs.length - 1].row;
    const label = isPersonPayment(sample.Description) || !src.base || src.base === category
      ? category || 'Income'
      : merchantLabel(src.base);
    const timing = kind === 'salary' ? timingOf(windowObs, cyclesSince, calendar, expectedAmount) : null;
    sources.push({
      id: src.id,
      label,
      kind,
      category,
      accountId: src.accountId,
      presence,
      cyclesPresent,
      cyclesSinceFirst: cyclesSince.length,
      occurrences: windowObs.length,
      dom,
      domIqr: quantile(doms, 0.75) - quantile(doms, 0.25),
      expectedAmount,
      expectedNext,
      lastReceived: dates[dates.length - 1],
      regular,
      share,
      total,
      timing,
      firstCycle,
      isSalaryLike: windowObs.some((o) => isSalaryLikeIncome(o.row)),
    });
  });
  sources.sort((a, b) => b.share - a.share);

  // Step 5: the salary, as an aggregate over the sources that look like one.
  const salarySources = sources.filter((s) => s.kind === 'salary' && s.presence >= PRESENT);
  let salary = null;
  let salaryDispersion = Infinity;
  if (salarySources.length) {
    const nexts = salarySources.map((s) => s.expectedNext).filter(Boolean);
    const union = (field) => [...new Set(salarySources.flatMap((s) => s.timing?.[field] ?? []))].sort();
    salary = {
      sourceIds: salarySources.map((s) => s.id),
      expectedAmount: salarySources.reduce((s, x) => s + x.expectedAmount, 0),
      expectedNext: nexts.length ? new Date(Math.min(...nexts.map((d) => d.getTime()))) : null,
      typicalCycleDay: median(salarySources.map((s) => s.timing.typicalCycleDay).filter((d) => d != null)),
      lateRisk: Math.max(...salarySources.map((s) => s.timing.lateRisk)),
      lateDelayP90: Math.max(...salarySources.map((s) => s.timing.lateDelayP90)),
      missingCycles: union('missingCycles'),
      doubleCycles: union('doubleCycles'),
      lateCycles: union('lateCycles'),
      lastReceived: new Date(Math.max(...salarySources.map((s) => s.lastReceived.getTime()))),
      cycles: salarySources.reduce((n, s) => Math.max(n, s.cyclesSinceFirst), 0),
    };
    const firstSalaryCycle = salarySources.map((s) => s.firstCycle).sort()[0];
    const salaryCycles = cycles.filter((c) => c >= firstSalaryCycle);
    const salaryIds = new Set(salary.sourceIds);
    const totals = salaryCycles.map((c) =>
      raw
        .filter((src) => salaryIds.has(src.id))
        .flatMap((src) => src.obs)
        .filter((o) => o.cycle === c)
        .reduce((s, o) => s + o.amount, 0),
    );
    salaryDispersion = dispersion(totals);
  }

  // Step 6: concentration and the stability heuristic.
  const hhi = sources.reduce((s, x) => s + x.share * x.share, 0);
  const present = sources.filter((s) => s.presence >= PRESENT);
  const amountScore = salary ? 40 * (1 - Math.min(1, salaryDispersion / 0.25)) : 0;
  const timingScore = salary ? 35 * (1 - Math.min(1, salary.lateRisk / 0.25)) : 0;
  const spreadScore = 25 * (1 - hhi);
  const stabilityScore = amountScore + timingScore + spreadScore;

  const assumptions = [
    'Income sources are identified by merchant, account and amount band (±15%); the history is the last 12 complete cycles by raw pay month.',
    'Stability score is a heuristic: 40 points for a steady salary amount, 35 for punctuality, 25 for spread across sources.',
  ];
  if (refundsRemoved) {
    assumptions.push(
      `${refundsRemoved} credit${refundsRemoved === 1 ? '' : 's'} matching a recent debit at the same merchant ${refundsRemoved === 1 ? 'was' : 'were'} removed as refunds.`,
    );
  }
  if (interestIncome > 0) {
    assumptions.push(`Interest credits under ${formatRand(INCOME_INTEREST_MAX)} are left out (${formatRand(interestIncome)} over the window).`);
  }
  if (dataThrough && salary?.expectedNext && salary.expectedNext <= dataThrough) {
    assumptions.push('The salary expected this cycle has not appeared in the data yet.');
  }

  return {
    sources: sources.map((s) => {
      const out = { ...s };
      delete out.firstCycle;
      delete out.isSalaryLike;
      return out;
    }),
    salary,
    totalPerCycle: present.reduce((s, x) => s + x.expectedAmount, 0),
    sourceCount: present.length,
    hhi,
    stabilityScore,
    tone: stabilityScore >= 70 ? 'good' : stabilityScore >= 45 ? 'warn' : 'bad',
    interestIncome,
    refundsRemoved,
    cycles,
    assumptions,
  };
}

/**
 * IncomeProfile = {
 *   sources: [{ id, label, kind: 'salary'|'rent'|'interest'|'other', category, accountId, presence,
 *               cyclesPresent, cyclesSinceFirst, occurrences, dom, domIqr, expectedAmount,
 *               expectedNext: Date|null, lastReceived: Date, regular, share, total,
 *               timing: { typicalCycleDay, lateRisk, lateDelayP90, missingCycles: [], doubleCycles: [], lateCycles: [] } | null }],
 *   salary: { sourceIds, expectedAmount, expectedNext, typicalCycleDay, lateRisk, lateDelayP90,
 *             missingCycles, doubleCycles, lateCycles, lastReceived, cycles } | null,
 *   totalPerCycle,            // Σ expectedAmount over sources present in ≥ half their cycles
 *   sourceCount, hhi, stabilityScore, tone: 'good'|'warn'|'bad',
 *   interestIncome,           // small interest credits left out, summed over the window
 *   refundsRemoved, cycles: string[], assumptions: string[],
 * }
 */
