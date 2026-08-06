import { describe, expect, it } from 'vitest';
import { buildAccountMovementSeries, buildAccountSummaries } from './accountSeries';

const tx = (account, date, amount, payMonth = '2026-08', extra = {}) => ({
  Account: account,
  Date: date,
  AmountNum: amount,
  'Pay Month': payMonth,
  ...extra,
});

describe('buildAccountMovementSeries', () => {
  it('accumulates each account independently from zero', () => {
    const { accounts } = buildAccountMovementSeries(
      [tx('A', '2026-08-01', 100), tx('A', '2026-08-02', -30), tx('B', '2026-08-01', -500)],
      ['A', 'B'],
    );
    const a = accounts.find((x) => x.account === 'A');
    expect(a.points.map((p) => p.value)).toEqual([100, 70]);
    expect(a.change).toBe(70);
    expect(accounts.find((x) => x.account === 'B').change).toBe(-500);
  });

  it('includes transfers — they really do move an account\'s money', () => {
    const rows = [
      tx('A', '2026-08-01', -5000, '2026-08', { 'Spending Group': 'Transfer' }),
      tx('B', '2026-08-01', 5000, '2026-08', { 'Spending Group': 'Transfer' }),
    ];
    const { accounts } = buildAccountMovementSeries(rows, ['A', 'B']);
    expect(accounts.find((x) => x.account === 'A').change).toBe(-5000);
    expect(accounts.find((x) => x.account === 'B').change).toBe(5000);
  });

  it('honours the account filter', () => {
    const { accounts } = buildAccountMovementSeries(
      [tx('A', '2026-08-01', 100), tx('B', '2026-08-01', 200)],
      ['A'],
    );
    expect(accounts.map((a) => a.account)).toEqual(['A']);
  });

  it('enters a narrowed window at the height it had reached', () => {
    // Anchoring to the window instead of the dataset would make every curve jump when the month
    // slider moved; the baseline keeps the change measured over the window itself.
    const rows = [tx('A', '2026-06-01', 1000), tx('A', '2026-08-01', 250)];
    const { accounts } = buildAccountMovementSeries(rows, ['A'], { from: new Date(2026, 6, 1) });
    const a = accounts[0];
    expect(a.points).toHaveLength(1);
    expect(a.points[0].value).toBe(1250); // carried in from before the window
    expect(a.baseline).toBe(1000);
    expect(a.change).toBe(250); // ...but the movement shown is the window's
  });

  it('returns nothing for empty input', () => {
    expect(buildAccountMovementSeries([], []).accounts).toEqual([]);
    expect(buildAccountMovementSeries(null, ['A']).accounts).toEqual([]);
  });
});

describe('buildAccountSummaries', () => {
  it('splits the current cycle into in and out, against a prior-cycle typical', () => {
    const rows = [
      tx('A', '2026-07-01', 1000, '2026-07'),
      tx('A', '2026-08-01', 500, '2026-08'),
      tx('A', '2026-08-02', -200, '2026-08'),
    ];
    const [a] = buildAccountSummaries(rows, ['A'], ['2026-07', '2026-08'], '2026-08');
    expect(a.cycleIn).toBe(500);
    expect(a.cycleOut).toBe(-200);
    expect(a.cycleNet).toBe(300);
    expect(a.typicalNet).toBe(1000);
    expect(a.count).toBe(3);
  });
});
