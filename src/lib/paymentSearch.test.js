import { describe, expect, it } from 'vitest';
import { exceptionKeysOf, findPayments } from './paymentSearch';

const t = (key, over = {}) => ({
  key,
  Date: '2026-09-10',
  Description: 'Builders Warehouse',
  Category: 'Home Improvement',
  Account: 'FNB Cheque *2000',
  AmountNum: -4200,
  'Pay Month': '2026-09',
  ...over,
});

const data = [
  t('a'),
  t('b', { Description: 'Woolworths', Category: 'Groceries', AmountNum: -820, Date: '2026-09-12' }),
  t('c', { Description: 'Salary', Category: 'Salaries', AmountNum: 87000, Date: '2026-09-01' }),
  t('d', { Description: 'Builders Express', Category: '', AmountNum: -150, Date: '2026-08-20', 'Pay Month': '2026-08' }),
];

describe('findPayments', () => {
  it('searches description, category and account together, every word having to appear', () => {
    expect(findPayments(data, { query: 'builders' }).total).toBe(2);
    expect(findPayments(data, { query: 'BUILDERS' }).total).toBe(2);
    // Two words narrow rather than widen: "builders 2000" is the Builders charges on that account.
    expect(findPayments(data, { query: 'builders 2000' }).total).toBe(2);
    expect(findPayments(data, { query: 'builders groceries' }).total).toBe(0);
    // A category is searchable even when the description says nothing about it.
    expect(findPayments(data, { query: 'groceries' }).rows[0].key).toBe('b');
  });

  it('returns newest first, with the totals covering every match and not just the page', () => {
    const out = findPayments(data, { query: '', limit: 2 });
    expect(out.rows.map((r) => r.key)).toEqual(['b', 'a']);
    expect(out.shown).toBe(2);
    expect(out.total).toBe(4);
    expect(out.sum).toBe(-4200 - 820 + 87000 - 150);
  });

  it('filters on amount by magnitude, so a big credit counts as big', () => {
    expect(findPayments(data, { minAmount: 1000 }).total).toBe(2);
    expect(findPayments(data, { minAmount: 1000 }).rows.map((r) => r.key).sort()).toEqual(['a', 'c']);
  });

  it('applies the quick filters', () => {
    expect(findPayments(data, { filters: ['income'] }).rows.map((r) => r.key)).toEqual(['c']);
    expect(findPayments(data, { filters: ['uncategorised'] }).rows.map((r) => r.key)).toEqual(['d']);
    expect(findPayments(data, { filters: ['thisCycle'], currentMonth: '2026-09' }).total).toBe(3);
    expect(findPayments(data, { filters: ['corrected'], overrides: { a: { flag: 'expected' } } }).rows.map((r) => r.key)).toEqual(['a']);
    expect(findPayments(data, { filters: ['exceptions'], exceptionKeys: new Set(['d']) }).rows.map((r) => r.key)).toEqual(['d']);
  });

  it('combines filters and the query, narrowing each time', () => {
    const out = findPayments(data, { query: 'builders', filters: ['thisCycle'], currentMonth: '2026-09' });
    expect(out.rows.map((r) => r.key)).toEqual(['a']);
  });

  it('never blows up on nothing', () => {
    expect(findPayments(null, {}).total).toBe(0);
    expect(findPayments([], { query: 'x' }).rows).toEqual([]);
  });
});

describe('exceptionKeysOf', () => {
  it('reads the classifier’s own verdict, at every depth, so the filter cannot disagree with the table', () => {
    const processed = {
      rows: [
        { name: 'Expense', isException: false, items: [t('ignored')], sub: [] },
        {
          name: 'Expense Exceptions',
          isException: true,
          sub: [{ name: 'Home Improvement', items: [t('a')], sub: [{ name: 'deeper', items: [t('z')] }] }],
        },
      ],
    };
    const keys = exceptionKeysOf(processed);
    expect([...keys].sort()).toEqual(['a', 'z']);
    expect(exceptionKeysOf(null).size).toBe(0);
  });
});
