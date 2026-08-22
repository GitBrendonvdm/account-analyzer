import { describe, expect, it } from 'vitest';
import { buildIncomeProfile } from './incomeProfile';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers } from './flows';
import { parseTransactionDate } from '../utils/date';
import { loadRealExport } from '../test/realData';

const real = loadRealExport();
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const BANK = 'FNB Bank *1111';

let nextId = 1;
function row(date, description, amount, { account = BANK, category = 'Groceries', payMonth } = {}) {
  const d = parseTransactionDate(date);
  const month = payMonth ?? (d.getDate() >= 23 ? `${d.getFullYear() + (d.getMonth() === 11 ? 1 : 0)}-${String(((d.getMonth() + 1) % 12) + 1).padStart(2, '0')}` : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  return { id: nextId++, Date: date, DateObj: d, Description: description, Account: account, Category: category, 'Pay Month': month, AmountNum: amount };
}

/**
 * Thirteen cycles on the 23rd boundary, 2025-08 … 2026-08 (the last in progress): a spend row on
 * the boundary day so the calendar sees the 23rd, one mid-cycle, and a salary on the 25th.
 */
function fixture({ salaries = [{ description: 'Acme Payroll Salary', amount: 50000 }], tweak = null } = {}) {
  const rows = [];
  for (let i = 0; i < 13; i += 1) {
    const start = new Date(2025, 6 + i, 23); // 23 Jul 2025 is the first boundary (cycle 2025-08)
    rows.push(row(iso(start), 'Checkers', -100));
    rows.push(row(iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 12)), 'Engen', -200));
    salaries.forEach((s) => {
      rows.push(row(iso(new Date(start.getFullYear(), start.getMonth(), 25)), s.description, s.amount, { category: 'Salaries & Wages', account: s.account ?? BANK }));
    });
  }
  rows.push(row('2026-08-18', 'Checkers', -50));
  const data = tweak ? tweak(rows) : rows;
  const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
  const asOf = new Date(2026, 7, 22);
  const calendar = buildCycleCalendar(data, months, asOf);
  const transfers = buildFullTransfers(data);
  return { data, calendar, transfers, asOf };
}

