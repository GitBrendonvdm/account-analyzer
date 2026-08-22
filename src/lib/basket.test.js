import { describe, expect, it } from 'vitest';
import { buildBasket } from './basket';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers, completeMonths } from './flows';
import { loadRealExport } from '../test/realData';

/** The currency formatter uses non-breaking spaces; sentences are compared in plain ones. */
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

/**
 * Fixture rows follow the real export's 23rd→22nd cycle; salary anchors on every 23rd pin the
 * calendar. With anchors from Aug 2024 to Jul 2026 and data through 18 Aug 2026 the complete
 * cycles are 2024-09..2026-07 (23 of them), so the comparison windows are 2025-08..2026-01 and
 * 2026-02..2026-07. A row dated the 1st–20th of a calendar month lands in that month's cycle.
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

function anchors({ count = 24, through = '2026-08-18' } = {}) {
  const rows = [row('2024-08-05', 'Woolworths', BANK, -120)];
  for (let i = 0; i < count; i += 1) {
    const x = new Date(2024, 7 + i, 23);
    rows.push(row(iso(x), 'Salary', BANK, 50000));
  }
  rows.push(row(through, 'Checkers', BANK, -100));
  return rows;
}
const withIds = (rows) => rows.map((r, i) => ({ ...r, id: i }));
const months = (data) => [...new Set(data.map((t) => t['Pay Month']))].sort();
const ASOF = new Date(2026, 7, 22);

/** `visits` rows of `ticket` rand in each of `cycleKeys`, dated the 1st, 2nd, … of the key's month. */
function shops(cycleKeys, visits, ticket, description = 'Checkers Capegate', category = 'Groceries') {
  return cycleKeys.flatMap((key) =>
    Array.from({ length: visits }, (_, i) => row(`${key}-${String(i + 1).padStart(2, '0')}`, description, BANK, -ticket, { Category: category })),
  );
}

function build(extraRows, anchorOpts) {
  const data = withIds([...anchors(anchorOpts), ...extraRows]);
  const calendar = buildCycleCalendar(data, months(data), ASOF);
  const transfers = buildFullTransfers(data);
  return { basket: buildBasket(data, { transfers, calendar }), calendar };
}

const base = build([]);
const EARLY = base.basket.early.cycles;
const LATE = base.basket.late.cycles;

