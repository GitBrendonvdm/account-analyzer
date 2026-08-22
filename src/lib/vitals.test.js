import { describe, expect, it } from 'vitest';
import { buildDirection, buildVitals } from './vitals';
import { buildCostOfDebt } from './costOfDebt';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers } from './flows';
import { processTransactionData } from './processTransactionData';
import { parseTransactionDate } from '../utils/date';
import { loadRealExport } from '../test/realData';

const real = loadRealExport();
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const BANK = 'FNB Bank *1111';

let nextId = 1;
function row(date, description, amount, { account = BANK, category = 'Groceries', payMonth, group = 'Day-to-day' } = {}) {
  const d = parseTransactionDate(date);
  return {
    id: nextId++,
    Date: date,
    DateObj: d,
    Description: description,
    Account: account,
    Category: category,
    'Spending Group': group,
    'Pay Month': payMonth,
    AmountNum: amount,
  };
}

/** Cycle `i` (0-based from 2025-08) on the 23rd boundary: its key and start date. */
function cycle(i) {
  const start = new Date(2025, 6 + i, 23);
  const keyDate = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { start, key: `${keyDate.getFullYear()}-${String(keyDate.getMonth() + 1).padStart(2, '0')}` };
}

/**
 * `cycles` complete cycles plus the current one, each with a boundary row, one salary and one
 * spend row; `shape(i)` can override income / spend / instalment / extras per cycle.
 */
function fixture(cycles, shape = () => ({})) {
  const rows = [];
  for (let i = 0; i <= cycles; i += 1) {
    const { start, key } = cycle(i);
    const { income = 100000, spend = 80000, instalment = 0, extra = [] } = shape(i, key);
    const at = (day) => iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + day));
    rows.push(row(at(0), 'Checkers', -100, { payMonth: key }));
    if (income > 0) rows.push(row(at(2), 'Acme Payroll Salary', income, { category: 'Salaries & Wages', payMonth: key, group: 'Income' }));
    rows.push(row(at(10), 'Checkers', -(spend - 100), { payMonth: key }));
    if (instalment > 0) rows.push(row(at(3), 'Wesbank Instalment', -instalment, { category: 'Vehicle Loan / Car Loan', payMonth: key, group: 'Debt' }));
    extra.forEach((e) => rows.push(row(at(e.day ?? 5), e.description, e.amount, { ...e, payMonth: key })));
  }
  const last = cycle(cycles);
  const asOf = new Date(last.start.getFullYear(), last.start.getMonth(), last.start.getDate() + 15);
  const months = [...new Set(rows.map((t) => t['Pay Month']))].sort();
  const calendar = buildCycleCalendar(rows, months, asOf);
  const names = [...new Set(rows.map((t) => t.Account))];
  const transfers = buildFullTransfers(rows);
  const processedLong = processTransactionData(rows, names, Math.min(13, months.length), asOf);
  const costOfDebtLong = buildCostOfDebt(rows, names, processedLong.months);
  return { data: rows, calendar, transfers, processedLong, costOfDebtLong, asOf };
}

const vitalsOf = (f, extra = {}) => buildVitals({ ...f, accounts: [], balanced: [], ...extra });

