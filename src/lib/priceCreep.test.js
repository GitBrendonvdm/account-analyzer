import { describe, expect, it } from 'vitest';
import { buildPriceCreep } from './priceCreep';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers } from './flows';
import { buildRecurringLines } from './recurring';
import { loadRealExport } from '../test/realData';

/** The currency formatter uses non-breaking spaces; sentences are compared in plain ones. */
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

/** Cycle keys for n consecutive cycles from 2024-09. */
function cycles(n, from = '2024-09') {
  const [y, m] = from.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(y, m - 1 + i, 1);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
  });
}

/** A monthly line whose regimes are given as [amount, count] runs, consecutive from 2024-09. */
function line(runs, over = {}) {
  const keys = cycles(runs.reduce((s, [, n]) => s + n, 0));
  let at = 0;
  const regimes = runs.map(([amount, count]) => {
    const regime = { from: keys[at], to: keys[at + count - 1], amount, count };
    at += count;
    return regime;
  });
  const perCycleAmounts = runs.flatMap(([amount, count]) => Array(count).fill(amount)).slice(-12);
  const observations = runs.reduce((s, [, n]) => s + n, 0) + (over.outliers ?? 0);
  return {
    id: 'x|fnb|2000|0',
    label: 'X',
    kind: 'optional',
    category: 'Software & Services',
    cadence: 'monthly',
    perYear: 12,
    observations,
    outliers: 0,
    regimes,
    perCycleAmounts,
    cyclesPresent: Math.min(12, observations),
    ...over,
  };
}

