import { describe, expect, it } from 'vitest';
import {
  dispersion,
  mad,
  mean,
  median,
  mode,
  ols,
  quantile,
  robustSd,
  theilSen,
  winsorise,
} from './stats';
import { loadRealExport } from '../test/realData';

describe('stats', () => {
  it('median: odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('mean', () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(mean([])).toBe(0);
  });

  it('quantile interpolates linearly', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([4, 1, 3, 2], 1)).toBe(4);
    expect(quantile([7], 0.3)).toBe(7);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('mad is unmoved by one wild value; robustSd scales it', () => {
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(robustSd([1, 2, 3, 4, 100])).toBeCloseTo(1.4826, 6);
    expect(mad([])).toBe(0);
  });

  it('dispersion is mad over the median of magnitudes, Infinity with no level', () => {
    expect(dispersion([0, 0])).toBe(Infinity);
    expect(dispersion([])).toBe(Infinity);
    expect(dispersion([100, 100, 100])).toBe(0);
    expect(dispersion([-100, -100, -120])).toBe(0);
    expect(dispersion([100, 110, 90, 100])).toBeCloseTo(0.05, 10);
  });

  it('mode: most frequent, ties to the smallest, empty to null', () => {
    expect(mode([1, 2, 2, 3])).toBe(2);
    expect(mode([3, 1, 3, 1])).toBe(1);
    expect(mode([])).toBeNull();
  });

  it('theilSen: slope 1 on a line, and still 1 with one outlier in four', () => {
    expect(theilSen([1, 2, 3, 4]).slope).toBe(1);
    expect(theilSen([1, 2, 3, 4]).intercept).toBe(1);
    expect(theilSen([1, 2, 3, 40]).slope).toBe(1);
    expect(theilSen([5]).slope).toBe(0);
    expect(theilSen([5]).intercept).toBe(5);
    expect(theilSen([])).toEqual({ slope: 0, intercept: 0 });
  });

  it('ols: exact fit', () => {
    const fit = ols([0, 1, 2], [1, 3, 5]);
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(1, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.n).toBe(3);
  });

  it('ols: degenerate inputs', () => {
    expect(ols([1], [2])).toEqual({ slope: 0, intercept: 0, r2: 0, n: 1 });
    // A flat series fits itself perfectly.
    expect(ols([0, 1, 2], [4, 4, 4]).r2).toBe(1);
    // No spread in x: nothing to fit, intercept at the mean.
    const flat = ols([2, 2, 2], [1, 2, 3]);
    expect(flat.slope).toBe(0);
    expect(flat.intercept).toBe(2);
  });

  it('winsorise clamps to the percentiles only with enough observations', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const clamped = winsorise(xs);
    expect(Math.max(...clamped)).toBeCloseTo(quantile(xs, 0.9), 10);
    expect(Math.min(...clamped)).toBeCloseTo(quantile(xs, 0.1), 10);
    expect(winsorise([1, 100])).toEqual([1, 100]);
    expect(winsorise(xs, { lower: 0, upper: 1 })).toEqual(xs);
    // Never mutates.
    expect(xs[9]).toBe(100);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('stats on the real export', () => {
  it('orders the quartiles of per-cycle spend and keeps them finite', () => {
    const byCycle = new Map();
    real.forEach((t) => {
      if (t.AmountNum < 0) byCycle.set(t['Pay Month'], (byCycle.get(t['Pay Month']) ?? 0) - t.AmountNum);
    });
    const totals = [...byCycle.values()];
    expect(totals.length).toBeGreaterThan(12);
    const q25 = quantile(totals, 0.25);
    const mid = median(totals);
    const q75 = quantile(totals, 0.75);
    expect(Number.isFinite(mid)).toBe(true);
    expect(q25).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThanOrEqual(q75);
    expect(dispersion(totals)).toBeLessThan(1);
    expect(winsorise(totals).length).toBe(totals.length);
  });
});