describe('buildVitals', () => {
  it('pools four cycles at 100k income / 80k spend into a savings rate of 0.20', () => {
    const v = vitalsOf(fixture(4));
    expect(v.window.complete).toBe(4);
    expect(v.window.short).toHaveLength(3);
    expect(v.vitals.savingsRate.value).toBeCloseTo(0.2, 6);
    expect(v.vitals.savingsRate.long).toBeCloseTo(0.2, 6);
    expect(v.vitals.savingsRate.tone).toBe('good');
    expect(v.vitals.savingsRate.direction).toBe('flat');
    expect(v.vitals.deficitPerCycle.value).toBe(0);
    expect(v.vitals.deficitPerCycle.tone).toBe('good');
    expect(v.exceptionIncome).toBe(0);
    expect(v.vitals.savingsRate.series).toHaveLength(4);
  });

  it('keeps a shifted salary out of the pooled ratio and flags its cycle', () => {
    const v = vitalsOf(fixture(4, (i) => (i === 1 ? { income: 0 } : i === 2 ? { income: 200000 } : {})));
    expect(v.vitals.savingsRate.long).toBeCloseTo(0.2, 6);
    expect(v.vitals.savingsRate.short).toBeCloseTo(0.2, 6);
    const flagged = v.vitals.savingsRate.series.filter((s) => s.incomeShifted);
    expect(flagged.map((s) => s.month)).toEqual([cycle(1).key]);
  });

  it('reads loan instalments of 40k on 100k income as a debt-service ratio of exactly 0.40 — amber', () => {
    const v = vitalsOf(fixture(4, () => ({ instalment: 40000 })));
    expect(v.vitals.debtServiceRatio.value).toBeCloseTo(0.4, 6);
    expect(v.vitals.debtServiceRatio.tone).toBe('warn');
    expect(v.vitals.debtServiceRatio.components.instalments).toBeCloseTo(120000, 6);
    expect(v.vitals.debtServiceRatio.partial).toBe(false);
    const over = vitalsOf(fixture(4, () => ({ instalment: 40001 })));
    expect(over.vitals.debtServiceRatio.tone).toBe('bad');
    expect(over.worst).toContain('debtServiceRatio');
  });

  it('reports a one-off inflow beside the vitals and changes none of them', () => {
    const plain = vitalsOf(fixture(4));
    const windfall = vitalsOf(
      fixture(4, (i) => (i === 1 ? { extra: [{ description: 'Estate Payout', amount: 500000, category: 'Uncategorised', group: 'Income' }] } : {})),
    );
    expect(windfall.exceptionIncome).toBe(500000);
    expect(windfall.vitals.savingsRate.value).toBeCloseTo(plain.vitals.savingsRate.value, 6);
    expect(windfall.vitals.savingsRate.long).toBeCloseTo(plain.vitals.savingsRate.long, 6);
    expect(windfall.assumptions[0]).toMatch(/one-off inflows/);
  });

  it('needs balances for the runway and utilisation vitals', () => {
    const none = vitalsOf(fixture(4));
    expect(none.vitals.liquidityRunway.value).toBeNull();
    expect(none.vitals.liquidityRunway.tone).toBe('neutral');
    expect(none.vitals.cardUtilisation.value).toBeNull();

    const balanced = [
      { type: 'Bank', known: true, balance: 200000, label: 'Cheque', account: BANK, isLiability: false, windowChange: 0 },
      { type: 'Credit Card', known: true, balance: -30000, creditLimit: 50000, label: 'Card A', isLiability: true, windowChange: -2000 },
      { type: 'Credit Card', known: true, balance: -30000, creditLimit: 50000, label: 'Card B', isLiability: true, windowChange: -1000 },
    ];
    const some = vitalsOf(fixture(4), { balanced });
    expect(some.vitals.liquidityRunway.value).toBeCloseTo(2.5, 6);
    expect(some.vitals.liquidityRunway.tone).toBe('warn');
    expect(some.vitals.liquidityRunway.knownCount).toBe(1);
    expect(some.vitals.cardUtilisation.value).toBeCloseTo(0.6, 6);
    expect(some.vitals.cardUtilisation.tone).toBe('warn');
    expect(some.vitals.cardUtilisation.perCard).toHaveLength(2);
    expect(some.vitals.creditRunway.value).toBeCloseTo((200000 + 40000) / 80000, 6);
    expect(some.vitals.deficitPerCycle.fundedBy.map((f) => f.account)).toEqual(['Card A', 'Card B']);
  });

  it('calls a +0.03 move in the debt-service ratio worsening and +0.01 flat', () => {
    const worse = vitalsOf(fixture(4, (i) => ({ instalment: i === 0 ? 31000 : 43000 })));
    expect(worse.vitals.debtServiceRatio.delta).toBeCloseTo(0.03, 6);
    expect(worse.vitals.debtServiceRatio.direction).toBe('worsening');
    const flat = vitalsOf(fixture(4, (i) => ({ instalment: i === 0 ? 39000 : 43000 })));
    expect(flat.vitals.debtServiceRatio.delta).toBeCloseTo(0.01, 6);
    expect(flat.vitals.debtServiceRatio.direction).toBe('flat');
    // Improving always means toward green: a falling ratio improves, a rising savings rate improves.
    const better = vitalsOf(fixture(4, (i) => ({ instalment: i === 0 ? 55000 : 43000 })));
    expect(better.vitals.debtServiceRatio.direction).toBe('improving');
  });
});

