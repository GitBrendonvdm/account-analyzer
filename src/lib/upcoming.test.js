import { describe, expect, it } from 'vitest';
import { buildUpcoming } from './upcoming';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers } from './flows';
import { buildRecurringLines } from './recurring';
import { buildAccountRecord } from '../db/accountIdentity';
import { parseTransactionDate } from '../utils/date';
import { loadRealExport } from '../test/realData';

const real = loadRealExport();
const d = (y, m, day) => new Date(y, m - 1, day);
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

/** Two cycles on the 23rd boundary; the data ends Tue 18 Aug 2026, today is Sat 22 Aug. */
const CAL = {
  starts: { '2026-07': d(2026, 6, 23), '2026-08': d(2026, 7, 23) },
  ends: { '2026-07': d(2026, 7, 22), '2026-08': d(2026, 8, 22) },
  lengths: { '2026-07': 30, '2026-08': 31 },
  isPartial: { '2026-07': false, '2026-08': false },
  isProjected: { '2026-07': false, '2026-08': true },
  dataThrough: d(2026, 8, 18),
  currentMonth: '2026-08',
  boundaryDom: 23,
  startMonthOffset: -1,
};
const OPTS = { calendar: CAL, asOf: d(2026, 8, 22), dataThrough: d(2026, 8, 18) };

function line(over = {}) {
  return {
    id: 'x|fnb|1111|0',
    label: 'X',
    kind: 'optional',
    amount: 499,
    level: 'high',
    payingAccountId: 'fnb|1111',
    accountId: 'fnb|1111',
    source: 'charge',
    cadence: 'monthly',
    perYear: 12,
    dom: 1,
    lastSeen: d(2026, 8, 1),
    weekendShift: null,
    status: 'active',
    tentative: false,
    cycleStatus: 'landed',
    items: [],
    ...over,
  };
}

