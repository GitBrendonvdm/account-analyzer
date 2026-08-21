import { describe, expect, it } from 'vitest';
import { buildCycleCalendar, cycleDay } from './cycleCurve';
import { parseTransactionDate } from '../utils/date';
import { loadRealExport } from '../test/realData';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function tx(payMonth, date, amount = -100) {
  return { 'Pay Month': payMonth, Date: date, AmountNum: amount };
}

describe('buildCycleCalendar', () => {
  it('infers a 23rd-to-22nd cycle and tiles it with no gaps', () => {
    const data = [
      tx('2026-06', '2026-05-23'), tx('2026-06', '2026-06-22'),
      tx('2026-07', '2026-06-23'), tx('2026-07', '2026-07-22'),
      tx('2026-08', '2026-07-23'), tx('2026-08', '2026-08-04'),
    ];
    const cal = buildCycleCalendar(data, ['2026-06', '2026-07', '2026-08'], new Date(2026, 7, 6));

    expect(cal.boundaryDom).toBe(23);
    expect(cal.startMonthOffset).toBe(-1);
    expect(iso(cal.starts['2026-07'])).toBe('2026-06-23');
    expect(iso(cal.ends['2026-07'])).toBe('2026-07-22');
    // The in-progress cycle's end is inferred from the boundary, not from its last transaction.
    expect(iso(cal.ends['2026-08'])).toBe('2026-08-22');
    expect(cal.isProjected['2026-08']).toBe(true);
    expect(cal.isProjected['2026-07']).toBe(false);
    // Consecutive cycles must touch exactly.
    expect(cal.ends['2026-07'].getTime() + 86400000).toBe(cal.starts['2026-08'].getTime());
  });

  it('infers a calendar-month cycle when the data uses one', () => {
    const data = [
      tx('2026-06', '2026-06-01'), tx('2026-06', '2026-06-30'),
      tx('2026-07', '2026-07-01'), tx('2026-07', '2026-07-31'),
      tx('2026-08', '2026-08-01'),
    ];
    const cal = buildCycleCalendar(data, ['2026-06', '2026-07', '2026-08'], new Date(2026, 7, 6));
    expect(cal.boundaryDom).toBe(1);
    expect(cal.startMonthOffset).toBe(0);
    expect(iso(cal.starts['2026-07'])).toBe('2026-07-01');
    expect(iso(cal.ends['2026-07'])).toBe('2026-07-31');
  });

  it('snaps a cycle whose boundary days happen to be idle', () => {
    // 2026-07 has nothing on the 23rd/24th — the cycle still starts on the 23rd.
    const data = [
      tx('2026-06', '2026-05-23'),
      tx('2026-07', '2026-06-25'), tx('2026-07', '2026-07-22'),
      tx('2026-08', '2026-07-23'),
    ];
    const cal = buildCycleCalendar(data, ['2026-06', '2026-07', '2026-08'], new Date(2026, 7, 6));
    expect(iso(cal.starts['2026-07'])).toBe('2026-06-23');
  });

  it('keeps a partial leading cycle at its observed start', () => {
    const data = [
      tx('2024-07', '2024-07-03'), tx('2024-07', '2024-07-22'),
      tx('2024-08', '2024-07-23'), tx('2024-08', '2024-08-20'),
      tx('2024-09', '2024-08-23'),
    ];
    const cal = buildCycleCalendar(data, ['2024-07', '2024-08', '2024-09'], new Date(2024, 7, 25));
    expect(iso(cal.starts['2024-07'])).toBe('2024-07-03');
    expect(cal.isPartial['2024-07']).toBe(true);
    expect(cal.isPartial['2024-08']).toBe(false);
  });

  it('clamps a boundary past the end of a short month', () => {
    // A 30th-of-the-month boundary: February can never show one, so its cycle starts on the 28th.
    const data = [
      tx('2026-01', '2025-12-30'),
      tx('2026-02', '2026-01-30'),
      tx('2026-03', '2026-02-28'),
      tx('2026-04', '2026-03-30'),
    ];
    const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
    const cal = buildCycleCalendar(data, months, new Date(2026, 3, 5));
    // The lone February outlier doesn't shift the inferred boundary.
    expect(cal.boundaryDom).toBe(30);
    // February has no 30th — clamp to the 28th rather than rolling into March.
    expect(iso(cal.starts['2026-03'])).toBe('2026-02-28');
    expect(iso(cal.starts['2026-04'])).toBe('2026-03-30');
  });

  it('returns an empty calendar for no data', () => {
    expect(buildCycleCalendar([], [], new Date()).currentMonth).toBeNull();
    expect(buildCycleCalendar(null, null, new Date()).boundaryDom).toBe(1);
  });
});

describe('cycleDay', () => {
  const start = new Date(2026, 6, 23);
  it('is 1 on the first day of the cycle', () => {
    expect(cycleDay(new Date(2026, 6, 23), start, 31)).toBe(1);
  });
  it('counts inclusive days elapsed', () => {
    expect(cycleDay(new Date(2026, 7, 6), start, 31)).toBe(15);
  });
  it('clamps past the end of the cycle', () => {
    expect(cycleDay(new Date(2026, 8, 30), start, 31)).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// Against the real export, when one is present in the gitignored test-data/.
// ---------------------------------------------------------------------------
const real = loadRealExport();

describe.skipIf(!real)('buildCycleCalendar against the real export', () => {
  const months = [...new Set(real?.map((t) => t['Pay Month']) ?? [])].sort();
  const asOf = new Date(2026, 7, 6);

  it('reads a 23rd boundary in the previous calendar month', () => {
    const cal = buildCycleCalendar(real, months, asOf);
    expect(cal.boundaryDom).toBe(23);
    expect(cal.startMonthOffset).toBe(-1);
  });

  it('puts the current cycle at 23 Jul - 22 Aug and marks it projected', () => {
    const cal = buildCycleCalendar(real, months, asOf);
    expect(iso(cal.starts['2026-08'])).toBe('2026-07-23');
    expect(iso(cal.ends['2026-08'])).toBe('2026-08-22');
    expect(cal.lengths['2026-08']).toBe(31);
    expect(cal.isProjected['2026-08']).toBe(true);
    // Derived rather than hard-coded — see processTransactionData.test.js.
    expect(iso(cal.dataThrough) <= '2026-08-06').toBe(true);
  });

  it('contains every transaction within its own pay-month cycle', () => {
    const cal = buildCycleCalendar(real, months, asOf);
    const stray = real.filter((t) => {
      const m = t['Pay Month'];
      if (cal.isPartial[m]) return false; // leading partial cycle starts mid-stream
      const d = parseTransactionDate(t.Date);
      return d < cal.starts[m] || d > cal.ends[m];
    });
    expect(stray.map((t) => `${t['Pay Month']} ${t.Date}`)).toEqual([]);
  });

  it('tiles every consecutive cycle with no gap or overlap', () => {
    const cal = buildCycleCalendar(real, months, asOf);
    months.slice(0, -1).forEach((m, i) => {
      expect(cal.ends[m].getTime() + 86400000).toBe(cal.starts[months[i + 1]].getTime());
    });
  });
});