describe('buildDirection', () => {
  it('sees the gap widen after a step in spend at cycle 20 of 24', () => {
    const f = fixture(24, (i) => ({ spend: i >= 19 ? 110000 : 80000 }));
    const d = buildDirection({ data: f.data, transfers: f.transfers, calendar: f.calendar });
    expect(d.cycles).toHaveLength(24);
    const net = d.metrics.find((m) => m.id === 'net');
    expect(net.short).toBeCloseTo(-10000, 6);
    expect(net.long).toBeCloseTo((7 * 20000 - 5 * 10000) / 12, 6);
    expect(net.prior).toBeCloseTo(20000, 6);
    expect(net.tone).toBe('bad');
    expect(d.summary.widening).toBe(true);
    expect(d.summary.netPrior).toBeCloseTo(20000, 6);
    const income = d.metrics.find((m) => m.id === 'income');
    expect(income.short).toBe(100000);
    expect(income.tone).toBe('neutral');
    expect(d.metrics.map((m) => m.id)).not.toContain('standingCharges');
  });

  it('marks income and net shifted when a salary missed a cycle in the short window', () => {
    const f = fixture(12);
    const last = f.calendar.currentMonth;
    const d = buildDirection({
      data: f.data,
      transfers: f.transfers,
      calendar: f.calendar,
      incomeProfile: { salary: { missingCycles: [cycle(11).key] } },
      lines: [],
    });
    expect(last).toBe(cycle(12).key);
    expect(d.metrics.find((m) => m.id === 'net').tone).toBe('neutral');
    expect(d.metrics.find((m) => m.id === 'net').note).toMatch(/salary/);
    expect(d.metrics.map((m) => m.id)).toContain('standingCharges');
  });
});

describe.skipIf(!real)('vitals against the real export', () => {
  // The body runs even when skipped; a missing export must not break collection.
  if (!real) return;
  const data = real ?? [];
  data.forEach((t) => {
    t.DateObj = parseTransactionDate(t.Date);
  });
  const names = [...new Set(data.map((t) => t.Account))];
  const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
  const asOf = new Date(2026, 7, 22);
  const calendar = buildCycleCalendar(data, months, asOf);
  const transfers = buildFullTransfers(data);
  const processedLong = processTransactionData(data, names, Math.min(13, months.length), asOf);
  const costOfDebtLong = buildCostOfDebt(data, names, processedLong.months);
  const v = buildVitals({ processedLong, data, accounts: [], balanced: [], costOfDebtLong, transfers, calendar, asOf });
  const d = buildDirection({ data, transfers, calendar });

  it('lands in the expected bands over the last three complete cycles', () => {
    expect(v.window.long).toHaveLength(12);
    expect(v.window.short).toHaveLength(3);
    const dsr = v.vitals.debtServiceRatio.value;
    expect(dsr).toBeGreaterThanOrEqual(0.4);
    expect(dsr).toBeLessThanOrEqual(0.52);
    expect(v.vitals.debtServiceRatio.tone).toBe('bad');
    expect(v.vitals.interestBurden.value).toBeGreaterThanOrEqual(0.3);
    expect(v.vitals.interestBurden.value).toBeLessThanOrEqual(0.42);
    expect(v.vitals.savingsRate.value).toBeGreaterThanOrEqual(-0.35);
    expect(v.vitals.savingsRate.value).toBeLessThanOrEqual(-0.1);
    // One-off inflows are reported beside the vitals, never counted. (The large 2026-01 credits
    // are card repayments and a transfer under full-file classification, so the Income
    // Exceptions group holds the smaller one-offs — still a six-figure sum over twelve cycles.)
    expect(v.exceptionIncome).toBeGreaterThan(100000);
    const shortIncome = v.window.short.map((m) => v.vitals.savingsRate.series.find((s) => s.month === m));
    expect(shortIncome.every((s) => s && !s.incomeShifted)).toBe(true);
    expect(v.vitals.liquidityRunway.value).toBeNull();
    expect(v.worst).toContain('debtServiceRatio');
  });

  it('sees the gap widening: the last three cycles net more negative than the last twelve', () => {
    expect(d.summary.widening).toBe(true);
    expect(d.summary.netShort).toBeLessThan(d.summary.netLong);
    expect(d.summary.netPrior).not.toBeNull();
    expect(d.cycles.length).toBeGreaterThanOrEqual(20);
  });
});
