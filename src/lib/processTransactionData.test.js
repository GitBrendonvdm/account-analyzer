import { describe, expect, it } from 'vitest';
import { processTransactionData } from './processTransactionData';
import { loadRealExport } from '../test/realData';

const real = loadRealExport();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe.skipIf(!real)('processTransactionData against the real export', () => {
  const accounts = [...new Set(real?.map((t) => t.Account) ?? [])];
  const asOf = new Date(2026, 7, 6); // Thu 6 Aug 2026
  const processed = processTransactionData(real, accounts, 6, asOf);

  it('anchors the current cycle on the pay-month boundary', () => {
    expect(processed.currentMonth).toBe('2026-08');
    expect(iso(processed.currentCycleStart)).toBe('2026-07-23');
    expect(iso(processed.currentCycleEnd)).toBe('2026-08-22');
    expect(iso(processed.nextPayDate)).toBe('2026-08-23');
    expect(processed.cycleLength).toBe(31);
    expect(processed.cycleDay).toBe(15);
    expect(processed.daysToPayday).toBe(16);
    expect(processed.isProjectedCycleEnd).toBe(true);
    expect(iso(processed.dataThrough)).toBe('2026-08-04');
  });

  it('surfaces only weeks that fall inside the pay cycle', () => {
    const labels = processed.cycleWeeks.map((w) => w.label);
    // The old payday rule (25th rolled forward to Monday) produced a trailing "24 Aug" column
    // covering 24-30 Aug — entirely outside the 23 Jul - 22 Aug pay month.
    expect(labels).toEqual(['03 Aug', '10 Aug', '17 Aug']);
    expect(labels).not.toContain('24 Aug');
  });

  it('marks the week containing today as current', () => {
    const current = processed.cycleWeeks.filter((w) => w.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].label).toBe('03 Aug');
  });

  it('keeps each row\'s Remaining equal to the sum of its weekly split', () => {
    processed.rows.forEach((row) => {
      const summed = (row.weeklyRemaining ?? []).reduce((s, x) => s + x, 0);
      expect(summed).toBeCloseTo(row.expected ?? 0, 6);
      (row.sub ?? []).forEach((sub) => {
        const subSummed = (sub.weeklyRemaining ?? []).reduce((s, x) => s + x, 0);
        expect(subSummed).toBeCloseTo(sub.expected ?? 0, 6);
      });
    });
  });

  it('keeps every group Remaining equal to the sum of its subcategories', () => {
    processed.rows
      .filter((r) => !r.isException && !r.isTransfer)
      .forEach((row) => {
        const childSum = (row.sub ?? []).reduce((s, x) => s + (x.expected ?? 0), 0);
        expect(childSum).toBeCloseTo(row.expected ?? 0, 6);
      });
  });
});
