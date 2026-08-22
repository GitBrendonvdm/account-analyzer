import { describe, expect, it } from 'vitest';
import { classifyCadence, dayOfMonthMode, nextExpected, stepForward } from './cadence';
import { parseAccount } from './accounts';
import { parseTransactionDate } from '../utils/date';
import { loadRealExport } from '../test/realData';

const d = (y, m, day) => new Date(y, m - 1, day);
const iso = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

/** The 1st of twelve consecutive months, Sep 2025 – Aug 2026. */
const firsts = Array.from({ length: 12 }, (_, i) => new Date(2025, 8 + i, 1));

describe('classifyCadence', () => {
  it('monthly on the 1st, with the next expected on the following 1st', () => {
    const c = classifyCadence(firsts);
    expect(c.cadence).toBe('monthly');
    expect([30, 31]).toContain(c.medianGap);
    expect(c.perYear).toBe(12);
    expect(c.observations).toBe(12);
    expect(iso(nextExpected(firsts, c.cadence))).toBe('2026-09-01');
  });

  it('weekly survives one skipped week because the MAD stays at zero', () => {
    const mondays = Array.from({ length: 13 }, (_, i) => new Date(2026, 2, 30 + 7 * i)).filter(
      (_, i) => i !== 5,
    );
    const c = classifyCadence(mondays);
    expect(c.cadence).toBe('weekly');
    expect(c.medianGap).toBe(7);
    expect(c.gapMad).toBe(0);
    expect(c.perYear).toBe(52);
  });

  it('two dates a year apart are annual', () => {
    const c = classifyCadence([d(2025, 3, 10), d(2026, 3, 10)]);
    expect(c.cadence).toBe('annual');
    expect(c.perYear).toBe(1);
    expect(iso(nextExpected([d(2025, 3, 10), d(2026, 3, 10)], 'annual'))).toBe('2027-03-10');
  });

  it('scattered dates are irregular', () => {
    const c = classifyCadence([d(2026, 1, 1), d(2026, 1, 5), d(2026, 2, 20), d(2026, 3, 1)]);
    expect(c.cadence).toBe('irregular');
    expect(c.perYear).toBeNull();
    expect(nextExpected([d(2026, 1, 1), d(2026, 3, 1)], 'irregular')).toBeNull();
  });

  it('two dates are insufficient, but the gap is still reported', () => {
    const c = classifyCadence([d(2026, 6, 25), d(2026, 7, 25)]);
    expect(c.cadence).toBe('insufficient');
    expect(c.medianGap).toBe(30);
    expect(c.perYear).toBeNull();
    expect(classifyCadence([]).cadence).toBe('insufficient');
    expect(classifyCadence([d(2026, 1, 1)]).medianGap).toBeNull();
  });

  it('collapses same-day duplicates before measuring gaps', () => {
    const dates = [...firsts, ...firsts.map((x) => new Date(x.getFullYear(), x.getMonth(), 1, 18))];
    const c = classifyCadence(dates);
    expect(c.observations).toBe(12);
    expect(c.cadence).toBe('monthly');
  });

  it('bimonthly and quarterly', () => {
    const bi = Array.from({ length: 6 }, (_, i) => new Date(2025, 2 * i, 10));
    expect(classifyCadence(bi).cadence).toBe('bimonthly');
    const quarterly = Array.from({ length: 5 }, (_, i) => new Date(2025, 3 * i, 10));
    expect(classifyCadence(quarterly).cadence).toBe('quarterly');
  });
});

describe('dayOfMonthMode', () => {
  it('takes the mode over the last N dates, ties to the smallest', () => {
    expect(dayOfMonthMode([d(2026, 1, 1), d(2026, 2, 1), d(2026, 3, 2)])).toBe(1);
    expect(dayOfMonthMode([d(2026, 1, 3), d(2026, 2, 1), d(2026, 3, 3), d(2026, 4, 1)])).toBe(1);
    // Older dates fall outside the window.
    const dates = [d(2025, 1, 9), d(2025, 2, 9), d(2025, 3, 9), ...firsts.slice(0, 6)];
    expect(dayOfMonthMode(dates)).toBe(1);
    expect(dayOfMonthMode(dates, 20)).toBe(1);
    expect(dayOfMonthMode([])).toBeNull();
  });
});

describe('nextExpected', () => {
  it('clamps a 31st to the end of February and leaves a weekend 1st alone', () => {
    expect(iso(nextExpected([d(2026, 1, 31)], 'monthly', { dayOfMonth: 31 }))).toBe('2026-02-28');
    // 1 Aug 2026 is a Saturday; the next 1st is the engine's problem to shift, not this module's.
    expect(iso(nextExpected([d(2026, 7, 1), d(2026, 8, 1)], 'monthly'))).toBe('2026-09-01');
    expect(nextExpected([d(2026, 8, 1)], 'monthly').getDay()).toBe(2);
  });

  it('weekly and fortnightly add days', () => {
    expect(iso(nextExpected([d(2026, 8, 3), d(2026, 8, 10)], 'weekly'))).toBe('2026-08-17');
    expect(iso(nextExpected([d(2026, 8, 10)], 'fortnightly'))).toBe('2026-08-24');
  });

  it('quarterly and annual step calendar months, snapped to the day of month', () => {
    expect(iso(nextExpected([d(2026, 5, 31)], 'quarterly', { dayOfMonth: 31 }))).toBe('2026-08-31');
    expect(iso(nextExpected([d(2025, 2, 28), d(2026, 2, 28)], 'annual', { dayOfMonth: 29 }))).toBe(
      '2027-02-28',
    );
    expect(iso(stepForward(d(2026, 1, 31), 'monthly'))).toBe('2026-02-28');
    expect(nextExpected([], 'monthly')).toBeNull();
  });
});

const real = loadRealExport();

describe.skipIf(!real)('cadence on the real export', () => {
  it('reads the largest loan account as a monthly instalment', () => {
    const loans = [...new Set(real.map((t) => t.Account))].filter((a) => parseAccount(a).type === 'Loan');
    expect(loans.length).toBeGreaterThan(0);
    const credits = loans
      .map((a) => real.filter((t) => t.Account === a && t.AmountNum > 0))
      .sort((a, b) => b.length - a.length)[0];
    const c = classifyCadence(credits.map((t) => parseTransactionDate(t.Date)));
    expect(c.cadence).toBe('monthly');
    expect(c.observations).toBeGreaterThanOrEqual(12);
  });
});