describe('buildPriceCreep', () => {
  it('reads one step and what it costs', () => {
    const out = buildPriceCreep([line([[100, 12], [120, 12]])]);
    expect(out.rising).toHaveLength(1);
    const r = out.rising[0];
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toEqual({ cycle: '2025-09', from: 100, to: 120, pct: expect.closeTo(0.2, 9), count: 12 });
    expect(r.first).toEqual({ cycle: '2024-09', amount: 100, count: 12 });
    expect(r.last).toEqual({ cycle: '2025-09', amount: 120, count: 12 });
    expect(r.totalPct).toBeCloseTo(0.2, 9);
    expect(r.extraPerCycle).toBe(20);
    expect(r.extraPerYear).toBe(240);
    expect(out.extraPerCycle).toBe(20);
    expect(out.extraPerYear).toBe(240);
    expect(plain(r.sentence)).toBe('X: R 100 → R 120 (+20%) since Sep 2025 — R 240 a year more.');
    expect(plain(out.sentence)).toContain('R 20 more a cycle');
  });

  it('treats a single odd amount as an outlier, not a step', () => {
    const out = buildPriceCreep([line([[100, 23]], { outliers: 1 })]);
    expect(out.rising).toHaveLength(0);
    expect(out.falling).toHaveLength(0);
    expect(out.variable).toHaveLength(0);
    const trailing = buildPriceCreep([line([[100, 23], [150, 1]])]);
    expect(trailing.rising).toHaveLength(0);
  });

  it('sets aside a line whose amounts are mostly one-offs', () => {
    const runs = [];
    for (let i = 0; i < 4; i += 1) runs.push([100, 1], [130, 1], [160, 1]);
    const out = buildPriceCreep([line(runs)]);
    expect(out.variable).toHaveLength(1);
    expect(out.variable[0].singletonShare).toBe(1);
    expect(out.rising).toHaveLength(0);
    expect(out.variableSentence).toBe('1 line vary too much to compare');
  });

  it('reports a large drop as falling', () => {
    const out = buildPriceCreep([line([[3006, 12], [52, 6]])]);
    expect(out.falling).toHaveLength(1);
    expect(out.falling[0].totalPct).toBeCloseTo(52 / 3006 - 1, 6);
    expect(out.falling[0].extraPerCycle).toBe(52 - 3006);
    expect(out.extraPerCycle).toBe(0);
  });

  it('lists an instalment that moved but never totals it', () => {
    const falling = line([[24868, 12], [22855, 6]], { kind: 'instalment', id: 'loan|x' });
    const rising = line([[22855, 6], [24868, 12]], { kind: 'instalment', id: 'loan|y' });
    const out = buildPriceCreep([falling, rising]);
    expect(out.falling).toHaveLength(1);
    expect(out.falling[0].countsInTotal).toBe(false);
    expect(out.rising).toHaveLength(1);
    expect(out.rising[0].countsInTotal).toBe(false);
    expect(out.extraPerCycle).toBe(0);
    // Interest on a card is a cost of a balance, not a price.
    const interest = line([[100, 6], [200, 6]], { kind: 'other', category: 'Interest' });
    expect(buildPriceCreep([interest]).extraPerCycle).toBe(0);
  });

  it('anchors the starting price on an amount charged at least three times', () => {
    // Two opening charges at R850 then twenty at R3 000: one price, not a 253% increase.
    expect(buildPriceCreep([line([[850, 2], [3000, 11]])]).rising).toHaveLength(0);
    // A pro-rata ramp before the real premium: the creep is 1 965 → 2 219, not 756 → 2 219.
    const out = buildPriceCreep([line([[756, 2], [1965, 10], [2219, 11]])]);
    expect(out.rising).toHaveLength(1);
    expect(out.rising[0].first.amount).toBe(1965);
    expect(out.rising[0].steps).toHaveLength(1);
    expect(out.rising[0].extraPerCycle).toBe(254);
    // A fresh step with only two charges at the new price still counts as a step.
    const fresh = buildPriceCreep([line([[240, 11], [250, 11], [475, 2]])]);
    expect(fresh.rising[0].steps).toHaveLength(2);
    expect(fresh.rising[0].last.count).toBe(2);
  });

  it('ignores weekly lines and lines with too little history', () => {
    const weekly = line([[100, 12], [120, 12]], { cadence: 'weekly', perYear: 52 });
    const short = line([[100, 3], [120, 2]], { cyclesPresent: 5 });
    const out = buildPriceCreep([weekly, short]);
    expect(out.rising).toHaveLength(0);
    expect(out.variable).toHaveLength(0);
  });

  it('needs both the percentage and the rand floor', () => {
    expect(buildPriceCreep([line([[100, 6], [105, 6]])]).rising).toHaveLength(0); // R5 < R10
    expect(buildPriceCreep([line([[1000, 6], [1030, 6]])]).rising).toHaveLength(0); // 3% < 4%
    expect(buildPriceCreep([line([[1000, 6], [1050, 6]])]).rising).toHaveLength(1);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('price creep on the real export', () => {
  // The body runs even when skipped; a missing export must not break collection.
  if (!real) return;
  const asOf = new Date(2026, 7, 22);
  const allMonths = [...new Set((real ?? []).map((t) => t['Pay Month']))].sort();
  const calendar = buildCycleCalendar(real, allMonths, asOf);
  const transfers = buildFullTransfers(real);
  const { lines } = buildRecurringLines(real, { calendar, transfers, asOf });
  const out = buildPriceCreep(lines);

  it('shows the internet line stepping at least three times and the account fee stepping in 2026-07', () => {
    const isp = out.rising.find((r) => r.kind === 'optional' && r.category === 'Other Phone & Internet');
    expect(isp).toBeDefined();
    expect(isp.steps.length).toBeGreaterThanOrEqual(3);
    expect(isp.totalPct).toBeGreaterThanOrEqual(0.9);
    const fee = out.rising.find((r) => r.kind === 'fee' && r.steps.some((s) => s.cycle === '2026-07'));
    expect(fee).toBeDefined();
  });

  it('totals only the prices, never the instalments, and sets the variable lines aside', () => {
    expect(out.extraPerCycle).toBeGreaterThan(500);
    expect(out.extraPerCycle).toBeLessThan(5000);
    [...out.rising, ...out.falling].forEach((r) => {
      if (r.kind === 'instalment' || r.kind === 'repayment') expect(r.countsInTotal).toBe(false);
      expect(r.first.count).toBeGreaterThanOrEqual(3);
      r.steps.forEach((s) => expect(s.count).toBeGreaterThanOrEqual(2));
    });
    out.variable.forEach((v) => expect(v.singletonShare).toBeGreaterThan(0.3));
  });
});
