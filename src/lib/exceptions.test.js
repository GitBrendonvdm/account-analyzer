import { describe, expect, it } from 'vitest';
import { processTransactionData } from './processTransactionData';
import { flattenCategories } from './categoryRows';

/**
 * What counts as ordinary, and what counts as an event.
 *
 * A cycle that ran above its usual is two things at once: the usual, which belongs in its category
 * and in every average built on it, and the surplus, which does not. These tests pin the split —
 * including the case that prompted it: a payment that is usually R10 000 and was R15 000 once.
 */

const CYCLES = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const ASOF = new Date(2026, 7, 24);
let n = 0;

const row = (month, description, amount, extra = {}) => ({
  id: n++,
  Date: `${month}-05`,
  Description: description,
  Account: 'FNB Bank *9986',
  'Spending Group': 'Day-to-day',
  Category: extra.category ?? 'Groceries',
  'Pay Month': month,
  Type: amount > 0 ? 'Income' : 'Expense',
  Status: 'Completed',
  AmountNum: amount,
  ...extra,
});

/** Enough of a spine that a cycle exists in every month, so nothing is sparse by accident. */
const spine = () => CYCLES.flatMap((m) => [
  row(m, 'Salary', 50000, { category: 'Salaries & Wages', 'Spending Group': 'Income' }),
  row(m, 'Rent', -8000, { category: 'Rent' }),
]);

const run = (rows) => {
  const accounts = [...new Set(rows.map((t) => t.Account))];
  const processed = processTransactionData(rows, accounts, 6, ASOF);
  const flat = flattenCategories(processed);
  const groupTotal = (name, month) => processed.rows.find((g) => g.name === name)?.totalsByMonth?.[month] ?? 0;
  const category = (name) => flat.find((c) => c.name === name);
  return { processed, flat, groupTotal, category };
};

