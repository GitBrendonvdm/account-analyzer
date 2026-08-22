import { describe, expect, it } from 'vitest';
import {
  accountTypeOf,
  buildFullTransfers,
  completeMonths,
  cycleBoundsOf,
  cycleKeyOf,
  incomeRows,
  isSpendRow,
  lastCompleteMonth,
  loanAccountsOf,
  spendRows,
} from './flows';
import { buildCycleCalendar } from './cycleCurve';
import { isCost } from './costOfDebt';
import { parseAccount } from './accounts';
import { loadRealExport } from '../test/realData';

/**
 * Fixture rows follow the real export's 23rd→22nd cycle: a date on or after the 23rd belongs to
 * the next month's Pay Month. The anchors (a salary on every 23rd) pin the calendar's boundary so
 * the cycles infer exactly as they do on the real file.
 */
const BANK = 'FNB Bank *2000';
const SAVINGS = 'FNB Savings *9547';
const CARD = 'Nedbank Credit Card *4714';
const LOAN = 'FNB Loan *4081';

function payMonthOf(date) {
  const [y, m, day] = date.split('-').map(Number);
  const key = day >= 23 ? new Date(y, m, 1) : new Date(y, m - 1, 1);
  return `${key.getFullYear()}-${String(key.getMonth() + 1).padStart(2, '0')}`;
}

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