describe('buildBasket', () => {
  it('compares cycles 12–7 back with the last 6 when there are enough complete cycles', () => {
    expect(completeMonths(base.calendar)).toHaveLength(23);
    expect(EARLY).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
    expect(LATE).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
    expect(base.basket.windowNote).toBe('cycles 12–7 back against the last 6');
  });

  it('attributes a doubling of trips at the same basket entirely to frequency', () => {
    const { basket } = build([...shops(EARLY, 4, 500), ...shops(LATE, 8, 500)]);
    const g = basket.families.find((f) => f.category === 'Groceries' && f.merchantFamily == null);
    expect(g.early).toEqual(expect.objectContaining({ visitsPerCycle: 4, meanTicket: 500, medianTicket: 500, spendPerCycle: 2000 }));
    expect(g.late).toEqual(expect.objectContaining({ visitsPerCycle: 8, meanTicket: 500, spendPerCycle: 4000 }));
    expect(g.delta).toEqual({ spend: 2000, frequency: 2000, ticket: 0 });
    expect(g.driver).toBe('frequency');
    expect(g.frequencyPerCycle).toBe(2000);
    expect(plain(g.sentence)).toBe('Groceries: 4 → 8 trips a cycle, basket R 500 → R 500. More trips explain R 2 000 of the R 2 000 change (cycles 12–7 back against the last 6).');
    expect(g.seriesByCycle).toHaveLength(12);
    expect(g.seriesByCycle[0]).toEqual({ month: '2025-08', visits: 4, meanTicket: 500, spend: 2000 });
  });

  it('attributes a dearer basket at the same trips entirely to ticket', () => {
    const { basket } = build([...shops(EARLY, 4, 500), ...shops(LATE, 4, 600)]);
    const g = basket.families.find((f) => f.category === 'Groceries' && f.merchantFamily == null);
    expect(g.delta).toEqual({ spend: 400, frequency: 0, ticket: 400 });
    expect(g.driver).toBe('ticket');
    expect(g.frequencyPerCycle).toBe(0);
  });

  it('splits a change in both exactly: F + T = ΔS to the cent', () => {
    const { basket } = build([...shops(EARLY, 4, 500), ...shops(LATE, 8, 600)]);
    const g = basket.families.find((f) => f.category === 'Groceries' && f.merchantFamily == null);
    expect(g.delta.spend).toBeCloseTo(2800, 2);
    expect(g.delta.frequency).toBeCloseTo(2000, 2);
    expect(g.delta.ticket).toBeCloseTo(800, 2);
    expect(g.delta.frequency + g.delta.ticket).toBeCloseTo(g.delta.spend, 2);
    expect(g.driver).toBe('frequency');
    // The merchant family pools the grocer's branches under its first token.
    const checkers = basket.families.find((f) => f.merchantFamily === 'checkers');
    expect(checkers).toBeDefined();
    expect(checkers.label).toBe('Checkers');
    expect(checkers.delta).toEqual(g.delta);
  });

  it('counts rows under R20 in spend but not as visits', () => {
    const { basket } = build([...shops(EARLY, 4, 500), ...shops(LATE, 4, 500), ...shops(LATE, 1, 10, 'Checkers Capegate')]);
    const g = basket.families.find((f) => f.category === 'Groceries' && f.merchantFamily == null);
    expect(g.late.visitsPerCycle).toBe(4);
    expect(g.late.spendPerCycle).toBe(2010);
    expect(g.delta.frequency + g.delta.ticket).toBeCloseTo(g.delta.spend, 9);
  });

  it('falls back to halves when fewer than 12 cycles are complete', () => {
    const { basket, calendar } = build([], { count: 8, through: '2025-04-18' });
    expect(completeMonths(calendar).length).toBeLessThan(12);
    expect(basket.windowNote).toBe('first half against second half');
    expect(basket.early.cycles.length + basket.late.cycles.length).toBe(completeMonths(calendar).length);
    expect(basket.assumptions.some((a) => /split in half/.test(a))).toBe(true);
  });

  it('ignores categories outside the basket list', () => {
    const { basket } = build(shops(LATE, 4, 500, 'Builders', 'Home & Garden'));
    expect(basket.families.filter((f) => f.category === 'Home & Garden')).toHaveLength(0);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('basket on the real export', () => {
  // The body runs even when skipped; a missing export must not break collection.
  if (!real) return;
  const allMonths = months(real ?? []);
  const calendar = buildCycleCalendar(real, allMonths, ASOF);
  const transfers = buildFullTransfers(real);
  const basket = buildBasket(real, { transfers, calendar });

  it('decomposes every family exactly and lists the grocery category', () => {
    expect(basket.windowNote).toBe('cycles 12–7 back against the last 6');
    expect(basket.families.length).toBeGreaterThan(5);
    basket.families.forEach((f) => {
      expect(f.delta.frequency + f.delta.ticket).toBeCloseTo(f.delta.spend, 6);
      expect(['frequency', 'ticket', 'both']).toContain(f.driver);
      expect(f.frequencyPerCycle).toBeGreaterThanOrEqual(0);
    });
    const groceries = basket.families.find((f) => f.category === 'Groceries' && f.merchantFamily == null);
    expect(groceries).toBeDefined();
    expect(groceries.early.visitsPerCycle).toBeGreaterThan(5);
    expect(basket.families.some((f) => f.category === 'Groceries' && f.merchantFamily)).toBe(true);
  });
});
