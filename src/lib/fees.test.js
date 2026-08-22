import { describe, expect, it } from 'vitest';
import { buildFeesAudit, feeKind } from './fees';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers, completeMonths } from './flows';
import { buildRecurringLines } from './recurring';
import { parseAccount } from './accounts';
import { loadRealExport } from '../test/realData';

/** The currency formatter uses non-breaking spaces; sentences are compared in plain ones. */
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

/**
 * Anchors on the real export's 23rd→22nd cycle, Aug 2024 – Jul 2026, data through 18 Aug 2026:
 * complete cycles 2024-09..2026-07; the last six are 2026-02..2026-07 and the last twelve
 * 2025-08..2026-07. A row dated the 5th lands in that month's cycle.
 */
const BANK = 'FNB Bank *2000';
const BANK2 = 'FNB Bank *3000';
const CARD = 'Nedbank Credit Card *4714';
const LOAN = 'FNB Loan *4081';

function payMonthOf(date) {
  const [y, m, day] = date.split('-').map(Number);
  const key = day >= 23 ? new Date(y, m, 1) : new Date(y, m - 1, 1);
  return `${key.getFullYear()}-${String(key.getMonth() + 1).padStart(2, '0')}`;
}
const iso = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

function row(date, description, account, amount, extra = {}) {
  return {
    Date: date,
    Description: description,
    Account: account,
    Category: amount > 0 ? 'Salaries' : 'Groceries',
    'Spending Group': amount > 0 ? 'Income' : 'Day-to-day',
    'Pay Month': payMonthOf(date),
    Amount: String(amount),
    AmountNum: amount,
    Type: amount < 0 ? 'Expense' : 'Income',
    Status: 'Completed',
    ...extra,
  };
}

function anchors({ through = '2026-08-18' } = {}) {
  const rows = [row('2024-08-05', 'Woolworths', BANK, -120)];
  for (let i = 0; i < 24; i += 1) {
    const x = new Date(2024, 7 + i, 23);
    rows.push(row(iso(x), 'Salary', BANK, 50000));
  }
  rows.push(row(through, 'Checkers', BANK, -100));
  return rows;
}
const withIds = (rows) => rows.map((r, i) => ({ ...r, id: i }));
const months = (data) => [...new Set(data.map((t) => t['Pay Month']))].sort();
const ASOF = new Date(2026, 7, 22);
const LAST6 = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

const fee = (key, description, account, amount, extra = {}) =>
  row(`${key}-05`, description, account, -amount, { Category: 'Bank Charges', 'Spending Group': 'Bank Fees', ...extra });

function build(extraRows, accounts = []) {
  const data = withIds([...anchors(), ...extraRows]);
  const calendar = buildCycleCalendar(data, months(data), ASOF);
  const transfers = buildFullTransfers(data);
  const lines = buildRecurringLines(data, { calendar, transfers, asOf: ASOF }).lines;
  return { fees: buildFeesAudit(data, accounts, { transfers, calendar, lines }), calendar, data };
}

