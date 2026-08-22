import {
  CARD_MINIMUM_FLOOR,
  CARD_MINIMUM_PCT_DEFAULT,
  DEFAULT_RATE_BY_KIND,
  FEE_MAX_AMOUNT,
  INSTALMENT_LOOKBACK_POSTINGS,
  INSTALMENT_PAIR_TOLERANCE,
  INSTALMENT_PAIR_WINDOW_DAYS,
  NCA_CAP_MARGIN,
  PRIME_REPO_SPREAD,
  RATE_MEDIAN_POSTINGS,
  RATE_STEP_MIN_PP,
  RATE_VARIABLE_MIN_PP,
  REGRESSION_MIN_POSTINGS,
  REGRESSION_MIN_R2,
  SELF_ANCHOR_MIN_DRAW,
  SELF_ANCHOR_MIN_MULTIPLE,
} from '../constants';
import { parseTransactionDate } from '../utils/date';
import { accountIdOf, parseAccount } from './accounts';
import { accountLabel } from '../db/accountIdentity';
import { dayOfMonthMode } from './cadence';
import { isCost } from './costOfDebt';
import { accountRows, positionAt, selfAnchored } from './ledger';
import { EMBEDDED_RE } from './recurring';
import { mad, median, mode, ols } from './stats';

/**
 * The liability terms ledger: what is owed, at what rate, what the instalment and the fixed fees
 * are, how long is left, and how sure the app is of each of those.
 *
 * None of it is in the export. A bank statement says "Interest −R21 358.62" and nothing about the
 * rate that produced it, so the rate has to be read back out of the postings: the interest a bank
 * charges for a posting period is the balance times the annual rate times the days in the period
 * over 365, and every one of those except the rate is in the rows once the balance is anchored.
 * Three of the four loans in the real data anchor themselves — the disbursement is the first row,
 * so the running position IS the balance — and for those the rate per posting is simply
 * 365·I/(days·B̄). The fourth was exported mid-life. It has no balance, but it does have twenty-five
 * postings, and interest per day is a straight line in the principal repaid so far; an ordinary
 * least-squares fit recovers both the rate (the slope) and the balance (where the line meets the
 * axis), and is only believed when R² ≥ 0.99 — a fit that is merely good is a rate that moved.
 *
 * Everything typed by the user wins over everything inferred, and the inferred figure is still
 * reported beside it so a disagreement can be shown rather than silently resolved. Nothing here
 * is ever written back to the account record; it is recomputed from the rows on every load.
 *
 * There is no prime rate in this module. A rate is "9.33%", never "prime − 1.17", unless the user
 * has typed what prime is, in which case `margin` is reported as well. Signs: `balanceOwed` is a
 * POSITIVE magnitude throughout; the account record's `currentBalance` is negative when owed, and
 * the conversion happens exactly once, at the boundary.
 */

const DAY_MS = 86400000;
const LIABILITY_TYPES = new Set(['Credit Card', 'Loan']);
const LOAN_KIND_BY_CATEGORY = {
  'Home Loan / Bond': 'bond',
  'Vehicle Loan / Car Loan': 'vehicle',
  'Personal Loan': 'personal',
};
const INTEREST_RE = /finance charge|interest/i;
const INITIATION_RE = /initiation/i;
const REBATE_RE = /rebate/i;
const BUDGET_INSTALMENT_RE = /budget (principal|facility) insta/i;
const BUDGET_INTEREST_RE = /budget finance charge|interest on budget/i;
const COVER_RE = /protection|death|disab|cpp|credit life|insurance/i;
const FEE_CATEGORIES = new Set(['Bank Charges', 'Other Insurance']);
const CLEAR_WITHIN = [6, 12, 24];
const USER_BALANCE_FRESH_DAYS = 60;
const CONFIDENCE_SPREAD_PP = 0.003;
/** An instalment that moves by less than this share is a premium wobble, not a recast worth listing. */
const RECAST_MIN_PCT = 0.005;

const dateOf = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
const cents = (x) => Math.round(Math.abs(x) * 100);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const pct = (rate) => `${(rate * 100).toFixed(2)}%`;

/** `dom` one calendar month after `d`, clamped to that month's length. */
function monthLater(d) {
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), lastDay));
}