describe('buildIncomeProfile', () => {
  it('finds one punctual salary on the 25th, cycle day 3', () => {
    const { data, calendar, transfers, asOf } = fixture();
    const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });
    expect(p.cycles).toHaveLength(12);
    expect(p.sources).toHaveLength(1);
    const [s] = p.sources;
    expect(s.kind).toBe('salary');
    expect(s.presence).toBe(1);
    expect(s.cyclesPresent).toBe(12);
    expect(s.dom).toBe(25);
    expect(s.expectedAmount).toBe(50000);
    expect(s.timing.typicalCycleDay).toBe(3);
    expect(s.timing.lateRisk).toBe(0);
    expect(iso(s.expectedNext)).toBe('2026-08-25');
    expect(iso(s.lastReceived)).toBe('2026-07-25');
    expect(p.salary.expectedAmount).toBe(50000);
    expect(iso(p.salary.expectedNext)).toBe('2026-08-25');
    expect(p.salary.typicalCycleDay).toBe(3);
    expect(p.hhi).toBe(1);
    expect(p.stabilityScore).toBe(75);
    expect(p.tone).toBe('good');
    expect(p.sourceCount).toBe(1);
    expect(p.totalPerCycle).toBe(50000);
  });

  it('reads a late salary and one that slipped into the next pay month', () => {
    const { data, calendar, transfers, asOf } = fixture({
      tweak: (rows) =>
        rows.map((t) => {
          if (t.Category !== 'Salaries & Wages') return t;
          // 2026-04 cycle: paid on the 29th (cycle day 7) instead of the 25th.
          if (t.Date === '2026-03-25') return { ...t, Date: '2026-03-29', DateObj: parseTransactionDate('2026-03-29') };
          // 2025-11 cycle: paid on 23 Nov — the export files that in 2025-12, which doubles.
          if (t.Date === '2025-10-25') return { ...t, Date: '2025-11-23', DateObj: parseTransactionDate('2025-11-23'), 'Pay Month': '2025-12' };
          return t;
        }),
    });
    const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });
    expect(p.sources).toHaveLength(1);
    const { timing } = p.sources[0];
    expect(timing.lateRisk).toBeCloseTo(2 / 12, 6);
    expect(timing.missingCycles).toEqual(['2025-11']);
    expect(timing.doubleCycles).toEqual(['2025-12']);
    expect(timing.lateCycles).toEqual(['2026-04']);
    expect(timing.lateDelayP90).toBeGreaterThan(4);
    expect(p.salary.lateRisk).toBeCloseTo(2 / 12, 6);
    expect(p.salary.missingCycles).toEqual(['2025-11']);
  });

  it('keeps two earners apart and adds them up', () => {
    const { data, calendar, transfers, asOf } = fixture({
      salaries: [
        { description: 'Acme Payroll Salary', amount: 40000 },
        { description: 'Beta Corp Salary', amount: 25000 },
      ],
    });
    const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });
    expect(p.sources).toHaveLength(2);
    expect(p.sources.every((s) => s.kind === 'salary')).toBe(true);
    expect(p.salary.sourceIds).toHaveLength(2);
    expect(p.salary.expectedAmount).toBe(65000);
    expect(p.hhi).toBeCloseTo(0.53, 2);
    expect(p.sourceCount).toBe(2);
  });

  it('splits one payer into two sources by amount band', () => {
    const { data, calendar, transfers, asOf } = fixture({
      salaries: [
        { description: 'Acme Payroll Salary', amount: 40000 },
        { description: 'Acme Payroll Salary', amount: 25000 },
      ],
    });
    const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });
    expect(p.sources).toHaveLength(2);
    expect(p.sources.map((s) => s.id).sort()).toEqual(['acme payroll|fnb|1111|0', 'acme payroll|fnb|1111|1']);
  });

  it('removes a refund that mirrors a recent debit at the same merchant', () => {
    // A partial refund: the exact ±1 036 mirror is already paired as a reversal by the transfer
    // rules and never reaches the income rows, so the refund test is what catches the rest.
    const { data, calendar, transfers, asOf } = fixture({
      tweak: (rows) => [
        ...rows,
        row('2026-06-01', 'Takealot Online', -1036, { category: 'General Purchases' }),
        row('2026-06-15', 'Takealot Online', 1000, { category: 'General Purchases' }),
        row('2026-05-01', 'Builders Warehouse', -2000, { category: 'Home & Garden' }),
        row('2026-05-10', 'Builders Warehouse', 2000, { category: 'Home & Garden' }),
      ],
    });
    const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });
    expect(transfers.reversalIds.size).toBe(2);
    expect(p.refundsRemoved).toBe(1);
    expect(p.sources).toHaveLength(1);
    expect(p.assumptions.some((a) => /refund/.test(a))).toBe(true);
  });

  it('keeps a credit that is larger than the debit it resembles', () => {
    const { data, calendar, transfers, asOf } = fixture({
      tweak: (rows) => [
        ...rows,
        row('2026-06-01', 'Takealot Online', -500, { category: 'General Purchases' }),
        row('2026-06-15', 'Takealot Online', 3000, { category: 'General Purchases' }),
      ],
    });
    const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });
    expect(p.refundsRemoved).toBe(0);
    expect(p.sources).toHaveLength(2);
  });

  it('leaves small interest credits out, and files larger ones as interest', () => {
    const { data, calendar, transfers, asOf } = fixture({
      tweak: (rows) => [
        ...rows,
        ...Array.from({ length: 12 }, (_, i) => row(iso(new Date(2025, 7 + i, 1)), 'Interest Received', 12.5, { category: 'Interest' })),
        ...Array.from({ length: 12 }, (_, i) => row(iso(new Date(2025, 7 + i, 2)), 'Notice Deposit Interest', 800, { category: 'Interest', account: 'FNB Savings *2222' })),
      ],
    });
    const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });
    expect(p.interestIncome).toBeCloseTo(12 * 12.5, 6);
    expect(p.sources.map((s) => s.kind).sort()).toEqual(['interest', 'salary']);
    expect(p.hhi).toBeLessThan(1);
  });

  it('returns null without a complete cycle', () => {
    const rows = [row('2026-08-01', 'Acme Payroll Salary', 50000, { category: 'Salaries & Wages' })];
    const calendar = buildCycleCalendar(rows, ['2026-08'], new Date(2026, 7, 22));
    expect(buildIncomeProfile(rows, { calendar, transfers: buildFullTransfers(rows) })).toBeNull();
  });
});

describe.skipIf(!real)('buildIncomeProfile against the real export', () => {
  const data = real ?? [];
  data.forEach((t) => {
    t.DateObj = parseTransactionDate(t.Date);
  });
  const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
  const asOf = new Date(2026, 7, 22);
  const calendar = buildCycleCalendar(data, months, asOf);
  const transfers = buildFullTransfers(data);
  const p = buildIncomeProfile(data, { calendar, transfers, asOf, dataThrough: calendar.dataThrough });

  it('finds a salary that lands on the 23rd–25th and is late or missing in a few cycles a year', () => {
    expect(p.salary).not.toBeNull();
    expect(p.salary.typicalCycleDay).toBeGreaterThanOrEqual(1);
    expect(p.salary.typicalCycleDay).toBeLessThanOrEqual(3);
    const salarySources = p.sources.filter((s) => p.salary.sourceIds.includes(s.id));
    salarySources.forEach((s) => {
      expect(s.dom).toBeGreaterThanOrEqual(23);
      expect(s.dom).toBeLessThanOrEqual(25);
    });
    expect(p.salary.lateRisk).toBeGreaterThanOrEqual(0.08);
    expect(p.salary.lateRisk).toBeLessThanOrEqual(0.3);
    expect(p.salary.missingCycles.length).toBeGreaterThanOrEqual(1);
    expect(p.sources.every((s) => s.presence >= 0 && s.presence <= 1)).toBe(true);
    expect(p.assumptions.length).toBeGreaterThan(1);
  });
});
