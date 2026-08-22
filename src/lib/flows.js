import { addMonthsToKey } from './effectivePayMonth';
import { parseMonthKey, parseTransactionDate } from '../utils/date';
import { accountIdOf, parseAccount } from './accounts';
import { spendingGroupOf, TRANSFER_SPENDING_GROUP } from './spendingGroups';
import { detectTransferPairs, isInternalMovementCategory } from './transfers';

/**
 * The one spend/income filter, and the transfer set over the WHOLE file.
 *
 * processTransactionData classifies transfers inside the visible window, which is right for the
 * table — a pair whose other leg is outside the window genuinely looks like a single leg there.
 * It is wrong for anything that reads further back: run over six cycles, `processed.transferIds`
 * leaves 213 rows and R2.72M of historical card repayments unlabelled, and a recurring-charge
 * engine that read them would report the largest subscription in the house as "Nedbank card, every
 * month". So every module that looks beyond `processed.months` takes its transfers from here,
 * built with the same three rules the pipeline applies (pairs, the export's own Transfer label
 * corroborated by the category, and loan pairs released back to spend) but with every Pay Month in
 * the file visible.
 *
 * The filters that follow are the same test `habits.js` and the pipeline apply, written once so
 * that "spend" means the same rows in every view: money out, not on a loan account, not a transfer
 * leg, not a category the export itself calls a movement.
 *
 * Account TYPES are resolved through the account records when they are given, so a user who has
 * overridden "FNB Bank *1143" to a Loan sees it treated as one here too.
 */

const LIQUID = new Set(['Bank', 'Savings']);

const dateOf = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Effective type of a raw account name: the record's override when records are given, else parsed. */
function makeTypeResolver(accounts) {
  const byId = new Map((accounts ?? []).map((a) => [a.id, a]));
  const cache = new Map();
  return (rawName) => {
    if (cache.has(rawName)) return cache.get(rawName);
    const record = byId.size ? byId.get(accountIdOf(rawName)) : null;
    const type = record?.typeOverride ?? parseAccount(rawName).type;
    cache.set(rawName, type);
    return type;
  };
}

/** parseAccount's type, overridden by the matching AccountRecord's `typeOverride` when records are given. */
export function accountTypeOf(rawName, accounts = null) {
  return makeTypeResolver(accounts)(rawName);
}

/** Raw names of Loan accounts: parseAccount type, overridden by an AccountRecord.typeOverride when records are given. */
export function loanAccountsOf(data, accounts = null) {
  const typeOf = makeTypeResolver(accounts);
  const loans = new Set();
  new Set((data ?? []).map((t) => t.Account)).forEach((name) => {
    if (typeOf(name) === 'Loan') loans.add(name);
  });
  return loans;
}

/**
 * Transfer classification over EVERY cycle in the file — the three rules processTransactionData
 * applies, run with visibleMonths = every Pay Month in `data`:
 *   1. detectTransferPairs(data, allMonths) → paired ids (cross-account, reversals,
 *      budget-facility groups, description regex)
 *   2. plus rows whose Spending Group is 'Transfer' AND isInternalMovementCategory(Category)
 *   3. minus every leg of a pair that touches a Loan account (the paying leg is real spend)
 *
 * @returns {{
 *   transferIds: Set<id>, reversalIds: Set<id>,
 *   pairs: object[],                 // pairs not touching a loan, as detectTransferPairs returns them
 *   loanPairs: object[],             // pairs touching a loan
 *   loanInstalmentIds: Set<id>,      // the non-loan legs of loanPairs
 *   cardRepayments: [{ credit, debit, cardAccountId, payingAccountId, amount, date, creditDate }],
 *                                    // pairs with a Credit Card credit and a Bank/Savings debit;
 *                                    // `date` is the DEBIT's (when cash left the bank), ascending
 *   loanAccounts: Set<rawName>,
 *   allMonths: string[],             // every raw Pay Month, ascending
 * }}
 */
export function buildFullTransfers(data, { accounts = null } = {}) {
  const rows = data ?? [];
  const allMonths = [...new Set(rows.map((t) => t['Pay Month']))].filter(Boolean).sort();
  const { transferIds: paired, pairs, reversalIds } = detectTransferPairs(rows, allMonths);
  const transferIds = new Set(paired);
  rows.forEach((t) => {
    if (spendingGroupOf(t) === TRANSFER_SPENDING_GROUP && isInternalMovementCategory(t.Category)) {
      transferIds.add(t.id);
    }
  });

  const typeOf = makeTypeResolver(accounts);
  const loanAccounts = loanAccountsOf(rows, accounts);
  const touchesLoan = (pair) => loanAccounts.has(pair.toAccount) || loanAccounts.has(pair.fromAccount);
  const loanPairs = pairs.filter(touchesLoan);
  const transferPairs = pairs.filter((pair) => !touchesLoan(pair));

  const loanInstalmentIds = new Set();
  loanPairs.forEach((pair) =>
    pair.items.forEach((t) => {
      transferIds.delete(t.id);
      if (!loanAccounts.has(t.Account)) loanInstalmentIds.add(t.id);
    }),
  );

  const cardRepayments = [];
  transferPairs.forEach((pair) => {
    if (pair.isReversal) return;
    if (typeOf(pair.toAccount) !== 'Credit Card' || !LIQUID.has(typeOf(pair.fromAccount))) return;
    pair.matches.forEach(({ credit, debit }) => {
      cardRepayments.push({
        credit,
        debit,
        cardAccountId: accountIdOf(credit.Account),
        payingAccountId: accountIdOf(debit.Account),
        amount: Math.abs(credit.AmountNum),
        date: dateOf(debit),
        creditDate: dateOf(credit),
      });
    });
  });
  cardRepayments.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

  return {
    transferIds,
    reversalIds,
    pairs: transferPairs,
    loanPairs,
    loanInstalmentIds,
    cardRepayments,
    loanAccounts,
    allMonths,
  };
}

