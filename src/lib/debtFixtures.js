import { accountIdOf } from './accounts';
import { remainingTerm } from './inferRates';

/**
 * Synthetic liabilities with a known truth, for the debt tests.
 *
 * The real export cannot be committed, and even where it is available it carries no answer key:
 * nobody knows to the cent what the bank's rate or the remaining term was on a given day. These
 * fixtures generate a loan the way a bank's ledger would — a disbursement, then on the same day
 * each month an interest posting on the actual day count, a service fee, an instalment credit on
 * the loan and the matching debit on the paying account — so that every figure the inferrer
 * produces can be checked against the arithmetic that produced the rows. `rateChanges` replays a
 * rate cut with its instalment recast, `fromPosting` slices the history to imitate an export that
 * starts mid-life, and `truthRemaining` keeps amortising past the last row under the same rule so
 * the inferred term has something honest to be compared with.
 *
 * Test-only. Nothing in the app imports this module.
 */

const DAY_MS = 86400000;
const round2 = (x) => Math.round(x * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function finalise(rows) {
  return rows.map((r, i) => ({
    ...r,
    id: i,
    key: `${r.Date}|${accountIdOf(r.Account)}|${Math.round(r.AmountNum * 100)}|${r.Description.toLowerCase()}|${i}`,
  }));
}

function row(date, description, account, amount, category, posting) {
  const day = iso(date);
  return {
    Date: day,
    Description: description,
    Account: account,
    Category: category,
    'Spending Group': 'Debt',
    'Pay Month': day.slice(0, 7),
    Amount: String(amount),
    AmountNum: amount,
    _posting: posting,
  };
}

/**
 * A loan whose rows follow the bank's own arithmetic.
 *
 * @returns {{
 *   rows: object[],                                   // Date, Description, Account, Category, Pay Month, AmountNum, id, key
 *   balances: [{ date: Date, before: number, after: number }],  // owed before and after each posting, in posting order
 *   truthRemaining: number,                           // further postings until the balance reaches zero under the same rule
 *   account: string, payingAccount: string, accountId: string, payingAccountId: string,
 * }}
 */
export function loanFixture({
  principal = 100000,
  rateNominal = 0.12,
  instalment = 2224.44,
  fee = 69,
  start = '2025-01-05',
  postings = 24,
  account = 'Test Loan *1111',
  payingAccount = 'Test Bank *2222',
  disbursementRow = true,
  fromPosting = 1,
  rateChanges = [],
} = {}) {
  const [y, m, d] = start.split('-').map(Number);
  const startDate = new Date(y, m - 1, d);
  const rows = [];
  const balances = [];

  let balance = principal;
  let rate = rateNominal;
  let payment = instalment;
  let previous = startDate;

  if (disbursementRow) rows.push(row(startDate, 'Disbursement', account, -principal, 'Personal Loan', 0));

  const stepTo = (k) => {
    const change = rateChanges.find((c) => c.atPosting === k);
    if (change) {
      if (Number.isFinite(change.rateNominal)) rate = change.rateNominal;
      if (Number.isFinite(change.instalment)) payment = change.instalment;
    }
  };

  for (let k = 1; k <= postings; k += 1) {
    stepTo(k);
    const date = new Date(y, m - 1 + k, d);
    const days = Math.round((date - previous) / DAY_MS);
    const interest = round2((balance * rate * days) / 365);
    const before = balance;
    rows.push(row(date, 'Interest', account, -interest, 'Interest', k));
    rows.push(row(date, 'Monthly service fee', account, -fee, 'Bank Charges', k));
    rows.push(row(date, 'Instalment', account, payment, 'Personal Loan', k));
    rows.push(row(date, 'Loan instalment', payingAccount, -payment, 'Personal Loan', k));
    balance = round2(balance + interest + fee - payment);
    balances.push({ date, before, after: balance });
    previous = date;
  }

  // Keep amortising past the data under the same rule; the clearing posting counts.
  let truthRemaining = 0;
  let remaining = balance;
  let prev = previous;
  while (remaining > 0 && truthRemaining < 1200) {
    const k = postings + truthRemaining + 1;
    stepTo(k);
    const date = new Date(y, m - 1 + k, d);
    const days = Math.round((date - prev) / DAY_MS);
    remaining = round2(remaining + round2((remaining * rate * days) / 365) + fee - payment);
    truthRemaining += 1;
    prev = date;
  }

  const kept = rows.filter((r) => r._posting >= fromPosting || (r._posting === 0 && fromPosting <= 1));
  kept.forEach((r) => delete r._posting);

  return {
    rows: finalise(kept),
    balances,
    truthRemaining,
    account,
    payingAccount,
    accountId: accountIdOf(account),
    payingAccountId: accountIdOf(payingAccount),
  };
}

/**
 * A credit card with purchases, one refund, monthly fees and cover, three finance charges (May–Jul,
 * all in complete cycles) and six repayments paired with bank debits on the 26th. Months run
 * Mar–Aug 2026.
 *
 * @returns {{ rows: object[], account: string, bank: string, accountId: string, bankId: string }}
 */
export function cardFixture({
  account = 'Test Credit Card *3333',
  bank = 'Test Bank *2222',
  repayment = 5000,
  financeCharge = 864.58,
} = {}) {
  const rows = [];
  const months = [2, 3, 4, 5, 6, 7]; // March..August 2026 (0-based)
  months.forEach((month, i) => {
    const y = 2026;
    rows.push(row(new Date(y, month, 3), 'Spar Brackenfell', account, -1250.5, 'Groceries', null));
    rows.push(row(new Date(y, month, 9), 'Engen Fuel', account, -900, 'Transport & Fuel', null));
    rows.push(row(new Date(y, month, 12), 'Credit Card Account Fee', account, -69, 'Bank Charges', null));
    rows.push(row(new Date(y, month, 12), 'Payment Protection Ins', account, -120, 'Other Insurance', null));
    if (i >= 2 && i <= 4) rows.push(row(new Date(y, month, 20), 'Finance Charge', account, -financeCharge, 'Interest', null));
    rows.push(row(new Date(y, month, 26), 'Payment Received Thank You', account, repayment, 'Credit Card Repayment', null));
    rows.push(row(new Date(y, month, 26), 'Credit Card Payment', bank, -repayment, 'Credit Card Repayment', null));
  });
  rows.push(row(new Date(2026, 5, 14), 'Takealot', account, -1036, 'Tech & Appliances', null));
  rows.push(row(new Date(2026, 5, 16), 'Takealot Refund', account, 1036, 'Tech & Appliances', null));
  rows.push(row(new Date(2026, 2, 1), 'Salary', bank, 60000, 'Salary', null));
  rows.forEach((r) => delete r._posting);
  return {
    rows: finalise(rows),
    account,
    bank,
    accountId: accountIdOf(account),
    bankId: accountIdOf(bank),
  };
}

/**
 * The five real liabilities at the figures the spec fixes, as simulator inputs (`Debt`, see
 * inferRates.toDebt). The card is paid a planned R5 000 a month — the typical repayment the real
 * data shows — so its scheduled payment does not shrink with its balance.
 *
 * @returns Debt[] in the order card, personal, FNB bond, vehicle, Nedbank bond
 */
export function realTermsDebts() {
  const loan = (id, label, kind, balance, rateNominal, feeMonthly, instalment, rateVariable) => ({
    id,
    label,
    type: 'Loan',
    kind,
    balance,
    rateNominal,
    rateVariable,
    instalment,
    feeMonthly,
    plannedPayment: null,
    minimumPct: null,
    creditLimit: null,
    balloon: null,
    termMonths: null,
    remainingMonths: remainingTerm(balance, rateNominal, instalment, feeMonthly),
    confidence: 'high',
    source: { balance: 'ledger', rate: 'inferred', instalment: 'paired' },
    assumptions: [],
  });
  return [
    {
      id: 'nedbank|4714',
      label: 'Nedbank Credit Card *4714',
      type: 'Credit Card',
      kind: 'card',
      balance: 100000,
      rateNominal: 0.2075,
      rateVariable: false,
      instalment: null,
      feeMonthly: 400,
      plannedPayment: 5000,
      minimumPct: 5,
      creditLimit: 130000,
      balloon: null,
      termMonths: null,
      remainingMonths: null,
      confidence: 'low',
      source: { balance: 'user', rate: 'default', instalment: null },
      assumptions: ['Card rate 20.75% (default)'],
    },
    loan('fnb|1143', 'FNB Loan *1143', 'personal', 171031, 0.172, 676.04, 5139.85, false),
    loan('fnb|6996', 'FNB Loan *6996', 'bond', 606845, 0.0956, 69, 6674.53, true),
    loan('fnb|4081', 'FNB Loan *4081', 'vehicle', 73800, 0.0948, 69, 4990.67, false),
    loan('nedbank|2801', 'Nedbank Loan *2801', 'bond', 2747083, 0.0933, 69, 22854.88, true),
  ];
}
