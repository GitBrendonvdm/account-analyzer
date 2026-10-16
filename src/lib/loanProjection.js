import { parseTransactionDate } from '../utils/date';
import { accountIdOf, parseAccount } from './accounts';
import { buildLiabilityTerms } from './inferRates';
import { accountRows } from './ledger';

/**
 * Loans you no longer have to upload.
 *
 * A bank statement for a bond or a car loan is a record of three things — the instalment arriving,
 * the interest the lender charged, and a monthly fee — and once the app has seen a few months of
 * them it knows the loan: its rate, its instalment, the day it posts. What it does not have, month
 * after month, is the loan's own file. But the PAYMENT is in the cheque account's history, which is
 * uploaded anyway, and the interest and the fee are arithmetic the app can do.
 *
 * So after a loan's last real row, this writes the rows the loan would have shown:
 *
 *   - each payment it can see leaving another account, as the instalment arriving;
 *   - each posting day, the interest the balance would have attracted at the rate learned from the
 *     loan's own history, day by day (the balance moves when a payment lands, so the interest does);
 *   - the monthly fee the loan has always charged.
 *
 * They are marked `inferred` and carry Status "Inferred", and they are made on every load from rows
 * that stay put — nothing is stored. The day the loan's own file (or a statement) is imported, its
 * real rows are the last real row and the estimate before them is simply no longer written. A balance
 * typed or read off a statement does the same: the projection starts from wherever the account was
 * last stated.
 *
 * WHAT IT WILL NOT GUESS.
 *   - A loan whose rate is only a default is not projected: interest at a made-up rate is worse than
 *     a balance that says "as of the last time I knew".
 *   - A loan with no posting day (no interest ever seen) is not projected; there is nothing to step from.
 *   - A closed account is not projected.
 *   - Time the paying account has not reached. The projection stops where the feed that carries the
 *     payments stops, so a month whose cheque history has not been uploaded yet is not charged
 *     interest with no payment against it.
 *
 * MATCHING A PAYMENT TO A LOAN. The loan's own history says which debits on other accounts were its
 * instalments (same amount to the cent within three days), and what those debits were CALLED —
 * reduced to the words that name the payee ("fnb home", "toyota fin"), because the reference digits
 * change every month and the bank's wording differs from the aggregator's. A new debit with that
 * name is that loan's payment. A loan with no history of being paid from an account the app holds
 * (the bond that was paid from an account since closed) falls back to the amount: a debit equal to
 * the loan's instalment, near its usual day. A debit that two loans could claim is left alone.
 *
 * The estimate is an estimate, and says so: every row says "(estimated)" and `summary` carries
 * what was assumed, so the app can show it next to the figure.
 */

const DAY_MS = 86400000;
const PAIR_DAYS = 3;
// An instalment repeats to the cent; a round transfer that happens to be near it (R5 000 against R4 990.67) must not be taken for one.
const AMOUNT_TOLERANCE = 0.0005;
const AMOUNT_FLOOR = 1;
const MAX_MONTHS = 36;
const MIN_SIGNATURE_SHARE = 0.6;

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const cents = (n) => Math.round((Number(n) || 0) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const daysBetween = (a, b) => Math.round((midnight(b) - midnight(a)) / DAY_MS);
const typeOf = (account) => account?.typeOverride ?? account?.type ?? parseAccount(account?.rawName).type;
const isLoan = (account) => typeOf(account) === 'Loan';

/**
 * Which pay cycle a date belongs to, read off the rows the export already put in cycles.
 *
 * The export's cycles run from a boundary day to the day before it (the 23rd, here), and a row on or
 * after the boundary belongs to the NEXT month's key. Rather than being told the boundary, find it:
 * the first day of the month from which every day's rows are mostly keyed a month ahead. With no
 * such day the cycles are calendar months. Used for the rows the app writes itself, so they land in
 * the cycle a real row on the same day would have.
 */
export function payMonthRuleOf(rows) {
  const total = new Array(32).fill(0);
  const ahead = new Array(32).fill(0);
  (rows ?? []).forEach((t) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.Date ?? '');
    const p = /^(\d{4})-(\d{2})$/.exec(t['Pay Month'] ?? '');
    if (!m || !p) return;
    const day = Number(m[3]);
    total[day] += 1;
    if (Number(p[1]) * 12 + Number(p[2]) - (Number(m[1]) * 12 + Number(m[2])) === 1) ahead[day] += 1;
  });
  let boundary = Infinity;
  for (let d = 31; d >= 1; d -= 1) {
    if (total[d] === 0) continue;
    if (ahead[d] / total[d] > 0.5) boundary = d;
    else break;
  }
  return (isoDate) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
    if (!m) return null;
    const shift = Number(m[3]) >= boundary ? 1 : 0;
    const index = Number(m[1]) * 12 + Number(m[2]) - 1 + shift;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  };
}

