import { describe, expect, it } from 'vitest';
import { mergeTransactions, vintageOf } from './mergeTransactions';
import { toCsv } from '../utils/csvWrite';
import { parseCsv } from '../utils/csv';

function row(date, description, account, amount, extra = {}) {
  return {
    Date: date,
    Description: description,
    Account: account,
    Category: 'Groceries',
    'Spending Group': 'Day-to-day',
    'Pay Month': date.slice(0, 7),
    Amount: String(amount),
    AmountNum: amount,
    Type: amount < 0 ? 'Expense' : 'Income',
    Status: 'Completed',
    ...extra,
  };
}

const OLDER = () => [
  row('2026-06-01', 'Checkers', 'FNB Savings *9547', -250),
  row('2026-06-14', 'Spar', 'FNB Bank *9986', -120),
  row('2026-07-02', 'Woolworths', 'FNB Bank *9986', -430, { Status: 'Pending' }),
];

const NEWER = () => [
  row('2026-06-14', 'Spar', 'FNB Bank *9986', -120),
  row('2026-07-02', 'Woolworths', 'FNB Bank *9986', -430, { Status: 'Completed' }),
  row('2026-07-20', 'Makro', 'FNB Bank *9547', -900),
];

describe('vintageOf', () => {
  it('is the latest transaction date in the batch', () => {
    expect(vintageOf(OLDER())).toBe('2026-07-02');
    expect(vintageOf(NEWER())).toBe('2026-07-20');
  });
});

describe('mergeTransactions', () => {
  it('keeps rows that have slid out of the newer export', () => {
    const first = mergeTransactions([], NEWER());
    const second = mergeTransactions(first.rows, OLDER());
    expect(second.counts.added).toBe(1);
    expect(second.rows).toHaveLength(4);
    expect(second.rows.map((r) => r.Description)).toContain('Checkers');
  });

  it('lets a newer export settle a pending row', () => {
    const first = mergeTransactions([], OLDER());
    const second = mergeTransactions(first.rows, NEWER());
    expect(second.counts.updated).toBe(1);
    expect(second.rows.find((r) => r.Description === 'Woolworths').Status).toBe('Completed');
  });

  it('refuses to let an older export un-settle a row', () => {
    const first = mergeTransactions([], NEWER());
    const second = mergeTransactions(first.rows, OLDER());
    expect(second.counts.superseded).toBe(1);
    expect(second.rows.find((r) => r.Description === 'Woolworths').Status).toBe('Completed');
  });

  it('converges on the same rows whichever order the files arrive in', () => {
    const forwards = mergeTransactions(mergeTransactions([], NEWER()).rows, OLDER()).rows;
    const backwards = mergeTransactions(mergeTransactions([], OLDER()).rows, NEWER()).rows;
    const shape = (rows) =>
      rows.map((r) => `${r.Date}|${r.Description}|${r.Status}`).sort();
    expect(shape(backwards)).toEqual(shape(forwards));
  });

  it('treats a renamed account as the same account', () => {
    // "FNB Savings *9547" and "FNB Bank *9547" are one account, so the ids must match.
    const merged = mergeTransactions([], [
      row('2026-06-01', 'Checkers', 'FNB Savings *9547', -250),
      row('2026-06-02', 'Makro', 'FNB Bank *9547', -900),
    ]);
    const ids = [...new Set(merged.rows.map((r) => r.accountId))];
    expect(ids).toEqual(['fnb|9547']);
  });

  it('is idempotent — re-merging the same batch changes nothing', () => {
    const first = mergeTransactions([], NEWER());
    const again = mergeTransactions(first.rows, NEWER());
    expect(again.counts).toMatchObject({ added: 0, updated: 0, superseded: 0, unchanged: 3 });
  });

  it('survives a round trip through the master CSV', () => {
    // The watcher writes rows out and reads them back on the next run. If keys don't survive that,
    // every row looks new again and the master doubles in size on each pass.
    const merged = mergeTransactions([], NEWER());
    const reloaded = parseCsv(toCsv(merged.rows));
    const again = mergeTransactions(reloaded, NEWER());
    expect(again.counts.added).toBe(0);
    expect(again.counts.unchanged).toBe(3);
    expect(again.rows).toHaveLength(3);
  });

  it('numbers identical purchases so neither is lost', () => {
    const twice = [
      row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42),
      row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42),
    ];
    const merged = mergeTransactions([], twice);
    expect(merged.rows).toHaveLength(2);
    expect(mergeTransactions(merged.rows, twice).counts.added).toBe(0);
  });
});
