import { describe, expect, it } from 'vitest';
import { buildDrift } from './drift';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers, completeMonths } from './flows';
import { loadRealExport } from '../test/realData';

/** The currency formatter uses non-breaking spaces; sentences are compared in plain ones. */
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

/**
 * Anchors on the real export's 23rd→22nd cycle, Aug 2024 – Jul 2026, data through 18 Aug 2026:
 * complete cycles 2024-09..2026-07, so the recent window is 2026-05..07 and the baseline the
 * twelve before it, 2025-05..2026-04. A row dated the 1st–20th lands in that month's cycle.
 */
const BANK = 'FNB Bank *2000';

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

const BASELINE = ['2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'];
const RECENT = ['2026-05', '2026-06', '2026-07'];

/** One row per cycle for `category`, amounts by cycle key. */
function series(cycleKeys, amounts, category, description = 'Vet') {
  return cycleKeys.map((key, i) => row(`${key}-10`, description, BANK, -amounts[i], { Category: category }));
}

function build(extraRows) {
  const data = withIds([...anchors(), ...extraRows]);
  const calendar = buildCycleCalendar(data, months(data), ASOF);
  const transfers = buildFullTransfers(data);
  return { drift: buildDrift(data, { transfers, calendar }), calendar };
}

describe('buildDrift', () => {
  it('uses the last three complete cycles against the twelve before them', () => {
    const { drift, calendar } = build([]);
    expect(completeMonths(calendar).at(-1)).toBe('2026-07');
    expect(drift.recent).toEqual(RECENT);
    expect(drift.baseline).toEqual(BASELINE);
  });

  it('flags a category that jumped well outside its usual range', () => {
    const baseline = BASELINE.map((_, i) => (i % 2 ? 1050 : 950));
    const { drift } = build([...series(BASELINE, baseline, 'Pets'), ...series(RECENT, [1600, 1600, 1600], 'Pets')]);
    const pets = drift.categories.find((c) => c.category === 'Pets');
    expect(pets.baselineMedian).toBe(1000);
    expect(pets.baselineSd).toBeCloseTo(74.13, 2);
    expect(pets.recentMedian).toBe(1600);
    expect(pets.delta).toBe(600);
    expect(pets.z).toBeCloseTo(8.094, 2);
    expect(pets.flagged).toBe(true);
    expect(pets.direction).toBe('up');
    expect(pets.perYear).toBe(7200);
    expect(plain(pets.sentence)).toBe('Pets: R 1 600 a cycle, far outside the usual R 1 000 ± R 74');
    expect(pets.series).toHaveLength(15);
    expect(pets.series[0]).toEqual({ month: '2025-05', total: 950 });
    expect(pets.topMerchants).toEqual([{ label: 'Vet', recentPerCycle: 1600 }]);
    expect(drift.flagged.map((c) => c.category)).toEqual(['Pets']);
    expect(drift.upPerCycle).toBe(600);
    expect(drift.downPerCycle).toBe(0);
  });

  it('is not fooled by one enormous baseline month', () => {
    const baseline = BASELINE.map((_, i) => (i === 5 ? 10000 : 1000));
    const { drift } = build([...series(BASELINE, baseline, 'Pets'), ...series(RECENT, [1000, 1000, 1000], 'Pets')]);
    const pets = drift.categories.find((c) => c.category === 'Pets');
    expect(pets.baselineMedian).toBe(1000);
    expect(pets.flagged).toBe(false);
  });

  it('floors the spread so a fixed bill is not infinitely significant, and needs R300 to flag', () => {
    const { drift } = build([...series(BASELINE, BASELINE.map(() => 500), 'Pets'), ...series(RECENT, [520, 520, 520], 'Pets')]);
    const pets = drift.categories.find((c) => c.category === 'Pets');
    expect(pets.baselineSd).toBe(50);
    expect(pets.z).toBeCloseTo(0.4, 9);
    expect(pets.flagged).toBe(false);
    expect(plain(pets.sentence)).toBe('Pets: R 520 a cycle against the usual R 500.');
  });

  it('skips a category absent from the baseline', () => {
    const { drift } = build(series(RECENT, [5000, 5000, 5000], 'Donations (Out)', 'Gift Aid'));
    expect(drift.categories.find((c) => c.category === 'Donations (Out)')).toBeUndefined();
  });

  it('excludes the cycle in progress while the data stops short of its end', () => {
    const { drift, calendar } = build([
      ...series(BASELINE, BASELINE.map(() => 1000), 'Pets'),
      ...series(RECENT, [1000, 1000, 1000], 'Pets'),
      row('2026-08-10', 'Vet', BANK, -90000, { Category: 'Pets' }),
    ]);
    expect(calendar.currentMonth).toBe('2026-08');
    expect(drift.recent).not.toContain('2026-08');
    const pets = drift.categories.find((c) => c.category === 'Pets');
    expect(pets.recentMedian).toBe(1000);
    expect(pets.flagged).toBe(false);
  });

  it('flags a fall as down and sums each direction separately', () => {
    const { drift } = build([
      ...series(BASELINE, BASELINE.map(() => 3000), 'Cellphone', 'Vodacom'),
      ...series(RECENT, [100, 100, 100], 'Cellphone', 'Vodacom'),
      ...series(BASELINE, BASELINE.map(() => 1000), 'Pets'),
      ...series(RECENT, [1600, 1600, 1600], 'Pets'),
    ]);
    expect(drift.flagged.map((c) => [c.category, c.direction])).toEqual([
      ['Cellphone', 'down'],
      ['Pets', 'up'],
    ]);
    expect(drift.downPerCycle).toBe(2900);
    expect(drift.upPerCycle).toBe(600);
    const cell = drift.categories.find((c) => c.category === 'Cellphone');
    expect(cell.share).toBeCloseTo(100 / 1700, 9);
  });

  it('returns nothing rather than guessing with fewer than six baseline cycles', () => {
    const data = withIds(anchors().filter((t) => t.Date < '2025-01-01'));
    const calendar = buildCycleCalendar(data, months(data), ASOF);
    const drift = buildDrift(data, { transfers: buildFullTransfers(data), calendar });
    expect(drift.categories).toEqual([]);
    expect(drift.recent).toEqual([]);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('drift on the real export', () => {
  // The body runs even when skipped; a missing export must not break collection.
  if (!real) return;
  const allMonths = months(real ?? []);
  const calendar = buildCycleCalendar(real, allMonths, ASOF);
  const transfers = buildFullTransfers(real);
  const drift = buildDrift(real, { transfers, calendar });

  it('reads the last three complete cycles against twelve, and flags a handful of categories', () => {
    expect(drift.recent).toHaveLength(3);
    expect(drift.baseline).toHaveLength(12);
    expect(drift.categories.length).toBeGreaterThan(10);
    expect(drift.flagged.length).toBeGreaterThanOrEqual(2);
    expect(drift.flagged.length).toBeLessThanOrEqual(8);
    drift.flagged.forEach((c) => {
      expect(Math.abs(c.z)).toBeGreaterThanOrEqual(2.5);
      expect(Math.abs(c.delta)).toBeGreaterThanOrEqual(300);
      expect(c.baselineMedian).toBeGreaterThanOrEqual(200);
      expect(c.topMerchants.length).toBeGreaterThan(0);
    });
    expect(drift.flagged.some((c) => c.category === 'Groceries' && c.direction === 'up')).toBe(true);
    expect(drift.flagged.some((c) => c.category === 'Cellphone' && c.direction === 'down')).toBe(true);
  });
});