describe('feeKind', () => {
  const cases = [
    ['Initiation Fee', 'Loan', 'initiation'],
    ['Monthly Account Fee', 'Bank', 'account'],
    ['Maintenance Fee', 'Savings', 'account'],
    ['Admin Fee', 'Loan', 'account'],
    ['NCA Service Fee', 'Loan', 'account'],
    ['Credit Card Account Fee', 'Credit Card', 'account'],
    ['Monthly Credit Fee', 'Bank', 'account'],
    ['Instant Payment Fee', 'Savings', 'transaction'],
    ['Nedbank Send-Imali', 'Savings', 'transaction'],
    ['Electronic Payment Fee', 'Credit Card', 'transaction'],
    ['Electronic Trf Fee', 'Credit Card', 'transaction'],
    ['VAT On Fee', 'Credit Card', 'transaction'],
    ['Payments Bundle Fee', 'Bank', 'transaction'],
    ['Declined Auth Fee', 'Credit Card', 'penalty'],
    ['Returned APO Fee', 'Credit Card', 'penalty'],
    ['Non FNB ATM Cash Withdrawal Fees', 'Bank', 'atm'],
    ['A T M Cash Advance Fee', 'Credit Card', 'atm'],
    ['Int Pymt Fee-1.23 Appl', 'Bank', 'crossBorder'],
    ['Cross Border Transaction Fee', 'Credit Card', 'crossBorder'],
    ['Payment Protection Ins...', 'Credit Card', 'embeddedInsurance'],
    ['Cpp Insurance Premium', 'Loan', 'loanInsurance'],
    ['Int On Debit Balance', 'Bank', 'overdraftInterest'],
    ['Budget Finance Charge', 'Credit Card', 'cardInterest'],
    ['Finance Charge', 'Credit Card', 'cardInterest'],
  ];
  it.each(cases)('%s on a %s → %s', (description, type, expected) => {
    expect(feeKind({ AmountNum: -5, Description: description, Category: 'Bank Charges' }, type)).toBe(expected);
  });

  it('reads interest by category and account type', () => {
    expect(feeKind({ AmountNum: -5, Description: 'Interest', Category: 'Interest' }, 'Credit Card')).toBe('cardInterest');
    expect(feeKind({ AmountNum: -5, Description: 'Interest', Category: 'Interest' }, 'Loan')).toBe('loanInterest');
    expect(feeKind({ AmountNum: -5, Description: 'Interest', Category: 'Interest' }, 'Savings')).toBe('overdraftInterest');
    expect(feeKind({ AmountNum: -5, Description: 'Premium', Category: 'Other Insurance' }, 'Loan')).toBe('loanInsurance');
    expect(feeKind({ AmountNum: -5, Description: 'Budget Finance Charge', Category: 'Other Insurance' }, 'Credit Card')).toBe('cardInterest');
  });

  it('refuses positive rows, ordinary spend, and words that merely resemble a fee', () => {
    expect(feeKind({ AmountNum: 5, Description: 'Interest', Category: 'Interest' }, 'Savings')).toBeNull();
    expect(feeKind({ AmountNum: -50, Description: 'Checkers', Category: 'Groceries' }, 'Bank')).toBeNull();
    expect(feeKind({ AmountNum: -50, Description: 'Coffee At The Dairy Sh', Category: 'Coffee' }, 'Credit Card')).toBeNull();
    expect(feeKind({ AmountNum: -50, Description: 'Foreign Film Festival', Category: 'Entertainment' }, 'Credit Card')).toBeNull();
    expect(feeKind({ AmountNum: -50, Description: 'Int Pymt Fee-Netflix.com', Category: 'TV' }, 'Credit Card')).toBe('crossBorder');
    expect(feeKind({ AmountNum: -5, Description: 'Something Odd', Category: 'Bank Charges' }, 'Bank')).toBe('otherFee');
  });
});