/**
 * AmountNum < 0, not on a loan account, not a transfer leg, Category not /transfer|repayment/i;
 * `selected` (raw names) and `visible` (Pay Month keys) are optional Sets that narrow further.
 * `loanAccounts` defaults to the transfer set's own.
 */
export function isSpendRow(t, { transfers, loanAccounts, selected = null, visible = null }) {
  const loans = loanAccounts ?? transfers?.loanAccounts;
  return (
    t.AmountNum < 0 &&
    !(loans && loans.has(t.Account)) &&
    !(transfers && transfers.transferIds.has(t.id)) &&
    !isInternalMovementCategory(t.Category) &&
    (!selected || selected.has(t.Account)) &&
    (!visible || visible.has(t['Pay Month']))
  );
}

/** AmountNum > 0 with the same exclusions as isSpendRow. */
export function isIncomeRow(t, { transfers, loanAccounts, selected = null, visible = null }) {
  const loans = loanAccounts ?? transfers?.loanAccounts;
  return (
    t.AmountNum > 0 &&
    !(loans && loans.has(t.Account)) &&
    !(transfers && transfers.transferIds.has(t.id)) &&
    !isInternalMovementCategory(t.Category) &&
    (!selected || selected.has(t.Account)) &&
    (!visible || visible.has(t['Pay Month']))
  );
}

function context(data, { transfers, accounts = null, selectedAccounts = null, months = null }) {
  return {
    transfers,
    loanAccounts: transfers?.loanAccounts ?? loanAccountsOf(data, accounts),
    selected: selectedAccounts ? new Set(selectedAccounts) : null,
    visible: months ? new Set(months) : null,
  };
}

/**
 * @param data  every row
 * @param opts  transfers: buildFullTransfers(data); accounts: AccountRecord[] (type overrides);
 *              selectedAccounts: raw names to keep; months: Pay Month keys to keep
 */
export function spendRows(data, opts) {
  const ctx = context(data, opts);
  return (data ?? []).filter((t) => isSpendRow(t, ctx));
}

export function incomeRows(data, opts) {
  const ctx = context(data, opts);
  return (data ?? []).filter((t) => isIncomeRow(t, ctx));
}

/** Cycle keys whose end date ≤ calendar.dataThrough and that are not isPartial, ascending. */
export function completeMonths(calendar) {
  if (!calendar?.dataThrough || !calendar.starts) return [];
  const through = midnight(calendar.dataThrough);
  return Object.keys(calendar.starts)
    .sort()
    .filter((m) => !calendar.isPartial[m] && calendar.ends[m] && midnight(calendar.ends[m]) <= through);
}

/** The last complete cycle key, or null. */
export function lastCompleteMonth(calendar) {
  const complete = completeMonths(calendar);
  return complete.length ? complete[complete.length - 1] : null;
}

/** The day a cycle starts under the calendar's boundary rule, for any key — past, present or future. */
function startFor(key, calendar) {
  const { year, monthIndex } = parseMonthKey(key);
  const m = monthIndex + (calendar.startMonthOffset ?? 0);
  const lastDay = new Date(year, m + 1, 0).getDate();
  return new Date(year, m, Math.min(calendar.boundaryDom ?? 1, lastDay));
}

/**
 * Start and inclusive end of a cycle. Cycles the calendar observed keep their observed bounds
 * (a partial first cycle starts where its data starts); anything beyond is extrapolated with the
 * boundary rule, which is how the calendar itself closes the in-progress cycle.
 */
export function cycleBoundsOf(key, calendar) {
  if (!calendar?.starts) return null;
  if (calendar.starts[key]) return { start: calendar.starts[key], end: calendar.ends[key] };
  const start = startFor(key, calendar);
  const next = startFor(addMonthsToKey(key, 1), calendar);
  return { start, end: new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1) };
}

/**
 * The cycle key a date falls in: the observed cycle whose span holds it, else — for dates after
 * the last observed cycle — the key the boundary rule assigns. Dates before the first observed
 * cycle return null. This is how "due next cycle" is decided for a charge expected after the
 * calendar runs out.
 */
export function cycleKeyOf(date, calendar) {
  if (!date || !calendar?.starts) return null;
  const d = midnight(date);
  const keys = Object.keys(calendar.starts).sort();
  if (!keys.length) return null;
  for (const m of keys) {
    if (d >= calendar.starts[m] && d <= calendar.ends[m]) return m;
  }
  if (d < calendar.starts[keys[0]]) return null;
  let key = keys[keys.length - 1];
  // Bounded walk: a date centuries out is a bug, not a cycle.
  for (let i = 0; i < 1200; i += 1) {
    const nextKey = addMonthsToKey(key, 1);
    if (d < startFor(nextKey, calendar)) return key;
    key = nextKey;
  }
  return key;
}
