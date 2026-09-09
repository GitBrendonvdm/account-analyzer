import { describe, expect, it } from 'vitest';
import { BAND_MIN_CYCLES, combine, forecastBand, remainderPerCycle } from './forecastBand';

/** Six cycles starting on the 23rd, the shape the real export uses. */
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const starts = Object.fromEntries(
  MONTHS.map((m) => {
    const [y, mm] = m.split('-').map(Number);
    return [m, new Date(y, mm - 1, 23)];
  }),
);

/** A transaction on `day` (1-based) of cycle `month`. */
const at = (month, day, amount) => {
  const s = starts[month];
  return {
    'Pay Month': month,
    DateObj: new Date(s.getFullYear(), s.getMonth(), s.getDate() + day - 1),
    AmountNum: amount,
  };
};

describe('remainderPerCycle', () => {
  it('sums only what landed on or after the cycle day, per cycle, in order', () => {
    const items = [
      at('2026-03', 5, -100), // before day 10 — not counted
      at('2026-03', 12, -300),
      at('2026-03', 20, -200),
      at('2026-04', 10, -50), // exactly on the day — counted
      // Day 31 of the June cycle is 23 July by the calendar, but the row's own Pay Month is
      // what buckets it — the same rule every other total in the app uses.
      at('2026-06', 31, -700),
    ];
    expect(remainderPerCycle(items, MONTHS, starts, 10)).toEqual([-500, -50, 0, -700, 0, 0]);
  });

  it('ignores rows from cycles outside the window, and rows it cannot date', () => {
    const items = [
      at('2026-03', 15, -100),
      { 'Pay Month': '2025-12', DateObj: new Date(2025, 11, 25), AmountNum: -999 },
      { 'Pay Month': '2026-04', DateObj: null, Date: 'not a date', AmountNum: -999 },
    ];
    expect(remainderPerCycle(items, MONTHS, starts, 1)).toEqual([-100, 0, 0, 0, 0, 0]);
    expect(remainderPerCycle([], MONTHS, starts, 1)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('combine', () => {
  it('adds arrays cycle by cycle, so a level rolls up without inventing a worst case', () => {
    // Two rows whose bad cycles fall in DIFFERENT cycles. Summing their p90s would claim a cycle
    // costing 200; no cycle ever cost more than 110.
    const a = [-100, -10, -10, -10];
    const b = [-10, -100, -10, -10];
    expect(combine([a, b])).toEqual([-110, -110, -20, -20]);

    const band = forecastBand(0, 0, combine([a, b]));
    expect(band.low).toBeGreaterThanOrEqual(-110);

    expect(combine([])).toEqual([]);
    expect(combine([a, []])).toEqual(a);
    expect(combine([[1, 2], [1]])).toEqual([2, 2]);
  });
});

describe('forecastBand', () => {
  const steady = [-1000, -1100, -900, -1050, -950, -1000];

  it('brackets the mid with what the row has actually run', () => {
    const band = forecastBand(-5000, -1000, steady);
    expect(band.mid).toBe(-6000);
    expect(band.low).toBeLessThan(band.mid);
    expect(band.high).toBeGreaterThan(band.mid);
    expect(band.cycles).toBe(6);
    expect(band.midOutside).toBe(false);
    // The edges are the row's own history, offset by what is already booked.
    expect(band.low).toBeCloseTo(-5000 + -1075, 6);
    expect(band.high).toBeCloseTo(-5000 + -925, 6);
  });

  it('works the same way for income, where bigger is better', () => {
    const income = [4000, 4200, 3900, 4100, 4000, 4050];
    const band = forecastBand(20000, 4000, income);
    expect(band.low).toBeLessThan(band.mid);
    expect(band.high).toBeGreaterThan(band.mid);
    expect(band.mid).toBe(24000);
  });

  it('widens to contain a mid the history never saw, and says that it did', () => {
    // The envelope expects far more left to spend than any prior cycle needed at this point.
    const band = forecastBand(-5000, -4000, steady);
    expect(band.mid).toBe(-9000);
    expect(band.low).toBe(-9000);
    expect(band.midOutside).toBe(true);
    // A range that excluded its own figure would read as a bug to everyone who met it.
    expect(band.low).toBeLessThanOrEqual(band.mid);
    expect(band.high).toBeGreaterThanOrEqual(band.mid);
  });

  it('says nothing rather than guessing from too little history', () => {
    expect(forecastBand(0, 0, steady.slice(0, BAND_MIN_CYCLES - 1))).toBeNull();
    expect(forecastBand(0, 0, [])).toBeNull();
    expect(forecastBand(0, 0, null)).toBeNull();
    expect(forecastBand(0, 0, steady.slice(0, BAND_MIN_CYCLES))).not.toBeNull();
  });
});