/** Salary anchors on the 23rd from Aug 2024 to Jul 2026, a partial first cycle, and a marker at dataThrough. */
function anchors({ partialStart = '2024-08-05', through = '2026-08-18' } = {}) {
  const rows = [row(partialStart, 'Woolworths', BANK, -120)];
  for (let i = 0; i < 24; i += 1) {
    const d = new Date(2024, 7 + i, 23);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-23`;
    rows.push(row(iso, 'Salary', BANK, 50000));
  }
  rows.push(row(through, 'Checkers', BANK, -100));
  return rows;
}

const withIds = (rows) => rows.map((r, i) => ({ ...r, id: i }));
const months = (data) => [...new Set(data.map((t) => t['Pay Month']))].sort();
const iso = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const ASOF = new Date(2026, 7, 22);

describe('buildFullTransfers', () => {
  it('pairs a cross-account transfer in the first cycle of a 26-cycle file', () => {
    const data = withIds([
      ...anchors(),
      row('2024-08-10', 'Transfer to savings', BANK, -5000),
      row('2024-08-10', 'Transfer from cheque', SAVINGS, 5000),
    ]);
    const t = buildFullTransfers(data);
    const legs = data.filter((r) => r.Description.startsWith('Transfer'));
    expect(legs).toHaveLength(2);
    legs.forEach((leg) => expect(t.transferIds.has(leg.id)).toBe(true));
    expect(t.pairs).toHaveLength(1);
    expect(t.allMonths[0]).toBe('2024-08');
    expect(t.allMonths).toHaveLength(25);
  });

  it('releases a loan instalment pair back to spend, keeping only the bank leg', () => {
    const data = withIds([
      ...anchors(),
      row('2026-05-25', 'Wesbank instalment', BANK, -4990.67, { Category: 'Vehicle Loan / Car Loan' }),
      row('2026-05-25', 'Instalment received', LOAN, 4990.67, { Category: 'Vehicle Loan / Car Loan' }),
    ]);
    const t = buildFullTransfers(data);
    const bankLeg = data.find((r) => r.Description === 'Wesbank instalment');
    const loanLeg = data.find((r) => r.Description === 'Instalment received');
    expect(t.loanPairs).toHaveLength(1);
    expect(t.pairs).toHaveLength(0);
    expect(t.loanInstalmentIds.has(bankLeg.id)).toBe(true);
    expect(t.loanInstalmentIds.has(loanLeg.id)).toBe(false);
    expect(t.transferIds.has(bankLeg.id)).toBe(false);
    expect(t.transferIds.has(loanLeg.id)).toBe(false);
    expect(t.loanAccounts.has(LOAN)).toBe(true);

    const spend = spendRows(data, { transfers: t });
    expect(spend).toContain(bankLeg);
    expect(spend).not.toContain(loanLeg);
  });

  it("keeps a 'Transfer'-labelled Groceries row as spend", () => {
    const data = withIds([
      ...anchors(),
      row('2026-06-02', 'Makro', BANK, -1800, { 'Spending Group': 'Transfer', Category: 'Groceries' }),
      row('2026-06-03', 'Card repayment', BANK, -2500, {
        'Spending Group': 'Transfer',
        Category: 'Credit Card Repayment',
      }),
    ]);
    const t = buildFullTransfers(data);
    const makro = data.find((r) => r.Description === 'Makro');
    const repayment = data.find((r) => r.Description === 'Card repayment');
    expect(t.transferIds.has(makro.id)).toBe(false);
    expect(t.transferIds.has(repayment.id)).toBe(true);
    expect(spendRows(data, { transfers: t })).toContain(makro);
    expect(spendRows(data, { transfers: t })).not.toContain(repayment);
  });

  it('lists card repayments as (credit on card, debit on bank) dated by the debit', () => {
    const data = withIds([
      ...anchors(),
      row('2026-06-26', 'Payment to card', BANK, -3000, { Category: 'Credit Card Repayment' }),
      row('2026-06-27', 'Payment received', CARD, 3000, { Category: 'Credit Card Repayment' }),
    ]);
    const t = buildFullTransfers(data);
    expect(t.cardRepayments).toHaveLength(1);
    const r = t.cardRepayments[0];
    expect(r.payingAccountId).toBe('fnb|2000');
    expect(r.cardAccountId).toBe('nedbank|4714');
    expect(r.amount).toBe(3000);
    expect(iso(r.date)).toBe('2026-06-26');
    expect(iso(r.creditDate)).toBe('2026-06-27');
    expect(r.credit.Account).toBe(CARD);
    expect(r.debit.Account).toBe(BANK);
  });

  it('honours a typeOverride of Loan on a Bank-named account', () => {
    const data = withIds([...anchors(), row('2026-06-02', 'Fee', 'FNB Bank *1143', -69)]);
    const accounts = [{ id: 'fnb|1143', typeOverride: 'Loan' }];
    expect(loanAccountsOf(data)).toEqual(new Set());
    expect(loanAccountsOf(data, accounts)).toEqual(new Set(['FNB Bank *1143']));
    expect(accountTypeOf('FNB Bank *1143', accounts)).toBe('Loan');
    expect(accountTypeOf('FNB Bank *1143')).toBe('Bank');
    const t = buildFullTransfers(data, { accounts });
    expect(t.loanAccounts.has('FNB Bank *1143')).toBe(true);
    expect(spendRows(data, { transfers: t }).some((r) => r.Description === 'Fee')).toBe(false);
  });

  it('filters spend and income with the same exclusions and optional account/month sets', () => {
    const data = withIds([
      ...anchors(),
      row('2026-06-02', 'Spar', SAVINGS, -300),
      row('2026-06-05', 'Refund', BANK, 120, { Category: 'Groceries' }),
    ]);
    const t = buildFullTransfers(data);
    const spar = data.find((r) => r.Description === 'Spar');
    expect(spendRows(data, { transfers: t, selectedAccounts: [BANK] })).not.toContain(spar);
    expect(spendRows(data, { transfers: t, months: ['2026-06'] })).toContain(spar);
    expect(spendRows(data, { transfers: t, months: ['2026-07'] })).not.toContain(spar);
    const income = incomeRows(data, { transfers: t });
    expect(income.some((r) => r.Description === 'Refund')).toBe(true);
    expect(income.every((r) => r.AmountNum > 0)).toBe(true);
    expect(isSpendRow(spar, { transfers: t, visible: new Set(['2026-06']) })).toBe(true);
    expect(isSpendRow(spar, { transfers: t, selected: new Set([BANK]) })).toBe(false);
  });

  it('returns an empty structure for no data', () => {
    const t = buildFullTransfers([]);
    expect(t.transferIds.size).toBe(0);
    expect(t.cardRepayments).toEqual([]);
    expect(t.loanAccounts.size).toBe(0);
  });
});

describe('completeMonths and cycle keys', () => {
  const data = withIds(anchors());
  const calendar = buildCycleCalendar(data, months(data), ASOF);

  it('excludes the partial first cycle and the one still in progress', () => {
    expect(iso(calendar.dataThrough)).toBe('2026-08-18');
    expect(calendar.currentMonth).toBe('2026-08');
    expect(iso(calendar.ends['2026-08'])).toBe('2026-08-22');
    expect(calendar.isPartial['2024-08']).toBe(true);
    const complete = completeMonths(calendar);
    expect(complete[0]).toBe('2024-09');
    expect(complete[complete.length - 1]).toBe('2026-07');
    expect(complete).not.toContain('2026-08');
    expect(complete).not.toContain('2024-08');
    expect(lastCompleteMonth(calendar)).toBe('2026-07');
    expect(completeMonths(null)).toEqual([]);
    expect(lastCompleteMonth({ starts: {} })).toBeNull();
  });

  it('includes the current cycle once the data reaches its end', () => {
    const full = withIds(anchors({ through: '2026-08-22' }));
    const cal = buildCycleCalendar(full, months(full), ASOF);
    expect(completeMonths(cal)).toContain('2026-08');
  });

  it('maps dates to cycle keys inside and beyond the calendar', () => {
    expect(cycleKeyOf(new Date(2026, 7, 10), calendar)).toBe('2026-08');
    expect(cycleKeyOf(new Date(2026, 7, 22), calendar)).toBe('2026-08');
    expect(cycleKeyOf(new Date(2026, 7, 23), calendar)).toBe('2026-09');
    expect(cycleKeyOf(new Date(2026, 8, 1), calendar)).toBe('2026-09');
    expect(cycleKeyOf(new Date(2026, 9, 30), calendar)).toBe('2026-11');
    expect(cycleKeyOf(new Date(2024, 0, 1), calendar)).toBeNull();
    expect(cycleKeyOf(null, calendar)).toBeNull();
    const next = cycleBoundsOf('2026-09', calendar);
    expect(iso(next.start)).toBe('2026-08-23');
    expect(iso(next.end)).toBe('2026-09-22');
    expect(iso(cycleBoundsOf('2026-07', calendar).start)).toBe('2026-06-23');
  });
});

describe('costOfDebt.isCost', () => {
  it('accepts fee-like descriptions and rejects money in', () => {
    expect(isCost({ AmountNum: -5, Category: '', Description: 'Budget Finance Charge' })).toBe(true);
    expect(isCost({ AmountNum: -5, Category: '', Description: 'VAT on fee' })).toBe(true);
    expect(isCost({ AmountNum: -5, Category: '', Description: 'Cpp Insurance Premium' })).toBe(true);
    expect(isCost({ AmountNum: -5, Category: 'Interest', Description: 'Int' })).toBe(true);
    expect(isCost({ AmountNum: 5, Category: 'Interest' })).toBe(false);
    expect(isCost({ AmountNum: -5, Category: 'Groceries', Description: 'Checkers' })).toBe(false);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('flows on the real export', () => {
  const data = real;
  const transfers = buildFullTransfers(data);
  const calendar = buildCycleCalendar(data, months(data), ASOF);

  it('finds every loan, pairs instalments and card repayments across the whole file', () => {
    const loansByName = [...new Set(data.map((t) => t.Account))].filter((a) => parseAccount(a).type === 'Loan');
    expect(transfers.loanAccounts.size).toBe(loansByName.length);
    expect(transfers.loanPairs.length).toBeGreaterThan(0);
    expect(transfers.loanInstalmentIds.size).toBeGreaterThan(20);
    expect(transfers.cardRepayments.length).toBeGreaterThan(10);
    transfers.cardRepayments.forEach((r) => {
      expect(r.date).toBeInstanceOf(Date);
      expect(r.amount).toBeGreaterThan(0);
    });
    // Released loan legs never remain in the transfer set.
    transfers.loanPairs.forEach((pair) =>
      pair.items.forEach((t) => expect(transfers.transferIds.has(t.id)).toBe(false)),
    );
  });

  it('yields a spend set that excludes loan accounts and transfer legs, and 24+ complete cycles', () => {
    const spend = spendRows(data, { transfers });
    expect(spend.length).toBeGreaterThan(1000);
    spend.forEach((t) => {
      expect(t.AmountNum).toBeLessThan(0);
      expect(transfers.loanAccounts.has(t.Account)).toBe(false);
      expect(transfers.transferIds.has(t.id)).toBe(false);
    });
    expect(completeMonths(calendar).length).toBeGreaterThanOrEqual(24);
    expect(cycleKeyOf(new Date(2026, 8, 1), calendar)).toBe('2026-09');
  });
});
