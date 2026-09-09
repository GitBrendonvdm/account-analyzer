import { describe, expect, it } from 'vitest';
import { applyTxnOverrides, flagOf, labelChoices, overrideBadge, sharedOverride } from './txnOverrides';
import { resolveMainGroup } from './exceptions';
import { processTransactionData } from './processTransactionData';
import { assignKeys } from '../db/txnKey';
import { loadRealExport } from '../test/realData';

const row = (key, over = {}) => ({
  key,
  Category: 'Groceries',
  'Spending Group': 'Day-to-day',
  AmountNum: -500,
  id: 1,
  ...over,
});

describe('applyTxnOverrides', () => {
  it('rewrites the labels of the rows it names, and only those', () => {
    const data = [row('a'), row('b'), row('c')];
    const out = applyTxnOverrides(data, {
      a: { category: 'Home Maintenance' },
      b: { spendingGroup: 'Once-off' },
      c: { flag: 'unexpected' },
    });
    expect(out[0].Category).toBe('Home Maintenance');
    expect(out[0]['Spending Group']).toBe('Day-to-day');
    expect(out[1].Category).toBe('Groceries');
    expect(out[1]['Spending Group']).toBe('Once-off');
    // A flag is not a field on the row — it travels to the classifier instead.
    expect(out[2]).toBe(data[2]);
  });

  it('returns the very same array when nothing re-labels, so the memo below it holds', () => {
    const data = [row('a'), row('b')];
    expect(applyTxnOverrides(data, null)).toBe(data);
    expect(applyTxnOverrides(data, {})).toBe(data);
    expect(applyTxnOverrides(data, { a: { flag: 'expected' } })).toBe(data);
    expect(applyTxnOverrides(data, { a: { category: 'X' } })).not.toBe(data);
  });

  it('leaves rows without a key alone', () => {
    const [only] = applyTxnOverrides([row(undefined)], { undefined: { category: 'X' } });
    expect(only.Category).toBe('Groceries');
  });
});

describe('resolveMainGroup with the reader’s verdicts', () => {
  const state = {
    incomeSparseCategories: new Set(['Bonus']),
    expenseSparseCategories: new Set(['Home Maintenance']),
    excessIds: new Set([99]),
    transferIds: new Set(),
    flags: null,
  };

  it('classifies by sparsity when the reader has said nothing', () => {
    expect(resolveMainGroup(row('a', { Category: 'Home Maintenance' }), state)).toBe('Expense Exceptions');
    expect(resolveMainGroup(row('a'), state)).toBe('Expense');
    expect(resolveMainGroup(row('a', { Category: 'Bonus', AmountNum: 900 }), state)).toBe('Income Exceptions');
  });

  it('"expected" pulls a payment back into the ordinary flow, sparsity or not', () => {
    const flags = { a: { flag: 'expected' } };
    const sparse = row('a', { Category: 'Home Maintenance' });
    expect(resolveMainGroup(sparse, { ...state, flags })).toBe('Expense');
    // Including the surplus half of a split charge, which shares its parent's key.
    const surplus = row('a', { Category: 'Groceries', id: 99 });
    expect(resolveMainGroup(surplus, state)).toBe('Expense Exceptions');
    expect(resolveMainGroup(surplus, { ...state, flags })).toBe('Expense');
  });

  it('"unexpected" pushes an ordinary payment out of the flow', () => {
    const flags = { a: { flag: 'unexpected' } };
    expect(resolveMainGroup(row('a'), { ...state, flags })).toBe('Expense Exceptions');
    expect(resolveMainGroup(row('a', { AmountNum: 900 }), { ...state, flags })).toBe('Income Exceptions');
  });

  it('never turns a transfer into a flow — both legs are the same money', () => {
    const transfers = { ...state, transferIds: new Set([7]), flags: { a: { flag: 'expected' } } };
    expect(resolveMainGroup(row('a', { id: 7 }), transfers)).toBe('Transfers');
  });

  it('ignores a verdict it does not recognise', () => {
    expect(flagOf(row('a'), { a: { flag: 'maybe' } })).toBeNull();
    expect(resolveMainGroup(row('a', { Category: 'Home Maintenance' }), { ...state, flags: { a: { flag: 'maybe' } } })).toBe(
      'Expense Exceptions',
    );
  });
});

