import { describe, expect, it } from 'vitest';
import { buildHabits } from './habits';
import { buildFullTransfers, spendRows } from './flows';
import { processTransactionData } from './processTransactionData';
import { loadRealExport } from '../test/realData';

const BANK = 'FNB Bank *2000';
const SAVINGS = 'FNB Savings *9547';

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

function anchors() {
  const rows = [];
  for (let i = 0; i < 12; i += 1) {
    const x = new Date(2025, 7 + i, 23);
    rows.push(row(iso(x), 'Salary', BANK, 50000));
  }
  rows.push(row('2026-08-18', 'Checkers', BANK, -100));
  return rows;
}
const withIds = (rows) => rows.map((r, i) => ({ ...r, id: i }));
const ASOF = new Date(2026, 7, 22);

describe('buildHabits with the full-file transfer set', () => {
  const data = withIds([
    ...anchors(),
    ...['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'].map((d) => row(d, 'Netflix', BANK, -199, { Category: 'TV', 'Spending Group': 'Recurring' })),
    row('2026-06-10', 'Transfer to savings', BANK, -5000, { Category: 'Savings', 'Spending Group': 'Transfer' }),
    row('2026-06-10', 'Transfer from cheque', SAVINGS, 5000, { Category: 'Savings', 'Spending Group': 'Transfer' }),
  ]);
  const accounts = [BANK, SAVINGS];
  const processed = processTransactionData(data, accounts, 6, ASOF);

  it('keeps the output shape and excludes a paired transfer either way', () => {
    const before = buildHabits(data, accounts, processed);
    const after = buildHabits(data, accounts, processed, { transfers: buildFullTransfers(data) });
    [before, after].forEach((h) => {
      expect(h.merchants.some((m) => /transfer/i.test(m.label))).toBe(false);
      expect(h.subscriptions.items.map((m) => m.key)).toEqual(['netflix']);
      expect(h.subscriptions.total).toBeCloseTo(199, 6);
      expect(Object.keys(h)).toEqual(expect.arrayContaining(['merchants', 'topMerchants', 'byFrequency', 'subscriptions', 'movers', 'weekday', 'busiest', 'quietest', 'totalSpend', 'perCycleSpend', 'cycles', 'months']));
    });
    expect(after.totalSpend).toBe(before.totalSpend);
  });

  it('returns null with nothing to read', () => {
    expect(buildHabits([], accounts, processed)).toBeNull();
    expect(buildHabits(data, [], processed, { transfers: buildFullTransfers(data) })).toBeNull();
  });
});

const real = loadRealExport();

describe.skipIf(!real)('buildHabits on the real export', () => {
  const accounts = [...new Set((real ?? []).map((t) => t.Account))];
  const processed = processTransactionData(real, accounts, 6, ASOF);
  const transfers = buildFullTransfers(real);
  const before = buildHabits(real, accounts, processed);
  const after = buildHabits(real, accounts, processed, { transfers });

  it('excludes the same rows as before plus any row the full file pairs, and keeps the standing total within 1%', () => {
    const oldRows = new Set(
      spendRows(real, { selectedAccounts: accounts, months: processed.months }).filter((t) => !processed.transferIds.has(t.id)),
    );
    const newRows = spendRows(real, { transfers, selectedAccounts: accounts, months: processed.months });
    newRows.forEach((t) => expect(oldRows.has(t)).toBe(true));
    expect(after.totalSpend).toBeLessThanOrEqual(before.totalSpend);
    expect(Math.abs(after.subscriptions.total - before.subscriptions.total) / before.subscriptions.total).toBeLessThan(0.01);
    expect(after.merchants.length).toBeGreaterThan(20);
    expect(after.cycles).toBe(6);
  });
});