describe('a cycle that ran above its usual', () => {
  it('keeps the usual in the category and moves only the surplus', () => {
    // Usually R10 000 a cycle; R15 000 in one of them.
    const rows = [
      ...spine(),
      ...CYCLES.map((m) => row(m, 'Bond top-up', m === '2026-06' ? -15000 : -10000, { category: 'Home & Garden' })),
    ];
    const { groupTotal, category } = run(rows);

    // The surplus is the R5 000, and it is the only thing in Expense Exceptions that cycle.
    expect(groupTotal('Expense Exceptions', '2026-06')).toBeCloseTo(-5000, 6);
    expect(groupTotal('Expense Exceptions', '2026-05')).toBeCloseTo(0, 6);
    // Home & Garden reads as its usual R10 000 in every cycle, including the one that overran.
    const home = category('Home & Garden');
    CYCLES.forEach((m) => expect(home.totalsByMonth[m]).toBeCloseTo(-10000, 6));
  });

  it('adds up to the transaction that actually happened', () => {
    const rows = [
      ...spine(),
      ...CYCLES.map((m) => row(m, 'Vet', m === '2026-07' ? -9000 : -2000, { category: 'Pets' })),
    ];
    const { groupTotal } = run(rows);
    const cycleTotal = groupTotal('Expense', '2026-07') + groupTotal('Expense Exceptions', '2026-07');
    // Salary spine aside: R8 000 rent + R9 000 vet went out that cycle, however it is filed.
    expect(cycleTotal).toBeCloseTo(-17000, 6);
  });

  it('leaves an ordinary wobble alone', () => {
    const rows = [
      ...spine(),
      ...CYCLES.map((m) => row(m, 'Spar', m === '2026-06' ? -10800 : -10000, { category: 'Groceries' })),
    ];
    const { groupTotal } = run(rows);
    // 8% over, and under the rand floor: not an event.
    expect(groupTotal('Expense Exceptions', '2026-06')).toBeCloseTo(0, 6);
  });

  it('does not let one enormous cycle raise its own usual', () => {
    const rows = [
      ...spine(),
      ...CYCLES.map((m) => row(m, 'Medical', m === '2026-07' ? -10000 : -100, { category: 'Medical' })),
    ];
    const { groupTotal, category } = run(rows);
    // Usual is R100 — the median of the other cycles — so nearly the whole R10 000 is the event.
    expect(groupTotal('Expense Exceptions', '2026-07')).toBeCloseTo(-9900, 6);
    expect(category('Medical').totalsByMonth['2026-07']).toBeCloseTo(-100, 6);
  });

  it('waits for three cycles of history before it has a usual at all', () => {
    const rows = [
      ...spine(),
      row('2026-07', 'New thing', -3000, { category: 'Business' }),
      row('2026-08', 'New thing', -9000, { category: 'Business' }),
    ];
    const { groupTotal } = run(rows);
    // Two active cycles is not a habit; the category is sparse and all of it is already an exception.
    expect(groupTotal('Expense', '2026-08')).toBeCloseTo(-8000, 6);
  });

  it('splits income the same way', () => {
    const rows = [
      ...spine(),
      ...CYCLES.map((m) => row(m, 'Consulting', m === '2026-05' ? 30000 : 10000, { category: 'Other Income', 'Spending Group': 'Income' })),
    ];
    const { groupTotal } = run(rows);
    expect(groupTotal('Income Exceptions', '2026-05')).toBeCloseTo(20000, 6);
    expect(groupTotal('Income', '2026-05')).toBeCloseTo(60000, 6);
  });

  it('takes the surplus off the largest transaction, and can point at it', () => {
    const rows = [
      ...spine(),
      ...CYCLES.filter((m) => m !== '2026-06').map((m) => row(m, 'Shop', -2000, { category: 'Clothing' })),
      row('2026-06', 'Small shop', -500, { category: 'Clothing' }),
      row('2026-06', 'Big shop', -7000, { category: 'Clothing' }),
    ];
    const { processed, groupTotal } = run(rows);
    // Usual R2 000, spent R7 500, so R5 500 is the event — taken off the R7 000 row.
    expect(groupTotal('Expense Exceptions', '2026-06')).toBeCloseTo(-5500, 6);
    // Exceptions skip the spending-group level, so their categories hang straight off the group.
    const exceptions = processed.rows.find((g) => g.name === 'Expense Exceptions');
    const items = (exceptions?.sub ?? []).flatMap((c) => c.items ?? []).filter((t) => t.isExcess);
    expect(items).toHaveLength(1);
    expect(items[0].Description).toContain('Big shop');
    expect(items[0].Description).toContain('above usual');
    expect(items[0].AmountNum).toBeCloseTo(-5500, 6);
  });
});

describe('a level that persists', () => {
  it('is the new normal, not the same surprise twice', () => {
    // A medical aid that starts mid-window: two cycles far above a usual built from the months
    // before it existed. Neither is an event — the second one least of all.
    const rows = [
      ...spine(),
      ...CYCLES.map((m) => row(m, 'Bestmed', ['2026-07', '2026-08'].includes(m) ? -10000 : -60, { category: 'Medical' })),
    ];
    const { groupTotal, category } = run(rows);
    expect(groupTotal('Expense Exceptions', '2026-07')).toBeCloseTo(0, 6);
    expect(groupTotal('Expense Exceptions', '2026-08')).toBeCloseTo(0, 6);
    expect(category('Medical').totalsByMonth['2026-08']).toBeCloseTo(-10000, 6);
  });

  it('still splits a raised cycle that stands alone between ordinary ones', () => {
    const rows = [
      ...spine(),
      ...CYCLES.map((m) => row(m, 'Vet', m === '2026-06' ? -9000 : -2000, { category: 'Pets' })),
    ];
    const { groupTotal } = run(rows);
    expect(groupTotal('Expense Exceptions', '2026-06')).toBeCloseTo(-7000, 6);
  });
});

describe('a category seen in only one cycle', () => {
  it('is an exception in full, with nothing left in the ordinary flow', () => {
    const rows = [...spine(), row('2026-06', 'Goch And Cooper', -9327, { category: 'Vehicle Expenses' })];
    const { groupTotal, category } = run(rows);
    expect(groupTotal('Expense Exceptions', '2026-06')).toBeCloseTo(-9327, 6);
    expect(category('Vehicle Expenses')).toBeUndefined();
  });
});