/** The day `months` after `from`, on `day` of the month, clamped to that month's length. */
function monthAfter(from, months, day) {
  const last = new Date(from.getFullYear(), from.getMonth() + months + 1, 0).getDate();
  return new Date(from.getFullYear(), from.getMonth() + months, Math.min(day, last));
}

/**
 * The words that name the payee, with the references stripped: "FNB HOME  3000021106996 260925"
 * and "Fnb Home * Xx0725 Fnb Home *6996" are both "fnb home".
 */
export function payeeSignature(description) {
  return String(description ?? '')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[*#]+\w*/g, ' ')
    .replace(/\bxx?\d+\w*/g, ' ')
    .replace(/\d[\w.,-]*/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 2)
    .join(' ');
}

const REBATE = /rebate|reversal|refund/i;

/** What the loan's history says its payments were called, or null if it never saw one it can name. */
function learnSignature(loanRows, feed) {
  const credits = loanRows.filter((t) => t.AmountNum > 0 && !REBATE.test(t.Description ?? '') && !t.inferred);
  if (credits.length < 2) return null;
  const byCents = new Map();
  feed.forEach((t) => {
    if (!(t.AmountNum < 0)) return;
    const k = cents(t.AmountNum);
    if (!byCents.has(k)) byCents.set(k, []);
    byCents.get(k).push(t);
  });
  const used = new Set();
  const counts = new Map();
  let paired = 0;
  credits.forEach((credit) => {
    const near = (byCents.get(-cents(credit.AmountNum)) ?? [])
      .filter((d) => !used.has(d) && Math.abs(daysBetween(dateOf(d), dateOf(credit))) <= PAIR_DAYS)
      .sort((a, b) => Math.abs(daysBetween(dateOf(a), dateOf(credit))) - Math.abs(daysBetween(dateOf(b), dateOf(credit))))[0];
    if (!near) return;
    used.add(near);
    paired += 1;
    const sig = payeeSignature(near.Description);
    if (sig) counts.set(sig, (counts.get(sig) ?? 0) + 1);
  });
  if (paired < 2) return null;
  const [sig, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return sig && n >= 2 && n / paired >= MIN_SIGNATURE_SHARE ? sig : null;
}

/**
 * @param rows      every stored row (with DateObj), in any order
 * @param accounts  the account records
 * @param options   payMonthOf(isoDate) → 'YYYY-MM'; defaults to the rule read off the rows themselves
 * @returns {{ rows: object[], summary: object[] }}
 *   `rows` is `rows` plus the inferred ones, sorted by Date with `id` re-assigned to the position —
 *   the shape listTransactions gives. `summary` has one entry per loan that was projected.
 */
export function addInferredLoanRows(rows, accounts, { payMonthOf = null } = {}) {
  // The rows the projection reads. A settlement is the app's own row, written when an account was
  // closed: it is not evidence of anything the loan charged or was paid, so it is kept in the result
  // but never read as history.
  const real = (rows ?? []).filter((t) => !t.inferred);
  const stored = real.filter((t) => t.Source !== 'settlement');
  // A loan that has been closed is still projected — up to the day it closed. Its settlement takes it
  // to nothing from there, and what it owed on that day is what the settlement was sized to clear. It
  // is read as it stood BEFORE it was closed: the zero balance closing states would otherwise read as
  // "nothing is owed" and there would be nothing to project.
  const closedOn = new Map((accounts ?? []).filter((a) => a.closedOn).map((a) => [a.id, a.closedOn]));
  const open = (a) =>
    a.closedOn ? { ...a, closedOn: null, currentBalance: a.preClosure?.currentBalance ?? null, balanceAsOf: a.preClosure?.balanceAsOf ?? null } : a;
  const asOpen = (accounts ?? []).map(open);
  const loans = asOpen.filter((a) => isLoan(a) && !a.external);
  if (!stored.length || !loans.length) return { rows: rows ?? [], summary: [] };

  const loanIds = new Set(asOpen.filter(isLoan).map((a) => a.id));
  const feed = stored.filter((t) => !loanIds.has(accountIdOf(t.Account)));
  if (!feed.length) return { rows: rows ?? [], summary: [] };

  const lastOfAccount = new Map();
  feed.forEach((t) => {
    const id = accountIdOf(t.Account);
    const d = dateOf(t);
    if (d && (!lastOfAccount.get(id) || d > lastOfAccount.get(id))) lastOfAccount.set(id, midnight(d));
  });

  const monthRule = payMonthOf ?? payMonthRuleOf(stored);
  const terms = buildLiabilityTerms(stored, asOpen, { asOf: new Date() });
  const claimed = new Set();
  const added = [];
  const summary = [];

  // Loans with a name for their payments go first, so a debit that carries one is never taken by a
  // loan that is only guessing from the amount.
  const planned = loans
    .map((account) => {
      const t = terms.find((x) => x.accountId === account.id);
      const own = accountRows(stored, { accountId: account.id });
      return { account, terms: t, own, signature: learnSignature(own, feed) };
    })
    .filter((p) => p.terms && p.own.length)
    .sort((a, b) => Number(Boolean(b.signature)) - Number(Boolean(a.signature)));

  planned.forEach(({ account, terms: t, own, signature }) => {
    if (t.rateSource === 'default' || !Number.isFinite(t.rateNominal)) return;
    if (!t.lastPostingDate || t.balanceOwed == null) return;

    // The last time the loan's own books were looked at: its last real row, or a balance somebody stated.
    const lastRow = midnight(dateOf(own[own.length - 1]));
    const stated = account.balanceAsOf ? midnight(parseTransactionDate(account.balanceAsOf) ?? lastRow) : lastRow;
    const from = stated > lastRow ? stated : lastRow;

    // ---- the payments it can see -------------------------------------------------------------
    const instalment = t.instalment ?? null;
    // A name is the better evidence, but not the only one: a loan that used to be paid from an account
    // since closed has a name for those payments that the new account's wording does not repeat. An
    // amount equal to the instalment, near its usual day, is enough — and a debit already claimed by
    // a loan with a name for it is not available to one that is guessing.
    const matches = feed.filter((f) => {
      if (claimed.has(f) || !(f.AmountNum < 0)) return false;
      const d = dateOf(f);
      if (!d || midnight(d) <= from) return false;
      if (signature && payeeSignature(f.Description) === signature) return true;
      if (!instalment) return false;
      if (Math.abs(-f.AmountNum - instalment) > Math.max(AMOUNT_FLOOR, AMOUNT_TOLERANCE * instalment)) return false;
      return t.instalmentDay == null || Math.abs(d.getDate() - t.instalmentDay) <= 6;
    });
    matches.forEach((f) => claimed.add(f));

    // The feed that carries the payments sets how far the projection may go.
    const payerIds = new Set(matches.map((f) => accountIdOf(f.Account)));
    if (t.payingAccountId && payerIds.size === 0) payerIds.add(t.payingAccountId);
    let through = null;
    payerIds.forEach((id) => {
      const last = lastOfAccount.get(id);
      if (last && (!through || last > through)) through = last;
    });
    if (closedOn.has(account.id)) {
      const limit = midnight(parseTransactionDate(closedOn.get(account.id)) ?? through);
      if (limit < through) through = limit;
    }
    if (!through || through <= from) return;

    // ---- the posting days ------------------------------------------------------------------
    const day = midnight(t.lastPostingDate).getDate();
    const postings = [];
    for (let k = 1; k <= MAX_MONTHS; k += 1) {
      const p = monthAfter(midnight(t.lastPostingDate), k, day);
      if (p > through) break;
      if (p > from) postings.push(p);
    }

    // ---- walk the days ---------------------------------------------------------------------
    // What the terms engine says is owed as of the loan's last real row (or the balance somebody
    // stated, which is the same figure when no rows lie between) — from the loan's own ledger, a
    // statement, or a typed balance, whichever the engine trusted.
    let owed = t.balanceOwed;
    if (!(owed > 0)) return;
    // Nothing after the day it closed is the loan's: a payment made then was for something else.
    const payments = matches.filter((f) => midnight(dateOf(f)) <= through).sort((a, b) => dateOf(a) - dateOf(b));
    const out = [];
    const make = (date, description, amount, category, group, payMonth, extra = {}) => ({
      Date: iso(date),
      DateObj: date,
      Description: description,
      Account: account.rawName,
      'Spending Group': group,
      Category: category,
      'Pay Month': payMonth,
      'Split Transaction': 'No',
      Currency: 'ZAR',
      Amount: String(amount),
      Type: amount < 0 ? 'Expense' : 'Income',
      Status: 'Inferred',
      Tags: '',
      Notes: '',
      AmountNum: amount,
      inferred: true,
      key: `inferred|${account.id}|${iso(date)}|${description}|${out.length}`,
      ...extra,
    });
    const monthOf = (date) => monthRule(iso(date));

    let cursor = from;
    let accrued = 0;
    let totalInterest = 0;
    let totalFees = 0;
    let totalPaid = 0;
    let next = 0;
    const settleTo = (end) => {
      // Accrue day by day up to `end`, paying as payments land.
      while (cursor < end) {
        cursor = addDays(cursor, 1);
        accrued += (owed * t.rateNominal) / 365;
        while (next < payments.length && midnight(dateOf(payments[next])) <= cursor) {
          const pay = payments[next];
          const date = midnight(dateOf(pay));
          const amount = round2(-pay.AmountNum);
          out.push(
            make(date, 'Instalment (matched from your payments)', amount, t.payingCategory ?? 'Personal Loan', 'Debt', pay['Pay Month'] ?? monthOf(date)),
          );
          owed -= amount;
          totalPaid += amount;
          next += 1;
        }
      }
    };

    postings.forEach((p) => {
      settleTo(p);
      const interest = round2(accrued);
      const fee = round2(t.feeMonthly ?? 0);
      out.push(make(p, 'Interest (estimated)', -interest, 'Interest', 'Recurring', monthOf(p)));
      if (fee > 0) out.push(make(p, 'Monthly service fee (estimated)', -fee, 'Bank Charges', 'Bank Fees', monthOf(p)));
      owed += interest + fee;
      totalInterest += interest;
      totalFees += fee;
      accrued = 0;
    });
    // Payments after the last posting still count: they are real money that left the paying account.
    while (next < payments.length) {
      const pay = payments[next];
      const date = midnight(dateOf(pay));
      const amount = round2(-pay.AmountNum);
      out.push(make(date, 'Instalment (matched from your payments)', amount, t.payingCategory ?? 'Personal Loan', 'Debt', pay['Pay Month'] ?? monthOf(date)));
      owed -= amount;
      totalPaid += amount;
      next += 1;
    }
    if (!out.length) return;

    added.push(...out);
    // A loan that is closed is not an estimate to show: it is finished.
    if (closedOn.has(account.id)) return;
    summary.push({
      accountId: account.id,
      label: account.label ?? account.rawName,
      from: iso(from),
      through: iso(through),
      postings: postings.length,
      payments: payments.length,
      interest: round2(totalInterest),
      fees: round2(totalFees),
      paid: round2(totalPaid),
      owed: round2(owed),
      rate: t.rateNominal,
      matchedBy: signature ? `payments called "${signature}"` : `a debit of ${instalment?.toFixed(2)}`,
    });
  });

  if (!added.length) return { rows: rows ?? [], summary };
  const merged = [...real, ...added]
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.Date < b.row.Date ? -1 : a.row.Date > b.row.Date ? 1 : a.i - b.i))
    .map(({ row }, id) => ({ ...row, id }));
  return { rows: merged, summary };
}
