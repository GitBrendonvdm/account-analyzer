import { LOAN_CATEGORIES } from '../constants';
import { accountIdOf, parseAccount } from './accounts';
import { buildLiabilityTerms } from './inferRates';
import { accountRows, balanceAt, positionAt } from './ledger';
import { payMonthRuleOf } from './loanProjection';

/**
 * Accounts that look finished.
 *
 * When a household clears a debt or closes an account, nothing in the bank's data says so. The
 * history just stops, and the app carries on expecting the car's instalment, the old card's
 * minimum, a balance it never learned. This looks for the two ways the end shows itself, and only
 * SUGGESTS — closing an account changes what is expected of it, so the reader confirms.
 *
 *   PAID OFF — a loan or card whose estimated balance (see loanProjection.js) is matched, within
 *     fifteen percent, by one large payment out of another account in the last two months, worded
 *     like a settlement ("CAR PAYOFF", "SETTLEMENT") or like a transfer. The estimate and the
 *     payment are independent, so agreement between them is real evidence; the date of that
 *     payment is when it closed.
 *   IDLE — no row for a month or more while the rest of the data carries on, no payment still
 *     arriving, and no balance of any size recorded. The account's last row is when it ended.
 *
 * What it never suggests: an external account (it has no rows to go quiet), one already closed or
 * dismissed, an account that holds money, or one that is still being paid.
 *
 * WHATEVER IS CLOSED WORKS OUT TO NOTHING. A closed account has no balance, so closing it records the
 * one transaction that makes that true — a payment in for a debt, a withdrawal out for money held
 * (`settlementFor`). Without it, stating a zero balance on the closing day would re-base every earlier
 * month and the debt would look as if it had never been owed; with it, history stays as it was and
 * the account ends at exactly nothing, from either side.
 */

const DAY_MS = 86400000;
const IDLE_DAYS = 30;
const EVIDENCE_DAYS = 60;
const MATCH_RATIO = 0.15;
const MIN_PAYOFF = 1000;
const SETTLEMENT = /pay.?off|settle|transfer|\btran\b|1sa|1bb|close/i;

const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const typeOf = (account) => account?.typeOverride ?? account?.type ?? parseAccount(account?.rawName).type;

/**
 * @param accounts   the account records
 * @param stored     the stored rows (not the estimated ones)
 * @param inferred   loanProjection's summary — what each projected loan is estimated to owe
 * @param dismissed  account ids the reader has said are not finished
 * @param data       every row including the estimated ones, to say what closing would record
 * @param owed       loanOwedBy(data, accounts), for the loans whose own ledger does not say what is owed
 * @returns {{ accountId, label, kind: 'paid-off'|'idle', closedOn: string, reason: string,
 *             evidence: { date, amount, description }|null, settlement: number }[]}  paid-off first;
 *   `settlement` is what closing on `closedOn` would record to take the account to nothing
 */
export function closureSuggestions({ accounts, stored, inferred = [], dismissed = [], data = null, owed = null }) {
  if (!stored?.length) return [];
  const dataThrough = stored.reduce((max, t) => (t.Date > max ? t.Date : max), '');
  if (!dataThrough) return [];
  const through = dayNumber(dataThrough);

  const lastOf = new Map();
  stored.forEach((t) => {
    const id = accountIdOf(t.Account);
    if (!lastOf.has(id) || t.Date > lastOf.get(id)) lastOf.set(id, t.Date);
  });
  const loanIds = new Set(accounts.filter((a) => typeOf(a) === 'Loan').map((a) => a.id));
  const estimate = new Map(inferred.map((l) => [l.accountId, l]));
  const skip = new Set(dismissed);

  const out = [];
  accounts.forEach((account) => {
    if (account.external || account.closedOn || skip.has(account.id)) return;
    const last = lastOf.get(account.id);
    if (!last) return;
    const label = account.label || account.rawName;
    const liability = typeOf(account) === 'Loan' || typeOf(account) === 'Credit Card';

    // ---- paid off: the estimate meets a payment ------------------------------------------
    const owed = estimate.get(account.id)?.owed;
    if (liability && owed > MIN_PAYOFF) {
      const candidates = stored
        .filter(
          (t) =>
            t.AmountNum < 0 &&
            !loanIds.has(accountIdOf(t.Account)) &&
            accountIdOf(t.Account) !== account.id &&
            through - dayNumber(t.Date) <= EVIDENCE_DAYS &&
            -t.AmountNum >= MIN_PAYOFF &&
            Math.abs(-t.AmountNum - owed) / owed <= MATCH_RATIO &&
            SETTLEMENT.test(t.Description ?? ''),
        )
        .sort((a, b) => Math.abs(-a.AmountNum - owed) - Math.abs(-b.AmountNum - owed));
      const hit = candidates[0];
      if (hit) {
        out.push({
          accountId: account.id,
          label,
          kind: 'paid-off',
          closedOn: hit.Date,
          reason: `a payment of ${Math.round(-hit.AmountNum).toLocaleString('en-ZA')} on ${hit.Date} matches what it was estimated to owe`,
          evidence: { date: hit.Date, amount: -hit.AmountNum, description: hit.Description },
        });
        return;
      }
    }

    // ---- idle: it went quiet and nothing is still arriving ---------------------------------
    const stillPaid = estimate.has(account.id) && estimate.get(account.id).payments > 0;
    const holds = Number.isFinite(account.currentBalance) && Math.abs(account.currentBalance) >= 1;
    if (through - dayNumber(last) >= IDLE_DAYS && !stillPaid && !holds) {
      out.push({
        accountId: account.id,
        label,
        kind: 'idle',
        closedOn: last,
        reason: `no activity since ${last}`,
        evidence: null,
      });
    }
  });

  const monthOf = payMonthRuleOf(stored);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  out.forEach((s) => {
    s.settlement = data ? (settlementFor({ account: byId.get(s.accountId), data, closedOn: s.closedOn, payMonthOf: monthOf, owed: owed?.get(s.accountId) })?.amount ?? 0) : 0;
  });
  return out.sort((a, b) => (a.kind === b.kind ? (a.label < b.label ? -1 : 1) : a.kind === 'paid-off' ? -1 : 1));
}

