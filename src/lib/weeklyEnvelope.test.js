import { describe, expect, it } from 'vitest';
import {
  buildWeekdayCurve,
  isDiscreteCadence,
  weekDayRanges,
  weeklyRemainingByWeek,
} from './weeklyEnvelope';

const CYCLE_START = new Date(2026, 6, 23); // Thu 23 Jul 2026
const CYCLE_END = new Date(2026, 7, 22); // Sat 22 Aug 2026
const RANGES = weekDayRanges(CYCLE_START, CYCLE_END);
const STARTS = { '2026-08': CYCLE_START };

// Front-loaded week: half the spend is gone by Tuesday night.
const CURVE = [0.3, 0.5, 0.6, 0.7, 0.8, 0.95, 1];

function tx(date, amount, payMonth = '2026-08') {
  return { 'Pay Month': payMonth, Date: date, AmountNum: amount };
}

describe('weekDayRanges', () => {
  it('splits a Thursday-start cycle into Monday-aligned spans', () => {
    expect(RANGES).toEqual([
      { lo: 1, hi: 4 }, //  23-26 Jul (Thu-Sun, partial)
      { lo: 5, hi: 11 }, // 27 Jul - 2 Aug
      { lo: 12, hi: 18 }, // 3-9 Aug
      { lo: 19, hi: 25 }, // 10-16 Aug
      { lo: 26, hi: 31 }, // 17-22 Aug (stub, 6 days)
    ]);
  });

  it('starts flush when the cycle begins on a Monday', () => {
    const r = weekDayRanges(new Date(2026, 5, 1), new Date(2026, 5, 28));
    expect(r[0]).toEqual({ lo: 1, hi: 7 });
    expect(r).toHaveLength(4);
  });
});

describe('buildWeekdayCurve', () => {
  it('measures the share of a week landed by each weekday', () => {
    const items = [
      tx('2026-07-20', -600, '2026-07'), // Mon
      tx('2026-07-25', -400, '2026-07'), // Sat
    ];
    const curve = buildWeekdayCurve(items, ['2026-07']);
    expect(curve[0]).toBeCloseTo(0.6, 6); // Mon
    expect(curve[4]).toBeCloseTo(0.6, 6); // still 0.6 through Fri
    expect(curve[6]).toBe(1);
  });

  it('falls back to a flat curve when there is too little to learn from', () => {
    expect(buildWeekdayCurve([tx('2026-07-20', -5, '2026-07')], ['2026-07'])).toEqual([
      1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1,
    ]);
  });
});

describe('isDiscreteCadence', () => {
  const prior = ['2026-06', '2026-07'];
  it('treats a once-a-cycle debit order as discrete', () => {
    const rent = [tx('2026-06-01', -7200, '2026-06'), tx('2026-07-01', -7200, '2026-07')];
    expect(isDiscreteCadence(rent, prior)).toBe(true);
  });

  it('treats a stream of small purchases as variable', () => {
    const groceries = [];
    for (let d = 1; d <= 8; d += 1) {
      groceries.push(tx(`2026-06-0${d}`, -300, '2026-06'));
      groceries.push(tx(`2026-07-0${d}`, -300, '2026-07'));
    }
    expect(isDiscreteCadence(groceries, prior)).toBe(false);
  });
});

describe('weeklyRemainingByWeek — the current week is time-aware', () => {
  const weekAvg = [0, 0, -1000, -800, -600];
  const base = {
    sign: -1,
    weekdayCurve: CURVE,
    dayRanges: RANGES,
    discrete: false,
  };

  const run = (asOf, dataThrough, items = []) =>
    weeklyRemainingByWeek(items, '2026-08', STARTS, 2, weekAvg, { ...base, asOf, dataThrough });

  it('locks elapsed weeks at zero and carries future weeks in full', () => {
    const r = run(new Date(2026, 7, 6), new Date(2026, 7, 6));
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0);
    expect(r[3]).toBe(-800);
    expect(r[4]).toBe(-600);
  });

  it('projects less as the week wears on', () => {
    const mon = run(new Date(2026, 7, 3), new Date(2026, 7, 3))[2];
    const thu = run(new Date(2026, 7, 6), new Date(2026, 7, 6))[2];
    const sun = run(new Date(2026, 7, 9), new Date(2026, 7, 9))[2];
    // Same category, same history — only the day differs.
    expect(Math.abs(mon)).toBeGreaterThan(Math.abs(thu));
    expect(Math.abs(thu)).toBeGreaterThan(Math.abs(sun));
    expect(sun).toBe(-0); // the week is over; nothing left to come
  });

  it('projects less again when the week is running quiet', () => {
    const onPace = run(new Date(2026, 7, 6), new Date(2026, 7, 6), [tx('2026-08-04', -700)])[2];
    const quiet = run(new Date(2026, 7, 6), new Date(2026, 7, 6), [tx('2026-08-04', -50)])[2];
    expect(Math.abs(quiet)).toBeLessThan(Math.abs(onPace));
  });

  it('measures pace against the window the data actually covers', () => {
    // Data ends Tuesday, today is Thursday. Judging Tuesday's spend against Thursday's expectation
    // would understate the pace and under-project the rest of the week.
    const items = [tx('2026-08-04', -400)]; // Tue
    const honest = run(new Date(2026, 7, 6), new Date(2026, 7, 4), items)[2];
    const naive = run(new Date(2026, 7, 6), new Date(2026, 7, 6), items)[2];
    expect(Math.abs(honest)).toBeGreaterThan(Math.abs(naive));
  });

  it('does not prorate a discrete bill within its week', () => {
    const r = weeklyRemainingByWeek([], '2026-08', STARTS, 2, weekAvg, {
      ...base,
      discrete: true,
      asOf: new Date(2026, 7, 6),
      dataThrough: new Date(2026, 7, 6),
    });
    // Thursday, nothing landed yet — a Friday debit order still expects its full amount.
    expect(r[2]).toBe(-1000);
  });

  it('stops expecting a discrete bill once it has landed', () => {
    const r = weeklyRemainingByWeek([tx('2026-08-04', -1000)], '2026-08', STARTS, 2, weekAvg, {
      ...base,
      discrete: true,
      asOf: new Date(2026, 7, 6),
      dataThrough: new Date(2026, 7, 6),
    });
    expect(r[2]).toBe(-0);
  });

  it('is not fooled by a refund larger than the weekly average', () => {
    // The old test was `Math.abs(actual) >= Math.abs(avg)`, so a big credit in an expense category
    // read as "already over budget" and zeroed the rest of the week.
    const r = run(new Date(2026, 7, 3), new Date(2026, 7, 3), [tx('2026-08-03', 5000)]);
    expect(r[2]).toBeLessThan(0);
    expect(Math.abs(r[2])).toBeGreaterThan(100);
  });
});