describe('sharedOverride', () => {
  const overrides = {
    a: { flag: 'expected', category: 'Groceries' },
    b: { flag: 'expected', category: 'Fuel' },
  };

  it('reports a field only where every payment on the row agrees', () => {
    expect(sharedOverride(['a', 'b'], overrides)).toEqual({
      flag: 'expected',
      category: null,
      spendingGroup: null,
    });
    expect(sharedOverride(['a'], overrides).category).toBe('Groceries');
    expect(sharedOverride(['a', 'zzz'], overrides).flag).toBeNull();
    expect(sharedOverride([], overrides)).toEqual({});
  });

  it('summarises a correction so it is visible without opening the editor', () => {
    expect(overrideBadge({ flag: 'unexpected' })).toBe('unexpected');
    expect(overrideBadge({ flag: 'expected', category: 'Fuel' })).toBe('expected → Fuel');
    expect(overrideBadge({ spendingGroup: 'Once-off' })).toBe('→ Once-off');
    expect(overrideBadge({})).toBeNull();
    expect(overrideBadge(null)).toBeNull();
  });
});

describe('labelChoices', () => {
  it('offers only labels already in the file, sorted and deduped', () => {
    const { categories, spendingGroups } = labelChoices([
      row('a', { Category: 'Fuel' }),
      row('b', { Category: 'Groceries', 'Spending Group': 'Once-off' }),
      row('c', { Category: '  ', 'Spending Group': '' }),
      row('d', { Category: 'Fuel' }),
    ]);
    // A free-text box would let one typo split a category in two, unnoticed by everything downstream.
    expect(categories).toEqual(['Fuel', 'Groceries']);
    expect(spendingGroups).toEqual(['Day-to-day', 'Once-off']);
    expect(labelChoices(null).categories).toEqual([]);
  });
});

const real = loadRealExport();
describe.skipIf(!real)('a correction on the real export', () => {
  const data = () => assignKeys(loadRealExport());
  const asOf = new Date(2026, 7, 10);
  const run = (rows, overrides) => {
    const names = [...new Set(rows.map((t) => t.Account))];
    return processTransactionData(applyTxnOverrides(rows, overrides), names, 13, asOf, {
      txnOverrides: overrides,
    });
  };

  it('moves one payment out of the exceptions, to the cent', () => {
    const rows = data();
    const base = run(rows, null);
    const cycle = base.currentMonth;
    const exceptions = base.rows.find((r) => r.name === 'Expense Exceptions');
    const victim = exceptions.sub[0].items[0];
    expect(victim.key).toBeTruthy();

    const after = run(rows, { [victim.key]: { flag: 'expected' } });
    const before = exceptions.totalsByMonth[cycle] ?? 0;
    const now = after.rows.find((r) => r.name === 'Expense Exceptions').totalsByMonth[cycle] ?? 0;
    expect(now - before).toBeCloseTo(-victim.AmountNum, 2);
  });

  it('carries a re-label through the whole pipeline', () => {
    const rows = data();
    const victim = run(rows, null).rows.find((r) => r.name === 'Expense').sub[0].items[0];
    const moved = run(rows, { [victim.key]: { category: 'Zzz Moved' } });
    const categories = moved.rows
      .flatMap((g) => g.sub ?? [])
      .flatMap((s) => (s.isSpendingGroup ? (s.sub ?? []) : [s]))
      .map((c) => c.name);
    expect(categories).toContain('Zzz Moved');
  });

  it('never changes Net Total — reclassifying money neither creates nor destroys it', () => {
    const rows = data();
    const base = run(rows, null);
    const victim = base.rows.find((r) => r.name === 'Expense Exceptions').sub[0].items[0];
    const net = (p) => Math.round(p.netByMonth.at(-1));
    expect(net(run(rows, { [victim.key]: { flag: 'expected' } }))).toBe(net(base));
    expect(net(run(rows, { [victim.key]: { flag: 'unexpected' } }))).toBe(net(base));
    expect(net(run(rows, { [victim.key]: { category: 'Zzz Moved' } }))).toBe(net(base));
  });
});