/** Normalised fee label: lower-case, digits and bracketed balances stripped. */
function feeLabel(description) {
  return (description ?? '')
    .toLowerCase()
    .replace(/\(.*$/, '')
    .replace(/[\d.,*#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Annuity payment: B·r/(1 − (1+r)^−n); B/n at zero rate; 0 when n ≤ 0. */
export function annuity(balance, rM, n) {
  if (!(n > 0) || !(balance > 0)) return 0;
  if (!(rM > 0)) return balance / n;
  return (balance * rM) / (1 - (1 + rM) ** -n);
}

/** (1 + r/12)^12 − 1. */
function effectiveOf(rateNominal) {
  if (rateNominal == null || !Number.isFinite(rateNominal)) return null;
  return (1 + rateNominal / 12) ** 12 - 1;
}

// ---- step 1: classifying an account's rows ----------------------------------------------------

/**
 * Sort a liability's rows into what they do to the debt.
 *
 * @param rows     one account's rows (any order)
 * @param options  isCard: boolean; transfers: buildFullTransfers(data) (for reversal ids; optional)
 * @returns {{
 *   interest: row[],          // negative, Category 'Interest' or /finance charge|interest/i
 *   fees: row[],              // negative, < FEE_MAX_AMOUNT, a charge or cover sold inside the account
 *   initiation: row[],        // /initiation/i — listed, never recurring
 *   rebates: row[],           // positive /rebate/i
 *   draws: row[],             // negative ≥ max(SELF_ANCHOR_MIN_DRAW, 20 × median credit): disbursements
 *   budgetInstalments: row[], // cards: budget-facility instalments, either sign
 *   purchases: row[],         // every other negative — card spend, or a further advance on a loan
 *   refunds: row[],           // positive with a same-cents negative within ±INSTALMENT_PAIR_WINDOW_DAYS, or a reversal
 *   credits: row[],           // every other positive: repayments
 * }}
 */
export function classifyLiabilityRows(rows, { isCard = false, transfers = null } = {}) {
  const out = {
    interest: [],
    fees: [],
    initiation: [],
    rebates: [],
    draws: [],
    budgetInstalments: [],
    purchases: [],
    refunds: [],
    credits: [],
  };
  const sorted = (rows ?? []).filter(dateOf).sort((a, b) => dateOf(a) - dateOf(b));

  const isInterest = (t) => t.Category === 'Interest' || INTEREST_RE.test(t.Description ?? '');
  const isInitiation = (t) => INITIATION_RE.test(t.Description ?? '');
  const isFee = (t) =>
    Math.abs(t.AmountNum) < FEE_MAX_AMOUNT &&
    (FEE_CATEGORIES.has(t.Category) || isCost(t) || EMBEDDED_RE.test(t.Description ?? ''));
  const isBudgetInstalment = (t) => isCard && BUDGET_INSTALMENT_RE.test(t.Description ?? '');

  // Negatives that a refund can reverse: purchases and advances, never interest or a fee.
  const reversible = new Map();
  sorted.forEach((t) => {
    if (t.AmountNum >= 0 || isInterest(t) || isInitiation(t) || isFee(t) || isBudgetInstalment(t)) return;
    const key = cents(t.AmountNum);
    if (!reversible.has(key)) reversible.set(key, []);
    reversible.get(key).push(t);
  });

  const positives = sorted.filter((t) => t.AmountNum > 0);
  const usedReversals = new Set();
  positives.forEach((t) => {
    const desc = t.Description ?? '';
    if (isBudgetInstalment(t)) {
      out.budgetInstalments.push(t);
      return;
    }
    if (REBATE_RE.test(desc)) {
      out.rebates.push(t);
      return;
    }
    const reversal = transfers?.reversalIds?.has(t.id);
    const twin = (reversible.get(cents(t.AmountNum)) ?? []).find(
      (n) => !usedReversals.has(n) && Math.abs(daysBetween(dateOf(n), dateOf(t))) <= INSTALMENT_PAIR_WINDOW_DAYS,
    );
    if (reversal || twin) {
      if (twin) usedReversals.add(twin);
      out.refunds.push(t);
      return;
    }
    out.credits.push(t);
  });

  const typicalCredit = median(out.credits.map((t) => t.AmountNum));
  const drawThreshold = Math.max(SELF_ANCHOR_MIN_DRAW, SELF_ANCHOR_MIN_MULTIPLE * typicalCredit);

  sorted.forEach((t) => {
    if (t.AmountNum >= 0) return;
    if (isBudgetInstalment(t)) out.budgetInstalments.push(t);
    else if (isInterest(t)) out.interest.push(t);
    else if (isInitiation(t)) out.initiation.push(t);
    else if (isFee(t)) out.fees.push(t);
    else if (-t.AmountNum >= drawThreshold) out.draws.push(t);
    else out.purchases.push(t);
  });

  return out;
}

// ---- step 2: postings -------------------------------------------------------------------------

/**
 * Interest rows grouped by posting date. `days` = calendar days since the previous posting date
 * (null for the first, unless the caller sets `since` — the disbursement day of a self-anchored loan).
 * Several same-day rows collapse to one posting whose `interest` is their sum.
 *
 * @returns [{ date: Date, interest: number (positive), days: number|null, rows: row[] }]
 */
export function groupPostings(interestRows) {
  const byDay = new Map();
  (interestRows ?? []).forEach((t) => {
    const d = dateOf(t);
    if (!d) return;
    const key = midnight(d).getTime();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  });
  const postings = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, rows]) => ({
      date: new Date(time),
      interest: sum(rows.map((t) => -t.AmountNum)),
      days: null,
      rows,
    }));
  for (let i = 1; i < postings.length; i += 1) {
    postings[i].days = daysBetween(postings[i - 1].date, postings[i].date);
  }
  return postings;
}

// ---- steps 4 and 5: the rate -------------------------------------------------------------------

/**
 * Noise scale of a rate series: the MAD of its consecutive changes. A fixed-rate loan whose bank
 * rounds its accrual differently month to month wobbles by ±0.2pp and reverts; a bond whose rate
 * is cut moves once and stays. The first has a wide MAD of changes, the second a MAD of zero.
 */
function changeNoise(rates) {
  const diffs = [];
  for (let i = 1; i < rates.length; i += 1) diffs.push(rates[i] - rates[i - 1]);
  return diffs.length ? mad(diffs) : 0;
}

/**
 * Did the LEVEL move? The median of the last three postings against the median of the first
 * three of the window, beyond max(RATE_VARIABLE_MIN_PP, 3 × the noise of consecutive changes).
 */
function levelMoved(rates) {
  if (rates.length < 2) return false;
  const head = median(rates.slice(0, Math.min(3, Math.max(1, rates.length - 1))));
  const tail = median(rates.slice(-Math.min(3, rates.length)));
  return Math.abs(tail - head) > Math.max(RATE_VARIABLE_MIN_PP, 3 * changeNoise(rates));
}

/**
 * Rate per posting from the day count: rate_k = 365·I_k/(days_k·B̄_k) with B̄_k the mean of the
 * owed balance after the previous posting and before this one. Needs an anchored balance.
 *
 * @param postings       groupPostings(...)
 * @param balanceAround  (posting, previousPosting) → { after: owed after the previous posting's
 *                       day, before: owed before this posting's day }, positive magnitudes
 * @returns {{
 *   rateNominal: number|null,       // median of the last RATE_MEDIAN_POSTINGS rates
 *   rateEffective: number|null,
 *   history: [{ date, days, interest, balanceBefore, balanceAfterPrevious, balanceMean, rate }],
 *   variable: boolean,              // the level moved across the last 12 postings beyond the posting-to-posting noise
 *   spread: number|null,            // max − min of the last 6 rates
 *   spread3: number|null,           // max − min of the last 3 (confidence)
 *   postingsUsed: number,
 * }}
 */
export function inferRateByDayCount(postings, balanceAround) {
  const history = [];
  for (let k = 0; k < (postings?.length ?? 0); k += 1) {
    const posting = postings[k];
    const previous = postings[k - 1] ?? (posting.since ? { date: posting.since } : null);
    if (!previous || !posting.days) continue;
    const around = balanceAround(posting, previous);
    if (!around || !Number.isFinite(around.after) || !Number.isFinite(around.before)) continue;
    const balanceMean = (around.after + around.before) / 2;
    if (balanceMean <= 0) continue;
    history.push({
      date: posting.date,
      days: posting.days,
      interest: posting.interest,
      balanceBefore: around.before,
      balanceAfterPrevious: around.after,
      balanceMean,
      rate: (365 * posting.interest) / (posting.days * balanceMean),
    });
  }
  if (!history.length) {
    return { rateNominal: null, rateEffective: null, history, variable: false, spread: null, spread3: null, postingsUsed: 0 };
  }
  const rates = history.map((h) => h.rate);
  const rateNominal = median(rates.slice(-RATE_MEDIAN_POSTINGS));
  const spreadOf = (xs) => Math.max(...xs) - Math.min(...xs);
  const variable = levelMoved(rates.slice(-12));
  return {
    rateNominal,
    rateEffective: effectiveOf(rateNominal),
    history,
    variable,
    spread: spreadOf(rates.slice(-6)),
    spread3: spreadOf(rates.slice(-3)),
    postingsUsed: history.length,
  };
}

/**
 * Rate and balance from a straight-line fit of interest per day on the principal repaid so far.
 * y_k = I_k/days_k against x_k = C_{k−1}; slope = −r_d, so rateNominal = −365·slope and the balance
 * before posting k is y_k/r_d. Accepted only with ≥ REGRESSION_MIN_POSTINGS postings and
 * R² ≥ REGRESSION_MIN_R2.
 *
 * @param postings           groupPostings(...)
 * @param principalMovement  number[] aligned with postings: C_{k−1} = signed sum of every row
 *                           dated from the first posting up to (excluding) posting k's date
 * @returns {{ accepted: boolean, rateNominal: number|null, r2: number,
 *             points: [{ date, x, y }], impliedBalances: [{ date, balance }] }}
 */
export function inferRateByRegression(postings, principalMovement) {
  const points = [];
  (postings ?? []).forEach((p, k) => {
    if (k === 0 || !p.days) return;
    const x = principalMovement?.[k];
    if (!Number.isFinite(x)) return;
    points.push({ date: p.date, x, y: p.interest / p.days });
  });
  if (points.length < 2) return { accepted: false, rateNominal: null, r2: 0, points, impliedBalances: [] };
  const fit = ols(
    points.map((p) => p.x),
    points.map((p) => p.y),
  );
  const rDaily = -fit.slope;
  const usable = rDaily > 0;
  const accepted = usable && (postings?.length ?? 0) >= REGRESSION_MIN_POSTINGS && fit.r2 >= REGRESSION_MIN_R2;
  return {
    accepted,
    rateNominal: usable ? 365 * rDaily : null,
    r2: fit.r2,
    points,
    impliedBalances: usable ? points.map((p) => ({ date: p.date, balance: p.y / rDaily })) : [],
  };
}

// ---- step 8: the instalment --------------------------------------------------------------------

/** Consecutive runs of equal amounts, keyed by the cycle the run began in. */
function runsOf(observations) {
  const history = [];
  observations.forEach((o) => {
    const last = history[history.length - 1];
    if (last && cents(last.amount) === cents(o.amount)) last.count += 1;
    else history.push({ from: o.cycle, amount: o.amount, count: 1 });
  });
  return history;
}

/**
 * The contractual instalment of a loan, or the repayment habit of a card.
 *
 * Loans: credits that pair with a same-cents debit on a non-liability account within
 * ±INSTALMENT_PAIR_WINDOW_DAYS are the instalments; `amount` is the most recent paired credit
 * within ±INSTALMENT_PAIR_TOLERANCE of the median of the last INSTALMENT_LOOKBACK_POSTINGS, so a
 * recast that has only posted once is still believed. With nothing paired: the most recent credit
 * that repeats in the last six (`repeat`), else the latest credit (`latest`).
 *
 * @param rows     the liability's rows
 * @param data     every row (the paying side lives elsewhere)
 * @param options  isCard; transfers: buildFullTransfers(data); accountId; classes (optional,
 *                 classifyLiabilityRows output); liabilityNames: Set<rawName> of every liability
 *                 account, so a payment from another debt never counts as the paying leg
 * @returns {{
 *   amount: number|null, day: number|null, changed: boolean,
 *   history: [{ from: cycleKey, amount, count }],
 *   observations: [{ date: Date, amount: number, cycle: string }],
 *   payingAccountId: string|null, payingCategory: string|null,
 *   typicalRepayment: number|null, repaymentDay: number|null,   // cards
 *   source: 'paired'|'repeat'|'latest'|null,
 * }}
 */
export function inferInstalment(rows, data, { isCard = false, transfers = null, accountId = null, classes = null, liabilityNames = null } = {}) {
  const c = classes ?? classifyLiabilityRows(rows, { isCard, transfers });
  const empty = {
    amount: null,
    day: null,
    changed: false,
    history: [],
    observations: [],
    payingAccountId: null,
    payingCategory: null,
    typicalRepayment: null,
    repaymentDay: null,
    source: null,
  };

  if (isCard) {
    const id = accountId ?? accountIdOf(rows?.[0]?.Account);
    const repayments = (transfers?.cardRepayments ?? []).filter((r) => r.cardAccountId === id && r.creditDate);
    const cycles = [...new Set((data ?? []).map((t) => t['Pay Month']).filter(Boolean))].sort();
    const complete = cycles.slice(0, -1).slice(-6);
    const byCycle = new Map(complete.map((m) => [m, 0]));
    repayments.forEach((r) => {
      const m = r.credit['Pay Month'];
      if (byCycle.has(m)) byCycle.set(m, byCycle.get(m) + r.amount);
    });
    const perCycle = [...byCycle.values()];
    return {
      ...empty,
      typicalRepayment: perCycle.length ? median(perCycle) : null,
      repaymentDay: repayments.length ? dayOfMonthMode(repayments.map((r) => r.creditDate)) : null,
      observations: repayments.map((r) => ({ date: r.creditDate, amount: r.amount, cycle: r.credit['Pay Month'] })),
    };
  }

  const credits = [...c.credits].sort((a, b) => dateOf(a) - dateOf(b));
  if (!credits.length) return empty;

  const liabilities = liabilityNames ?? transfers?.loanAccounts ?? new Set();
  const isLiabilityName = (name) => liabilities.has(name) || LIABILITY_TYPES.has(parseAccount(name).type);
  const debitsByCents = new Map();
  (data ?? []).forEach((t) => {
    if (!(t.AmountNum < 0) || isLiabilityName(t.Account) || !dateOf(t)) return;
    const key = cents(t.AmountNum);
    if (!debitsByCents.has(key)) debitsByCents.set(key, []);
    debitsByCents.get(key).push(t);
  });

  const used = new Set();
  const paired = [];
  credits.forEach((credit) => {
    const candidates = (debitsByCents.get(cents(credit.AmountNum)) ?? [])
      .filter((d) => !used.has(d) && Math.abs(daysBetween(dateOf(d), dateOf(credit))) <= INSTALMENT_PAIR_WINDOW_DAYS)
      .sort((a, b) => Math.abs(daysBetween(dateOf(a), dateOf(credit))) - Math.abs(daysBetween(dateOf(b), dateOf(credit))));
    const debit = candidates[0];
    if (!debit) return;
    used.add(debit);
    paired.push({ credit, debit, date: midnight(dateOf(credit)), amount: credit.AmountNum, cycle: credit['Pay Month'] });
  });

  if (paired.length) {
    const lookback = paired.slice(-INSTALMENT_LOOKBACK_POSTINGS).map((p) => p.amount);
    const typical = median(lookback);
    const current =
      [...paired].reverse().find((p) => Math.abs(p.amount - typical) <= INSTALMENT_PAIR_TOLERANCE * typical) ??
      paired[paired.length - 1];
    const history = runsOf(paired);
    const latest = paired[paired.length - 1];
    return {
      amount: current.amount,
      day: dayOfMonthMode(paired.map((p) => p.date)),
      changed: history.length > 1,
      history,
      observations: paired.map(({ date, amount, cycle }) => ({ date, amount, cycle })),
      payingAccountId: accountIdOf(latest.debit.Account),
      payingCategory: latest.debit.Category ?? null,
      typicalRepayment: null,
      repaymentDay: null,
      source: 'paired',
    };
  }

  const observations = credits.map((t) => ({ date: midnight(dateOf(t)), amount: t.AmountNum, cycle: t['Pay Month'] }));
  const recent = observations.slice(-INSTALMENT_LOOKBACK_POSTINGS);
  const counts = new Map();
  recent.forEach((o) => counts.set(cents(o.amount), (counts.get(cents(o.amount)) ?? 0) + 1));
  const repeat = [...recent].reverse().find((o) => counts.get(cents(o.amount)) >= 2);
  const chosen = repeat ?? observations[observations.length - 1];
  const history = runsOf(observations);
  return {
    amount: chosen.amount,
    day: dayOfMonthMode(observations.map((o) => o.date)),
    changed: history.length > 1,
    history,
    observations,
    payingAccountId: null,
    payingCategory: null,
    typicalRepayment: null,
    repaymentDay: null,
    source: repeat ? 'repeat' : 'latest',
  };
}

// ---- step 9: fees --------------------------------------------------------------------------------

/**
 * Fixed monthly cost inside the account: the median, over the last six posting windows
 * (previous posting, this posting], of the fees charged in each; `items` lists each distinct fee
 * at its median amount; `initiationFee` is the once-off total.
 *
 * @returns {{ feeMonthly: number, items: [{ label, amount, count }], initiationFee: number }}
 */
export function inferFees(rows, postings, { classes = null } = {}) {
  const c = classes ?? classifyLiabilityRows(rows);
  const fees = [...c.fees].sort((a, b) => dateOf(a) - dateOf(b));
  const windows = [];
  const usable = (postings ?? []).filter((p) => p.days != null);
  usable.slice(-6).forEach((p) => {
    const k = postings.indexOf(p);
    const previous = postings[k - 1];
    const inWindow = fees.filter((t) => dateOf(t) > midnight(previous.date) && dateOf(t) <= midnight(p.date));
    windows.push(sum(inWindow.map((t) => -t.AmountNum)));
  });
  let feeMonthly;
  if (windows.length) {
    feeMonthly = median(windows);
  } else {
    // No posting windows (a card that never revolved): fall back to the last six complete cycles.
    const cycles = [...new Set(fees.map((t) => t['Pay Month']).filter(Boolean))].sort().slice(0, -1).slice(-6);
    feeMonthly = cycles.length ? median(cycles.map((m) => sum(fees.filter((t) => t['Pay Month'] === m).map((t) => -t.AmountNum)))) : 0;
  }

  const byLabel = new Map();
  fees.forEach((t) => {
    const label = feeLabel(t.Description) || (t.Category ?? 'fee').toLowerCase();
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(-t.AmountNum);
  });
  const items = [...byLabel.entries()]
    .map(([label, amounts]) => ({ label, amount: median(amounts), count: amounts.length }))
    .sort((a, b) => b.amount - a.amount);

  return { feeMonthly, items, initiationFee: sum(c.initiation.map((t) => -t.AmountNum)) };
}

// ---- step 10: the term ---------------------------------------------------------------------------

/**
 * Months to zero at the monthly rate r_m = rateNominal/12: −ln(1 − r_m·B/(P − f))/ln(1 + r_m).
 * Infinity when (instalment − fee) ≤ r_m × balance; balance/(instalment − fee) when the rate is 0;
 * 0 when nothing is owed.
 */
export function remainingTerm(balance, rateNominal, instalment, feeMonthly = 0) {
  if (!(balance > 0)) return 0;
  const net = (instalment ?? 0) - (feeMonthly ?? 0);
  if (!(net > 0)) return Infinity;
  const rM = (rateNominal ?? 0) / 12;
  if (rM <= 0) return balance / net;
  const x = (rM * balance) / net;
  if (x >= 1) return Infinity;
  return -Math.log(1 - x) / Math.log(1 + rM);
}

/** rateNominal + 12·feeMonthly/balanceOwed; null without a balance. */
export function feeAdjustedRate(terms) {
  if (!terms || terms.rateNominal == null) return null;
  if (!(terms.balanceOwed > 0)) return null;
  return terms.rateNominal + (12 * (terms.feeMonthly ?? 0)) / terms.balanceOwed;
}

/** Rand per month on top of the instalment to clear inside `months`: annuity + fee − instalment, floored at 0. */
export function extraToClearWithin(terms, months) {
  if (!terms || !(terms.balanceOwed > 0) || !(months > 0)) return null;
  const rM = (terms.rateNominal ?? 0) / 12;
  const needed = annuity(terms.balanceOwed, rM, months) + (terms.feeMonthly ?? 0);
  return Math.max(0, needed - (terms.instalment ?? 0));
}

// ---- step 15: rate steps ---------------------------------------------------------------------------

/**
 * Where the rate or the instalment moved, read off the posting history. A move counts when it
 * exceeds max(RATE_STEP_MIN_PP, 3 × the noise of consecutive changes) and the next posting
 * confirms it; a move on the latest posting is not yet a step. A rate move paired with an
 * instalment change within ±1 posting is a `rateStep`; an instalment change with the rate flat is
 * an `instalmentRecast`; a rate move with the instalment unchanged is a `termDrift` and carries
 * the remaining term it implies. Labelled "rate moved" — never "prime moved".
 *
 * @returns [{ id, date: Date, from, to, kind: 'rateStep'|'instalmentRecast'|'termDrift', remainingMonths? }]
 */
export function rateSteps(terms) {
  const history = terms?.rateHistory ?? [];
  if (history.length < 2) return [];
  const observations = terms.instalmentObservations ?? [];

  // The instalment in effect at each posting: the paired credit nearest that posting's date.
  const instalmentAt = history.map((h) => {
    let best = null;
    observations.forEach((o) => {
      const gap = Math.abs(daysBetween(o.date, h.date));
      if (gap <= 20 && (!best || gap < best.gap)) best = { gap, amount: o.amount };
    });
    return best?.amount ?? null;
  });
  const changeAt = (k) =>
    k > 0 && k < history.length && instalmentAt[k] != null && instalmentAt[k - 1] != null && cents(instalmentAt[k]) !== cents(instalmentAt[k - 1]);

  const steps = [];
  const consumed = new Set();
  const threshold = Math.max(RATE_STEP_MIN_PP, 3 * changeNoise(history.map((h) => h.rate)));
  // A move that the next posting does not confirm is a blip, not a step.
  const persists = (k) => k + 1 < history.length && Math.abs(history[k + 1].rate - history[k].rate) <= RATE_VARIABLE_MIN_PP;
  let regime = [history[0].rate];
  for (let k = 1; k < history.length; k += 1) {
    const reference = median(regime);
    const rate = history[k].rate;
    const jump = Math.abs(rate - reference);
    const entry = (kind, from, to, extra = {}) =>
      steps.push({ id: `${terms.accountId}|${history[k].date.toISOString().slice(0, 10)}|${kind}`, date: history[k].date, from, to, kind, ...extra });
    if (jump > threshold && persists(k)) {
      const near = [k - 1, k, k + 1].find((i) => changeAt(i) && !consumed.has(i));
      if (near != null) {
        consumed.add(near);
        entry('rateStep', reference, rate);
      } else {
        entry('termDrift', reference, rate, {
          remainingMonths: remainingTerm(terms.balanceOwed, rate, terms.instalment, terms.feeMonthly),
        });
      }
      regime = [rate];
      continue;
    }
    if (changeAt(k) && !consumed.has(k) && jump < RATE_VARIABLE_MIN_PP) {
      consumed.add(k);
      if (Math.abs(instalmentAt[k] - instalmentAt[k - 1]) >= RECAST_MIN_PCT * instalmentAt[k - 1]) {
        entry('instalmentRecast', instalmentAt[k - 1], instalmentAt[k]);
      }
    }
    regime.push(rate);
  }
  return steps;
}

// ---- cards -----------------------------------------------------------------------------------------

/**
 * What a card is costing: the rate floor its finance charges imply, a year of finance charges and
 * of cover, the budget instalment, and this month's minimum.
 *
 * @returns {{ rateLowerBound: number|null, finance12: number, ppi12: number, budgetInstalment: number|null, minimumNow: number|null }}
 */
export function cardCost(terms) {
  if (!terms) return { rateLowerBound: null, finance12: 0, ppi12: 0, budgetInstalment: null, minimumNow: null };
  const minimumPct = terms.minimumPct ?? CARD_MINIMUM_PCT_DEFAULT;
  return {
    rateLowerBound: terms.rateLowerBound ?? null,
    finance12: terms.finance12 ?? 0,
    ppi12: terms.ppi12 ?? 0,
    budgetInstalment: terms.budget?.instalment ?? null,
    minimumNow: terms.balanceOwed > 0 ? Math.max(CARD_MINIMUM_FLOOR, (minimumPct / 100) * terms.balanceOwed) : null,
  };
}

// ---- the simulator's input -------------------------------------------------------------------------

/**
 * The simulator's view of one liability; null when the balance is unknown.
 *
 * @returns {{ id, label, type, kind, balance (positive), rateNominal, rateVariable,
 *             instalment, feeMonthly, plannedPayment, minimumPct, creditLimit, balloon, termMonths,
 *             remainingMonths, confidence, source: { balance, rate, instalment }, assumptions: string[] }|null}
 */
export function toDebt(terms) {
  if (!terms || !Number.isFinite(terms.balanceOwed)) return null;
  const isCard = terms.type === 'Credit Card';
  return {
    id: terms.accountId,
    label: terms.label,
    type: terms.type,
    kind: terms.kind,
    balance: Math.max(0, terms.balanceOwed),
    rateNominal: terms.rateNominal,
    rateVariable: terms.rateVariable,
    instalment: isCard ? null : terms.instalment,
    feeMonthly: terms.feeMonthly ?? 0,
    plannedPayment: isCard ? terms.typicalRepayment : null,
    minimumPct: isCard ? terms.minimumPct ?? CARD_MINIMUM_PCT_DEFAULT : null,
    creditLimit: terms.creditLimit ?? null,
    balloon: terms.balloon ?? null,
    termMonths: terms.termMonths ?? null,
    remainingMonths: terms.remainingMonths,
    confidence: terms.confidence,
    source: { balance: terms.balanceSource, rate: terms.rateSource, instalment: terms.instalmentSource },
    assumptions: [...terms.assumptions],
  };
}

// ---- one account ------------------------------------------------------------------------------------

function kindOf(account, isCard, instalment, classes) {
  if (isCard) return 'card';
  const fromPaying = LOAN_KIND_BY_CATEGORY[instalment.payingCategory];
  if (fromPaying) return fromPaying;
  const drawCategory = mode(classes.draws.map((t) => t.Category).filter((c) => LOAN_KIND_BY_CATEGORY[c]));
  if (drawCategory) return LOAN_KIND_BY_CATEGORY[drawCategory];
  const name = `${account.statementName ?? ''} ${account.label ?? ''}`;
  if (/home loan|bond/i.test(name)) return 'bond';
  if (/vehicle|car|mazda|toyota|ford|vw|volkswagen|bmw|hyundai|kia|suzuki|nissan|honda/i.test(name)) return 'vehicle';
  if (/personal/i.test(name)) return 'personal';
  return 'loan';
}

function lastDateOf(rows) {
  let last = null;
  rows.forEach((t) => {
    const d = dateOf(t);
    if (d && (!last || d > last)) last = d;
  });
  return last;
}

function termsFor(account, data, { asOf, primeRate, transfers, liabilityNames, cycles }) {
  const isCard = account.type === 'Credit Card';
  const rows = accountRows(data, { accountId: account.id });
  const lastRowDate = lastDateOf(rows);
  const assumptions = [];
  const warnings = [];

  const classes = classifyLiabilityRows(rows, { isCard, transfers });
  const postings = groupPostings(classes.interest);
  // A loan that begins with its disbursement has a real window for its first posting too.
  const draw = isCard ? null : selfAnchored(rows);
  if (draw?.anchored && postings.length && postings[0].days == null && draw.disbursementDate < postings[0].date) {
    postings[0].days = daysBetween(draw.disbursementDate, postings[0].date);
    postings[0].since = draw.disbursementDate;
  }
  const instalment = inferInstalment(rows, data, { isCard, transfers, accountId: account.id, classes, liabilityNames });
  const fees = inferFees(rows, postings, { classes });

  // ---- balance: the loan's own ledger, else the typed or statement figure, else a regression ----
  let balanceOwed = null;
  let balanceSource = null;
  let balanceAsOf = null;
  let disbursementDate = null;
  let owedOffset = 0; // owed(date) = −positionAt(rows, date) + owedOffset
  const anchored = draw ?? { anchored: false };
  if (anchored.anchored) {
    balanceOwed = anchored.balanceOwed;
    balanceSource = 'ledger';
    balanceAsOf = lastRowDate;
    disbursementDate = anchored.disbursementDate;
  } else if (Number.isFinite(account.currentBalance)) {
    const at = account.balanceAsOf ? parseTransactionDate(account.balanceAsOf) : lastRowDate;
    owedOffset = -account.currentBalance + (at ? positionAt(rows, at) : 0);
    balanceOwed = lastRowDate ? -positionAt(rows, lastRowDate) + owedOffset : -account.currentBalance;
    balanceSource = account.source === 'statement' ? 'statement' : 'user';
    balanceAsOf = at ?? null;
    assumptions.push(
      `Balance ${balanceSource === 'statement' ? 'from your statement' : 'typed'}${balanceAsOf ? ` as of ${balanceAsOf.toISOString().slice(0, 10)}` : ''}`,
    );
  }
  if (anchored.anchored && Number.isFinite(account.currentBalance)) {
    const typed = -account.currentBalance;
    if (Math.abs(typed - balanceOwed) > 0.01 * Math.max(1, balanceOwed)) {
      warnings.push(`Typed balance differs from the loan's own ledger by ${fmt(typed - balanceOwed)}`);
    }
  }

  // ---- regression fallback: no balance, enough postings, instalment never changed ----
  let regression = null;
  if (!isCard && balanceOwed == null && postings.length >= REGRESSION_MIN_POSTINGS) {
    const first = midnight(postings[0].date);
    const sorted = [...rows].sort((a, b) => dateOf(a) - dateOf(b));
    const movement = postings.map((p) => {
      const until = midnight(p.date);
      return sum(sorted.filter((t) => dateOf(t) >= first && dateOf(t) < until).map((t) => t.AmountNum));
    });
    regression = inferRateByRegression(postings, movement);
    regression.accepted = regression.accepted && instalment.history.length <= 1;
    if (regression.accepted) {
      const last = regression.impliedBalances[regression.impliedBalances.length - 1];
      const lastPosting = midnight(postings[postings.length - 1].date);
      const since = sum(sorted.filter((t) => dateOf(t) >= lastPosting).map((t) => t.AmountNum));
      balanceOwed = last.balance - since;
      balanceSource = 'regression';
      balanceAsOf = lastRowDate;
      owedOffset = balanceOwed + positionAt(rows, lastRowDate);
      assumptions.push(`Balance fitted from ${postings.length} interest postings (R² ${regression.r2.toFixed(3)})`);
    }
  }

  const ledgerAt = (date, side) => {
    if (balanceOwed == null) return null;
    const at = side === 'before' ? addDays(midnight(date), -1) : midnight(date);
    return -positionAt(rows, at) + owedOffset;
  };

  // ---- rate ----
  const dayCount =
    balanceOwed != null && !isCard
      ? inferRateByDayCount(postings, (posting, previous) => ({
          after: ledgerAt(previous.date, 'after'),
          before: ledgerAt(posting.date, 'before'),
        }))
      : inferRateByDayCount([], () => null);
  const kind = kindOf(account, isCard, instalment, classes);

  let inferredRate = null;
  let rateSource = 'default';
  if (regression?.accepted) {
    inferredRate = regression.rateNominal;
    rateSource = 'regression';
  } else if (!isCard && dayCount.rateNominal != null) {
    inferredRate = dayCount.rateNominal;
    rateSource = 'inferred';
  }
  let rateNominal = inferredRate;
  if (rateSource === 'inferred') assumptions.push(`Rate inferred from ${postings.length} interest postings (ACT/365)`);
  if (rateSource === 'regression') assumptions.push(`Rate fitted, R² ${regression.r2.toFixed(3)}`);
  if (rateNominal == null) {
    rateNominal = DEFAULT_RATE_BY_KIND[kind] ?? DEFAULT_RATE_BY_KIND.loan;
    rateSource = 'default';
    assumptions.push(`${kindLabel(kind)} rate ${pct(rateNominal)} assumed — type the rate to replace it`);
  }
  if (Number.isFinite(account.interestRate)) {
    const typed = account.interestRate / 100;
    if (inferredRate != null && Math.abs(typed - inferredRate) > 0.01) {
      warnings.push(`Typed rate differs from the inferred ${pct(inferredRate)} by ${((typed - inferredRate) * 100).toFixed(2)} pp`);
    }
    rateNominal = typed;
    rateSource = 'user';
    assumptions.push(`Rate ${pct(typed)} typed by you`);
  }
  const rateVariable = dayCount.variable || (!isCard && instalment.changed);

  // ---- fees ----
  let feeMonthly = fees.feeMonthly;
  let feeSource = 'inferred';
  if (Number.isFinite(account.feesMonthly)) {
    if (Math.abs(account.feesMonthly - fees.feeMonthly) > 0.05 * Math.max(1, fees.feeMonthly)) {
      warnings.push(`Typed fees differ from the inferred ${fmt(fees.feeMonthly)} a month`);
    }
    feeMonthly = account.feesMonthly;
    feeSource = 'user';
    assumptions.push(`Fees ${fmt(feeMonthly)} a month typed by you`);
  }

  // ---- term ----
  const rM = rateNominal / 12;
  let remainingMonths = null;
  let neverClears = false;
  let minimumToClear = null;
  let termSource = 'inferred';
  if (!isCard && balanceOwed != null && instalment.amount != null) {
    remainingMonths = remainingTerm(balanceOwed, rateNominal, instalment.amount, feeMonthly);
    if (!Number.isFinite(remainingMonths) && balanceOwed > 0) {
      neverClears = true;
      minimumToClear = rM * balanceOwed + feeMonthly + 1;
    }
  }
  if (Number.isFinite(account.termMonths)) {
    remainingMonths = account.termMonths;
    termSource = 'user';
    neverClears = false;
    minimumToClear = null;
    assumptions.push(`${account.termMonths} months remaining, typed by you`);
  }
  const postingsSinceDisbursement = disbursementDate ? postings.filter((p) => p.date > disbursementDate).length : null;
  const totalTermMonths =
    anchored.anchored && Number.isFinite(remainingMonths) ? remainingMonths + postingsSinceDisbursement : null;
  const lastPostingDate = postings.length ? postings[postings.length - 1].date : null;
  const nextPostingDate = lastPostingDate ? monthLater(lastPostingDate) : null;
  const accruedThisCycle =
    balanceOwed != null && lastPostingDate ? (balanceOwed * rateNominal * daysBetween(lastPostingDate, nextPostingDate)) / 365 : null;

  // ---- cards ----
  let rateLowerBound = null;
  let financeChargeMonthly = null;
  let budget = null;
  let payInFull = null;
  let minimumPct = null;
  let finance12 = 0;
  let ppi12 = 0;
  if (isCard) {
    const last3 = postings.slice(-3).map((p) => p.interest);
    financeChargeMonthly = last3.length ? median(last3) : 0;
    if (balanceOwed > 0 && financeChargeMonthly > 0) rateLowerBound = (12 * financeChargeMonthly) / balanceOwed;
    const instalmentsByCycle = new Map();
    classes.budgetInstalments.forEach((t) => {
      const m = t['Pay Month'];
      instalmentsByCycle.set(m, (instalmentsByCycle.get(m) ?? 0) + Math.abs(t.AmountNum));
    });
    const budgetInterest = classes.interest.filter((t) => BUDGET_INTEREST_RE.test(t.Description ?? '')).map((t) => -t.AmountNum);
    budget = {
      instalment: instalmentsByCycle.size ? median([...instalmentsByCycle.values()]) : null,
      interestMonthly: budgetInterest.length ? median(budgetInterest) : null,
    };
    const recentCycles = cycles.slice(0, -1).slice(-6);
    const revolving = recentCycles.filter((m) => classes.interest.some((t) => t['Pay Month'] === m)).length;
    payInFull = !(revolving >= 3);
    minimumPct = Number.isFinite(account.minimumPayment) ? account.minimumPayment : CARD_MINIMUM_PCT_DEFAULT;
    if (!Number.isFinite(account.minimumPayment)) assumptions.push(`Card minimum ${CARD_MINIMUM_PCT_DEFAULT}% of the balance (default)`);
    finance12 = sum(postings.slice(-12).map((p) => p.interest));
    const cutoff = lastRowDate ? addDays(lastRowDate, -365) : null;
    ppi12 = sum(classes.fees.filter((t) => COVER_RE.test(t.Description ?? '') && (!cutoff || dateOf(t) > cutoff)).map((t) => -t.AmountNum));
    if (rateSource === 'default') assumptions.push('Card interest assumed on the whole balance — type the rate for a better figure');
  }

  // ---- NCA sanity and margin ----
  let margin = null;
  if (Number.isFinite(primeRate)) {
    const prime = primeRate / 100;
    margin = rateNominal - prime;
    const cap = prime - PRIME_REPO_SPREAD + (NCA_CAP_MARGIN[kind] ?? NCA_CAP_MARGIN.loan);
    if (rateNominal > cap) warnings.push(`Rate ${pct(rateNominal)} is above the NCA cap of ${pct(cap)} for a ${kindLabel(kind).toLowerCase()}`);
  }

  // ---- confidence ----
  const balanceAgeDays = balanceAsOf && asOf ? daysBetween(balanceAsOf, asOf) : null;
  const freshUserBalance = balanceSource === 'user' && balanceAgeDays != null && balanceAgeDays <= USER_BALANCE_FRESH_DAYS;
  if (balanceSource === 'user' && balanceAgeDays != null && balanceAgeDays > USER_BALANCE_FRESH_DAYS) {
    warnings.push(`Balance typed ${balanceAgeDays} days ago — re-enter it for a current figure`);
  }
  let confidence = 'low';
  if (
    !isCard &&
    postings.length >= 6 &&
    (balanceSource === 'ledger' || balanceSource === 'statement' || freshUserBalance) &&
    dayCount.spread3 != null &&
    dayCount.spread3 <= CONFIDENCE_SPREAD_PP &&
    rateSource !== 'default' &&
    instalment.source !== 'latest'
  ) {
    confidence = 'high';
  } else if (
    !isCard &&
    rateSource !== 'default' &&
    instalment.source !== 'latest' &&
    postings.length >= 3 &&
    (regression?.accepted || balanceSource === 'ledger' || balanceSource === 'statement' || balanceSource === 'user')
  ) {
    confidence = 'medium';
  }

  const terms = {
    accountId: account.id,
    label: accountLabel(account),
    type: account.type,
    kind,
    external: Boolean(account.external) || rows.length === 0,
    hidden: Boolean(account.hidden),
    balanceOwed,
    balanceSource,
    balanceAsOf,
    rateNominal,
    rateEffective: effectiveOf(rateNominal),
    rateSource,
    rateInferred: inferredRate,
    rateVariable,
    margin,
    rateHistory: dayCount.history,
    rateSpread: dayCount.spread,
    rateLowerBound,
    regression: regression ? { accepted: regression.accepted, r2: regression.r2, rateNominal: regression.rateNominal } : null,
    instalment: isCard ? null : instalment.amount,
    instalmentSource: instalment.source,
    instalmentChanged: instalment.changed,
    instalmentDay: instalment.day,
    instalmentHistory: instalment.history,
    instalmentObservations: instalment.observations,
    payingAccountId: instalment.payingAccountId,
    payingCategory: instalment.payingCategory,
    typicalRepayment: instalment.typicalRepayment,
    repaymentDay: instalment.repaymentDay,
    feeMonthly,
    feeSource,
    feeItems: fees.items,
    initiationFee: fees.initiationFee,
    feeAdjustedRate: null,
    extraToClearWithin: {},
    minimumPct,
    budget,
    payInFull,
    financeChargeMonthly,
    finance12,
    ppi12,
    creditLimit: account.creditLimit ?? null,
    balloon: account.balloon ?? null,
    termMonths: account.termMonths ?? null,
    termSource,
    remainingMonths,
    totalTermMonths,
    neverClears,
    minimumToClear,
    disbursementDate,
    lastPostingDate,
    nextPostingDate,
    accruedThisCycle,
    postings: postings.length,
    confidence,
    warnings,
    assumptions,
  };
  terms.feeAdjustedRate = feeAdjustedRate(terms);
  terms.extraToClearWithin = Object.fromEntries(CLEAR_WITHIN.map((n) => [n, extraToClearWithin(terms, n)]));
  return terms;
}

function kindLabel(kind) {
  return { bond: 'Bond', vehicle: 'Vehicle loan', personal: 'Personal loan', card: 'Card', loan: 'Loan' }[kind] ?? 'Loan';
}

function fmt(x) {
  const n = Math.round(Math.abs(x));
  return `${x < 0 ? '−' : ''}R${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/**
 * Terms for every liability account.
 *
 * @param data      every row (all accounts)
 * @param accounts  AccountRecord[] — every account; only Credit Card / Loan (after typeOverride) are read, external ones included
 * @param options   asOf: Date; primeRate: number|null (percentage, from settings); transfers: buildFullTransfers(data)
 * @returns LiabilityTerms[] sorted by balanceOwed desc (unknown balances last):
 * {
 *   accountId, label, type, kind: 'bond'|'vehicle'|'personal'|'card'|'loan', external, hidden,
 *   balanceOwed: number|null (positive), balanceSource: 'ledger'|'statement'|'user'|'regression'|null, balanceAsOf: Date|null,
 *   rateNominal, rateEffective, rateSource: 'user'|'inferred'|'regression'|'default', rateInferred: number|null,
 *   rateVariable, margin: number|null, rateHistory: [{ date, days, interest, balanceBefore, balanceAfterPrevious, balanceMean, rate }],
 *   rateSpread, rateLowerBound (cards), regression: { accepted, r2, rateNominal }|null,
 *   instalment, instalmentSource: 'paired'|'repeat'|'latest'|null, instalmentChanged, instalmentDay,
 *   instalmentHistory: [{ from, amount, count }], instalmentObservations: [{ date, amount, cycle }],
 *   payingAccountId, payingCategory, typicalRepayment, repaymentDay,
 *   feeMonthly, feeSource: 'inferred'|'user', feeItems: [{ label, amount, count }], initiationFee,
 *   feeAdjustedRate, extraToClearWithin: { 6, 12, 24 },
 *   minimumPct, budget: { instalment, interestMonthly }|null, payInFull, financeChargeMonthly, finance12, ppi12,
 *   creditLimit, balloon, termMonths, termSource: 'inferred'|'user',
 *   remainingMonths: number|Infinity|null, totalTermMonths, neverClears, minimumToClear,
 *   disbursementDate, lastPostingDate, nextPostingDate, accruedThisCycle,
 *   postings, confidence: 'high'|'medium'|'low', warnings: string[], assumptions: string[],
 * }
 */
export function buildLiabilityTerms(data, accounts, { asOf = null, primeRate = null, transfers = null } = {}) {
  const rows = data ?? [];
  const liabilities = (accounts ?? []).filter((a) => LIABILITY_TYPES.has(a.typeOverride ?? a.type));
  const liabilityIds = new Set(liabilities.map((a) => a.id));
  const liabilityNames = new Set();
  new Set(rows.map((t) => t.Account)).forEach((name) => {
    if (liabilityIds.has(accountIdOf(name)) || LIABILITY_TYPES.has(parseAccount(name).type)) liabilityNames.add(name);
  });
  if (transfers?.loanAccounts) transfers.loanAccounts.forEach((name) => liabilityNames.add(name));
  const cycles = [...new Set(rows.map((t) => t['Pay Month']).filter(Boolean))].sort();

  return liabilities
    .map((account) =>
      termsFor({ ...account, type: account.typeOverride ?? account.type }, rows, { asOf, primeRate, transfers, liabilityNames, cycles }),
    )
    .sort((a, b) => {
      const ka = a.balanceOwed == null ? -Infinity : a.balanceOwed;
      const kb = b.balanceOwed == null ? -Infinity : b.balanceOwed;
      return kb - ka;
    });
}