describe('buildUpcoming', () => {
  it('steps a monthly line into the next cycle, on the right cycle day', () => {
    const u = buildUpcoming([line()], OPTS);
    expect(u.entries).toHaveLength(1);
    expect(iso(u.entries[0].date)).toBe('2026-09-01');
    expect(u.entries[0].cycle).toBe('next');
    expect(u.entries[0].cycleDay).toBe(10);
    expect(u.entries[0].items[0].status).toBe('next');
    expect(u.dueAfterPayday).toBe(499);
    expect(u.dueBeforePayday).toBe(0);
    expect(iso(u.horizon.from)).toBe('2026-08-19');
    expect(iso(u.horizon.to)).toBe('2026-09-21');
    expect(iso(u.horizon.nextPayDate)).toBe('2026-08-23');
  });

  it('emits every weekly occurrence inside the window', () => {
    const weekly = line({ id: 'w', cadence: 'weekly', perYear: 52, amount: 200, dom: null, lastSeen: d(2026, 8, 17), cycleStatus: null });
    const u = buildUpcoming([weekly], OPTS);
    expect(u.entries.map((e) => iso(e.date))).toEqual(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
    expect(u.entries[0].cycle).toBe('next');
    expect(u.entries[0].cycleDay).toBe(2);
  });

  it('lists a low-confidence line without counting it', () => {
    const u = buildUpcoming([line(), line({ id: 'low', level: 'low', amount: 1000, dom: 5, lastSeen: d(2026, 8, 5) })], OPTS);
    expect(u.lowConfidenceExtra).toBe(1000);
    expect(u.dueAfterPayday).toBe(499);
    const low = u.entries.find((e) => iso(e.date) === '2026-09-05');
    expect(low.lowTotal).toBe(1000);
    expect(low.total).toBe(0);
  });

  it('puts the expected salary on the payday row', () => {
    const incomeProfile = {
      sources: [{ id: 's', kind: 'salary', presence: 1, expectedAmount: 75000, expectedNext: d(2026, 8, 23), accountId: 'fnb|1111', timing: { typicalCycleDay: 1 } }],
      salary: { expectedAmount: 75000 },
    };
    const u = buildUpcoming([line()], { ...OPTS, incomeProfile });
    const payday = u.entries.find((e) => e.payday);
    expect(iso(payday.date)).toBe('2026-08-23');
    expect(payday.income).toBe(75000);
    expect(payday.cycle).toBe('next');
    expect(payday.cycleDay).toBe(1);

    // A salary that usually lands on the 25th still belongs to the payday row; other income
    // with a known date gets its own row.
    const later = buildUpcoming([], {
      ...OPTS,
      incomeProfile: {
        sources: [
          { id: 's', kind: 'salary', presence: 1, expectedAmount: 75000, expectedNext: d(2026, 8, 25), accountId: 'fnb|1111' },
          { id: 'r', kind: 'rent', presence: 1, expectedAmount: 9000, expectedNext: d(2026, 9, 1), accountId: 'fnb|1111' },
        ],
      },
    });
    expect(later.entries.find((e) => e.payday).income).toBe(75000);
    expect(later.entries.find((e) => iso(e.date) === '2026-09-01').income).toBe(9000);
  });

  it('reports an overdue line and still gives it no entry before its next expected date', () => {
    const overdue = line({ id: 'o', dom: 10, lastSeen: d(2026, 7, 10), cycleStatus: 'overdue' });
    const u = buildUpcoming([overdue], OPTS);
    expect(u.overdue.map((l) => l.id)).toEqual(['o']);
    expect(u.entries.map((e) => iso(e.date))).toEqual(['2026-09-10']);
  });

  it('sorts status buckets and ignores tentative and lapsed lines', () => {
    const u = buildUpcoming(
      [
        line({ id: 'u', cycleStatus: 'unobservable', dom: 20, lastSeen: d(2026, 7, 20) }),
        line({ id: 't', tentative: true }),
        line({ id: 'l', status: 'lapsed' }),
      ],
      OPTS,
    );
    expect(u.unobservable.map((l) => l.id)).toEqual(['u']);
    expect(u.landed).toEqual([]);
    // The unobservable line's 20 Aug charge falls in the unseen gap and is listed as such.
    expect(u.entries.map((e) => iso(e.date))).toEqual(['2026-08-20', '2026-09-20']);
    expect(u.entries[0].items[0].status).toBe('unobservable');
    expect(u.entries[0].cycle).toBe('current');
  });

  it('shifts a weekend-moving line the way it has moved before', () => {
    // 1 Nov 2026 is a Sunday: a 'later' line lands on Monday 2 Nov.
    const u = buildUpcoming([line({ id: 'wk', weekendShift: 'later', lastSeen: d(2026, 10, 1) })], {
      ...OPTS,
      asOf: d(2026, 10, 22),
      dataThrough: d(2026, 10, 18),
    });
    expect(u.entries.map((e) => iso(e.date))).toEqual(['2026-11-02']);
  });

  it('measures coverage over the last complete cycle', () => {
    const rows = ['2026-07-01', '2026-07-05', '2026-07-10', '2026-07-15'].map((date, i) => ({
      id: i,
      Date: date,
      DateObj: parseTransactionDate(date),
      Description: `Shop ${i}`,
      Account: 'FNB Bank *1111',
      Category: 'Groceries',
      'Pay Month': '2026-07',
      AmountNum: -100,
    }));
    const transfers = buildFullTransfers(rows);
    const explained = new Set(rows.slice(0, 3));
    const u = buildUpcoming([], { ...OPTS, explained, data: rows, transfers });
    expect(u.coverage.share).toBeCloseTo(0.75, 6);
    expect(u.coverage.cycle).toBe('2026-07');
  });
});

describe.skipIf(!real)('buildUpcoming against the real export', () => {
  const data = real ?? [];
  data.forEach((t) => {
    t.DateObj = parseTransactionDate(t.Date);
  });
  const names = [...new Set(data.map((t) => t.Account))];
  const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
  const asOf = new Date(2026, 7, 22);
  const calendar = buildCycleCalendar(data, months, asOf);
  const byId = new Map();
  names.forEach((n) => {
    const rec = buildAccountRecord([n], null, null);
    if (!byId.has(rec.id)) byId.set(rec.id, rec);
  });
  const accounts = [...byId.values()];
  const transfers = buildFullTransfers(data, { accounts });
  const { lines, explained } = buildRecurringLines(data, { accounts, calendar, transfers, asOf, dataThrough: calendar.dataThrough });
  const upcoming = buildUpcoming(lines, { calendar, asOf, dataThrough: calendar.dataThrough, explained, data, transfers });

  it('does not carry the three false flags the category rule produced', () => {
    const flagged = ['Vehicle Loan / Car Loan', 'Other Phone & Internet', 'Bank Charges'];
    const overdueCategories = upcoming.overdue.map((l) => l.category);
    flagged.forEach((category) => expect(overdueCategories).not.toContain(category));
  });

  it('lists the instalments in the first week after payday and explains most of last cycle', () => {
    const afterPayday = upcoming.entries.filter((e) => e.cycle === 'next' && e.cycleDay <= 7);
    const instalments = afterPayday.flatMap((e) => e.items).filter((it) => it.kind === 'instalment');
    expect(instalments.length).toBeGreaterThanOrEqual(3);
    expect(upcoming.dueAfterPayday).toBeGreaterThan(upcoming.dueBeforePayday);
    expect(upcoming.coverage.share).toBeGreaterThan(0.4);
    expect(upcoming.entries.every((e) => e.items.every((it) => ['landed', 'due', 'overdue', 'unobservable', 'next'].includes(it.status)))).toBe(true);
  });
});