const LOAN_CATEGORY_SET = new Set(LOAN_CATEGORIES);
const round2 = (n) => Math.round(n * 100) / 100;

/** The category a loan's own payments are filed under: the one they have always been. */
function loanCategoryOf(rows) {
  const counts = new Map();
  rows.forEach((t) => {
    if (t.AmountNum > 0 && LOAN_CATEGORY_SET.has(t.Category)) counts.set(t.Category, (counts.get(t.Category) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Personal Loan';
}

/**
 * What each loan owes, by the loan engine's reckoning (its own ledger, a statement, a typed balance, or
 * a fit to its interest postings — whichever it trusted, estimated rows included). A loan exported
 * mid-life has a ledger that only adds up to what has been repaid since, so the engine is the one to ask.
 *
 * @returns {Map<string, number>} account id → amount owed, positive
 */
export function loanOwedBy(data, accounts) {
  return new Map(
    buildLiabilityTerms(data, accounts, { asOf: new Date() })
      .filter((t) => Number.isFinite(t.balanceOwed))
      .map((t) => [t.accountId, t.balanceOwed]),
  );
}

/**
 * The transaction that takes an account to exactly nothing on `closedOn`, or null if it is there already.
 *
 * What the account holds on that day is read the way the ledger reads it: its stated balance if it has
 * one (the figure it had BEFORE it was closed, if it is being re-closed); for a loan without one, what
 * the loan engine says is owed (`owed`); otherwise what its rows add up to — the app's convention that
 * an account starts at nothing on its first row.
 * The amount is the opposite of that, so a debt gets a payment in and a cheque or savings account that
 * holds money gets the same money out. Filed as a movement between your own accounts, so it is not
 * mistaken for income or for spending.
 *
 * @returns {{ amount, description, category, group, payMonth }|null}
 */
export function settlementFor({ account, data, closedOn, payMonthOf, owed = null }) {
  if (!account || !closedOn) return null;
  const before = account.closedOn
    ? { ...account, currentBalance: account.preClosure?.currentBalance ?? null, balanceAsOf: account.preClosure?.balanceAsOf ?? null }
    : account;
  const rows = accountRows(data, { accountId: account.id }).filter((t) => t.Source !== 'settlement');
  const type = typeOf(account);
  const stated = Number.isFinite(before.currentBalance);
  const held = stated
    ? balanceAt(rows, before, closedOn)
    : type === 'Loan' && Number.isFinite(owed)
      ? -owed
      : positionAt(rows, closedOn);
  const amount = round2(-held);
  if (Math.abs(amount) < 0.01) return null;

  const liability = type === 'Loan' || type === 'Credit Card';
  const paidOff = liability && amount > 0;
  return {
    amount,
    description: paidOff
      ? 'Paid off — recorded when the account was closed'
      : 'Closed — balance cleared when the account was closed',
    category: type === 'Loan' && paidOff ? loanCategoryOf(rows) : type === 'Credit Card' && paidOff ? 'Credit Card Repayment' : 'Transfer',
    group: type === 'Loan' ? 'Debt' : 'Transfer',
    payMonth: (payMonthOf ?? payMonthRuleOf(data))(closedOn),
  };
}