describe('buildFeesAudit', () => {
  it('names the quieter of two fee-paying current accounts as the one to close', () => {
    const rows = [
      ...LAST6.map((k) => fee(k, 'Monthly Account Fee', BANK, 100)),
      ...LAST6.map((k) => fee(k, 'Monthly Account Fee', BANK2, 50)),
      ...['2026-02-10', '2026-04-10', '2026-06-10'].map((d) => row(d, 'Spar', BANK, -200)),
      ...LAST6.flatMap((k) => Array.from({ length: 7 }, (_, i) => row(`${k}-${String(i + 8).padStart(2, '0')}`, 'Checkers', BANK2, -150))),
    ];
    const { fees } = build(rows);
    expect(fees.consolidation).toEqual(
      expect.objectContaining({ closeCandidate: BANK, keepCandidate: BANK2, savingPerYear: 1200 }),
    );
    expect(plain(fees.consolidation.sentence)).toBe(`Consolidating to one current account: R 1 200/yr (close the ${BANK}, keep the ${BANK2})`);
    const bank = fees.byAccount.find((a) => a.accountId === 'fnb|2000');
    expect(bank.spendRows6).toBe(3);
    expect(bank.kinds.account).toEqual(expect.objectContaining({ perCycle: 100, perYear: 1200 }));
    expect(fees.byAccount.find((a) => a.accountId === 'fnb|3000').spendRows6).toBe(42);
    expect(fees.accountFeesPerYear).toBe(1800);
    expect(fees.byKind.account.perCycle).toBe(150);
    expect(fees.avoidablePerYear).toBe(0);
    expect(fees.cycles).toHaveLength(12);
    expect(fees.cycles.at(-1)).toBe('2026-07');
  });

  it('lists an initiation fee without letting it into any run rate', () => {
    const rows = [
      fee('2024-09', 'Initiation Fee', LOAN, 6037),
      ...LAST6.map((k) => fee(k, 'Monthly Account Fee', BANK, 100)),
    ];
    const { fees } = build(rows);
    expect(fees.byKind.initiation).toEqual({ perCycle: 0, perYear: 0, trend: 0, total: 6037 });
    expect(fees.byKind.account.perCycle).toBe(100);
    expect(fees.totalPerYear).toBe(1200);
    const loan = fees.byAccount.find((a) => a.type === 'Loan');
    expect(loan.kinds.initiation.total).toBe(6037);
    expect(loan.totalPerYear).toBe(0);
    expect(fees.consolidation).toBeNull();
  });

  it('counts the cycles that carried card interest and reports the last year as charged', () => {
    const rows = ['2026-02', '2026-03', '2026-05', '2026-07'].map((k) =>
      row(`${k}-05`, 'Finance Charge', CARD, -500, { Category: 'Interest', 'Spending Group': 'Debt' }),
    );
    const { fees } = build(rows);
    expect(fees.cardInterest.cyclesWithInterest).toBe(4);
    expect(fees.cardInterest.perYear).toBe(2000);
    expect(fees.cardInterest.perCycle).toBeCloseTo(2000 / 12, 9);
    expect(fees.cardInterest.runRatePerCycle).toBe(500);
    expect(fees.cardInterest.series).toHaveLength(12);
    expect(fees.cardInterest.series.filter((s) => s.amount > 0)).toHaveLength(4);
    expect(plain(fees.cardInterest.sentence)).toBe('Card interest R 2 000/yr — charged in 4 of the last 6 cycles');
    expect(fees.byKind.cardInterest.perCycle).toBe(500);
  });

  it('reads payment protection on a card as optional cover and names the card', () => {
    const rows = LAST6.map((k) => row(`${k}-05`, 'Payment Protection Ins...', CARD, -120, { Category: 'Other Insurance', 'Spending Group': 'Insurance' }));
    const accounts = [{ id: 'nedbank|4714', label: 'Gold card', rawName: CARD, type: 'Credit Card' }];
    const { fees } = build(rows, accounts);
    expect(fees.ppi).toEqual(
      expect.objectContaining({ perYear: 1440, perCycle: 120, accounts: ['Gold card'] }),
    );
    expect(fees.ppi.byAccount[0]).toEqual({ accountId: 'nedbank|4714', label: 'Gold card', perCycle: 120, perYear: 1440 });
    expect(plain(fees.ppi.sentence)).toBe('Payment protection on the Gold card: R 1 440/yr, optional cover');
  });

  it('totals the avoidable kinds and reads every account regardless of selection', () => {
    const rows = [
      ...LAST6.map((k) => fee(k, 'Instant Payment Fee', BANK, 10)),
      ...LAST6.map((k) => fee(k, 'Declined Auth Fee', CARD, 20)),
      ...LAST6.map((k) => fee(k, 'Non FNB ATM Cash Withdrawal Fees', BANK, 5)),
      ...LAST6.map((k) => fee(k, 'Int Pymt Fee-1.00 Appl', BANK, 2)),
      ...LAST6.map((k) => row(`${k}-05`, 'Interest', LOAN, -9000, { Category: 'Interest', 'Spending Group': 'Debt' })),
      ...LAST6.map((k) => fee(k, 'Monthly Service Fee', LOAN, 69)),
    ];
    const { fees } = build(rows);
    expect(fees.avoidablePerYear).toBe((10 + 20 + 5 + 2) * 12);
    expect(fees.loanCostPerYear).toBe((9000 + 69) * 12);
    expect(fees.accountFeesPerYear).toBe(0);
    expect(fees.byAccount.map((a) => a.type).sort()).toEqual(['Bank', 'Credit Card', 'Loan']);
    expect(plain(fees.sentences.avoidable)).toBe('Transaction, ATM and penalty fees: R 444/yr.');
  });

  it('honours a type override when classifying', () => {
    const rows = LAST6.map((k) => row(`${k}-05`, 'Interest', BANK2, -300, { Category: 'Interest', 'Spending Group': 'Debt' }));
    const asLoan = [{ id: 'fnb|3000', rawName: BANK2, type: 'Loan', typeOverride: 'Loan' }];
    expect(build(rows).fees.overdraftInterestPerYear).toBe(3600);
    expect(build(rows, asLoan).fees.overdraftInterestPerYear).toBe(0);
    expect(build(rows, asLoan).fees.byKind.loanInterest.perYear).toBe(3600);
  });

  it('lifts price steps off fee lines', () => {
    const before = ['2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    const rows = [
      ...before.map((k) => fee(k, 'Monthly Account Fee', BANK, 100)),
      ...['2026-07', '2026-08'].map((k) => fee(k, 'Monthly Account Fee', BANK, 200)),
    ];
    const { fees } = build(rows);
    expect(fees.steps).toHaveLength(1);
    expect(fees.steps[0]).toEqual(expect.objectContaining({ feeKind: 'account', from: 100, to: 200, cycle: '2026-07', accountId: 'fnb|2000' }));
    expect(plain(fees.sentences.accountFees)).toMatch(/rose from R 100 to R 200 in Jul 2026$/);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('fees on the real export', () => {
  // The body runs even when skipped; a missing export must not break collection.
  if (!real) return;
  const allMonths = months(real ?? []);
  const calendar = buildCycleCalendar(real, allMonths, ASOF);
  const transfers = buildFullTransfers(real);
  const { lines } = buildRecurringLines(real, { calendar, transfers, asOf: ASOF });
  const fees = buildFeesAudit(real, [], { transfers, calendar, lines });

  it('reads every account, cards and loans included', () => {
    const types = new Set(fees.byAccount.map((a) => a.type));
    expect(types.has('Loan')).toBe(true);
    expect(types.has('Credit Card')).toBe(true);
    expect(types.has('Bank')).toBe(true);
    expect(fees.byAccount.filter((a) => a.type === 'Loan').length).toBe(
      [...new Set(real.map((t) => t.Account))].filter((a) => parseAccount(a).type === 'Loan').length,
    );
    expect(completeMonths(calendar).length).toBeGreaterThanOrEqual(12);
    expect(fees.cycles).toHaveLength(12);
  });

  it('puts card interest in the expected band and keeps the avoidable figure honest', () => {
    expect(fees.cardInterest.perYear).toBeGreaterThanOrEqual(15000);
    expect(fees.cardInterest.perYear).toBeLessThanOrEqual(30000);
    expect(fees.cardInterest.cyclesWithInterest).toBeGreaterThanOrEqual(4);
    expect(fees.avoidablePerYear).toBeLessThan(1000);
    expect(fees.avoidablePerYear).toBeGreaterThanOrEqual(0);
    expect(fees.loanCostPerYear).toBeGreaterThan(100000);
    expect(fees.ppi).not.toBeNull();
    expect(fees.consolidation).not.toBeNull();
  });

  it('shows the account-fee step in 2026-07 on a current account', () => {
    const step = fees.steps.find((s) => s.feeKind === 'account' && s.cycle === '2026-07');
    expect(step).toBeDefined();
    expect(step.to).toBeGreaterThan(step.from);
    expect(fees.byAccount.find((a) => a.accountId === step.accountId)?.type).toBe('Bank');
    expect(plain(fees.sentences.accountFees)).toMatch(/in Jul 2026$/);
  });
});
