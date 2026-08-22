import { describe, expect, it } from 'vitest';
import { buildSubscriptions } from './subscriptions';
import { buildCycleCalendar } from './cycleCurve';
import { buildFullTransfers } from './flows';
import { buildRecurringLines } from './recurring';
import { loadRealExport } from '../test/realData';

/** The currency formatter uses non-breaking spaces; sentences are compared in plain ones. */
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

/**
 * Lines are hand-built RecurringLine objects: the audit reads lines, never rows, so the fixtures
 * say exactly what the engine would have said. The calendar comes from anchor rows on the real
 * export's 23rd→22nd cycle (salary on every 23rd, Aug 2024 – Jul 2026, data through 18 Aug 2026),
 * which makes 2024-09..2026-07 the complete cycles and 2026-05..07 the "new since" window.
 */
const BANK = 'FNB Bank *2000';

function payMonthOf(date) {
  const [y, m, day] = date.split('-').map(Number);
  const key = day >= 23 ? new Date(y, m, 1) : new Date(y, m - 1, 1);
  return `${key.getFullYear()}-${String(key.getMonth() + 1).padStart(2, '0')}`;
}
const iso = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const d = (y, m, day) => new Date(y, m - 1, day);

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

function anchors({ through = '2026-08-18' } = {}) {
  const rows = [row('2024-08-05', 'Woolworths', BANK, -120)];
  for (let i = 0; i < 24; i += 1) {
    const x = new Date(2024, 7 + i, 23);
    rows.push(row(iso(x), 'Salary', BANK, 50000));
  }
  rows.push(row(through, 'Checkers', BANK, -100));
  return rows;
}
const withIds = (rows) => rows.map((r, i) => ({ ...r, id: i }));
const months = (data) => [...new Set(data.map((t) => t['Pay Month']))].sort();

const ASOF = d(2026, 8, 22);
const THROUGH = d(2026, 8, 18);
const data = withIds(anchors());
const calendar = buildCycleCalendar(data, months(data), ASOF);
const opts = { calendar, dataThrough: THROUGH, asOf: ASOF };

/** A RecurringLine with every field the audit reads; `dates`/`amounts` build the items. */
function line(over = {}) {
  const amount = over.amount ?? 199;
  const dates = over.dates ?? [d(2025, 9, 1), d(2025, 10, 1), d(2025, 11, 1), d(2025, 12, 1), d(2026, 1, 1), d(2026, 2, 1), d(2026, 3, 1), d(2026, 4, 1), d(2026, 5, 1), d(2026, 6, 1), d(2026, 7, 1), d(2026, 8, 1)];
  const amounts = over.amounts ?? dates.map(() => amount);
  const items = dates.map((x, i) => ({
    Date: iso(x),
    'Pay Month': payMonthOf(iso(x)),
    AmountNum: -amounts[i],
    Description: over.label ?? 'Netflix',
    Category: over.category ?? 'Entertainment',
    Account: BANK,
  }));
  return {
    id: 'netflix|fnb|2000|0',
    key: 'netflix',
    label: 'Netflix',
    source: 'charge',
    kind: 'optional',
    category: 'Entertainment',
    spendingGroup: 'Recurring',
    accountId: 'fnb|2000',
    payingAccountId: 'fnb|2000',
    loanAccountId: null,
    cardAccountId: null,
    cadence: 'monthly',
    medianGap: 31,
    gapMad: 0,
    perYear: 12,
    observations: items.length,
    tentative: false,
    amount,
    amountStable: true,
    regular: true,
    range: [amount, amount],
    regimes: [{ from: items[0]?.['Pay Month'] ?? '2025-09', to: items.at(-1)?.['Pay Month'] ?? '2026-08', amount, count: items.length }],
    outliers: 0,
    priceChange: null,
    perCycle: amount,
    perYearAmount: amount * 12,
    perCycleAmounts: amounts,
    firstSeen: dates[0],
    lastSeen: dates[dates.length - 1],
    cyclesPresent: items.length,
    cyclesSinceFirst: items.length,
    presence: 1,
    dom: 1,
    domIqr: 0,
    gapIqr: null,
    weekendShift: null,
    nextDate: d(2026, 9, 1),
    dueCycle: '2026-09',
    dueThisCycle: false,
    status: 'active',
    cycleStatus: 'landed',
    landedKey: null,
    confidence: 0.9,
    level: 'high',
    items,
    ...over,
  };
}

describe('buildSubscriptions', () => {
  it('totals by kind and never lets an instalment into the optional figure', () => {
    const out = buildSubscriptions(
      [
        line(),
        line({ id: 'loan|fnb|4081|fnb|2000|0', label: 'Bond', source: 'instalment', kind: 'instalment', amount: 22855, perCycle: 22855 }),
      ],
      opts,
    );
    expect(out.optionalPerCycle).toBe(199);
    expect(out.optionalPerYear).toBe(199 * 12);
    expect(out.byKind.instalment.perCycle).toBe(22855);
    expect(out.byKind.instalment.count).toBe(1);
    expect(out.byKind.optional.count).toBe(1);
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].kind).toBe('instalment');
    expect(out.byCadence.monthly).toBe(2);
    expect(out.cycles[0]).toBe('2024-09');
    expect(out.cycles.at(-1)).toBe('2026-07');
    expect(plain(out.sentence)).toContain('1 optional service cost');
  });

  it('counts a lapsed monthly line as a win, one complete cycle saved since its next charge was due', () => {
    // Last seen 60 days before dataThrough (19 Jun); next charge was due 20 Jul; cycle 2026-07
    // (23 Jun – 22 Jul) is complete and would have carried it: one cycle saved.
    const lastSeen = d(2026, 6, 19);
    const lapsed = line({
      id: 'gym|fnb|2000|0',
      label: 'Gym',
      amount: 450,
      perCycle: 450,
      status: 'lapsed',
      level: 'low',
      dates: [d(2026, 3, 19), d(2026, 4, 19), d(2026, 5, 19), lastSeen],
      lastSeen,
    });
    const out = buildSubscriptions([lapsed, line()], opts);
    expect(out.lapsedLines).toHaveLength(1);
    expect(out.lapsedLines[0].savedPerCycle).toBe(450);
    expect(iso(out.lapsedLines[0].since)).toBe('2026-07-20');
    expect(out.lapsedLines[0].savedSoFar).toBe(450);
    expect(out.lapsedLines[0].byOverride).toBe(false);
    expect(out.realisedPerCycle).toBe(450);
    expect(out.realisedSoFar).toBe(450);
    expect(out.optionalPerCycle).toBe(199);
    expect(out.winsSentence).toContain('You stopped 1 subscription');
  });

  it('ignores a stopped shopping pattern: wins need a monthly-or-slower cadence and a regular amount', () => {
    const weekly = line({ id: 'spar|fnb|2000|0', status: 'lapsed', cadence: 'weekly', perYear: 52, kind: 'other', regular: false });
    const irregular = line({ id: 'pnp|fnb|2000|0', status: 'lapsed', cadence: 'irregular', perYear: null, kind: 'other' });
    expect(buildSubscriptions([weekly, irregular], opts).lapsedLines).toHaveLength(0);
  });

  it('lists two charges about a month apart as a tentative new line, never a headline', () => {
    const tentative = line({
      id: 'trial|fnb|2000|0',
      label: 'Newthing',
      dates: [d(2026, 6, 25), d(2026, 7, 25)],
      amount: 1500,
      perCycle: 1500,
      cadence: 'insufficient',
      perYear: null,
      tentative: true,
      level: 'low',
    });
    const out = buildSubscriptions([tentative], opts);
    expect(out.newLines).toHaveLength(1);
    expect(out.newLines[0].wording).toBe('charged twice, about a month apart');
    expect(out.newLines[0].headline).toBe(false);
    expect(out.newLines[0].cyclesSeen).toBe(2);
    expect(plain(out.newLines[0].sentence)).toBe('Newthing: charged twice, about a month apart — R 1 500 a cycle');
    expect(out.newSince).toEqual(expect.objectContaining({ cycle: '2026-05', label: 'May' }));
    // Tentative lines are excluded from every total.
    expect(out.lines).toHaveLength(0);
    expect(out.optionalPerCycle).toBe(0);
  });

  it('recognises a trial that converted: R1 then R199 a month later', () => {
    const trial = line({
      id: 'trial|fnb|2000|0',
      dates: [d(2026, 6, 1), d(2026, 7, 1)],
      amounts: [1, 199],
      cadence: 'insufficient',
      perYear: null,
      tentative: true,
    });
    const out = buildSubscriptions([trial], opts);
    expect(out.newLines[0].trialConverted).toBe(true);
    const notTrial = line({ id: 'x|fnb|2000|0', dates: [d(2026, 6, 1), d(2026, 7, 1)], amounts: [150, 199], tentative: true, cadence: 'insufficient' });
    expect(buildSubscriptions([notTrial], opts).newLines[0].trialConverted).toBe(false);
  });

  it('flags a scheduled new charge over R1 000 with three observations as a headline, and a shop as not', () => {
    const dates = [d(2026, 5, 10), d(2026, 6, 10), d(2026, 7, 10)];
    const headline = line({ id: 'big|fnb|2000|0', dates, amount: 1200, perCycle: 1200, kind: 'other' });
    const shop = line({ id: 'shop|fnb|2000|0', dates: [d(2026, 7, 1), d(2026, 7, 4), d(2026, 7, 6)], amount: 1200, perCycle: 1200, kind: 'other', cadence: 'weekly', perYear: 52 });
    const irregular = line({ id: 'irr|fnb|2000|0', dates, amount: 1200, perCycle: 1200, kind: 'other', cadence: 'irregular', perYear: null });
    const out = buildSubscriptions([headline, shop, irregular], opts);
    expect(out.newLines.map((l) => l.id)).toEqual(['big|fnb|2000|0']);
    expect(out.newLines[0].headline).toBe(true);
    expect(out.newLines[0].wording).toBe('new monthly charge');
  });

  it('does not call a long-standing line new', () => {
    const out = buildSubscriptions([line()], opts);
    expect(out.newLines).toHaveLength(0);
  });

  it('sets aside a twelfth of an annual charge each cycle', () => {
    const annual = line({
      id: 'domain|fnb|2000|0',
      dates: [d(2025, 3, 10), d(2026, 3, 10)],
      amount: 1200,
      perCycle: 100,
      cadence: 'annual',
      perYear: 1,
      medianGap: 365,
      nextDate: d(2027, 3, 10),
    });
    const out = buildSubscriptions([annual], opts);
    expect(out.annualItems).toHaveLength(1);
    expect(out.annualItems[0].setAsidePerCycle).toBe(100);
    expect(out.byCadence.annual).toBe(1);
  });

  it('moves a line the user marked cancelled into the wins and out of the optional total', () => {
    const active = line({ id: 'gym|fnb|2000|0', amount: 450, perCycle: 450 });
    const out = buildSubscriptions([active, line()], { ...opts, lineOverrides: { 'gym|fnb|2000|0': 'cancelled' } });
    expect(out.lapsedLines).toHaveLength(1);
    expect(out.lapsedLines[0].byOverride).toBe(true);
    expect(out.lapsedLines[0].savedPerCycle).toBe(450);
    expect(iso(out.lapsedLines[0].since)).toBe('2026-08-22');
    expect(out.lapsedLines[0].savedSoFar).toBe(0);
    expect(out.optionalPerCycle).toBe(199);
    expect(out.realisedPerCycle).toBe(450);
  });

  it('keeps a kept line visible but out of the totals, and drops an ignored one entirely', () => {
    const kept = line({ id: 'keep|fnb|2000|0', amount: 300, perCycle: 300 });
    const ignored = line({ id: 'ignore|fnb|2000|0', amount: 700, perCycle: 700 });
    const out = buildSubscriptions([kept, ignored, line()], {
      ...opts,
      lineOverrides: { 'keep|fnb|2000|0': 'keep', 'ignore|fnb|2000|0': 'ignore' },
    });
    expect(out.lines.map((l) => l.id)).toEqual(['keep|fnb|2000|0', 'netflix|fnb|2000|0']);
    expect(out.lines[0].override).toBe('keep');
    expect(out.optionalPerCycle).toBe(199);
    expect(out.byKind.optional.count).toBe(1);
  });

  it('reports a price drop as a downgrade', () => {
    const cheaper = line({
      id: 'isp|fnb|2000|0',
      amount: 52,
      perCycle: 52,
      priceChange: { from: 3006, to: 52, pct: 52 / 3006 - 1, since: '2026-03' },
    });
    const out = buildSubscriptions([cheaper], opts);
    expect(out.downgrades).toHaveLength(1);
    expect(out.downgrades[0].savedPerCycle).toBeCloseTo(3006 - 52, 6);
    expect(out.downgrades[0].since).toBe('2026-03');
    expect(out.realisedPerCycle).toBeCloseTo(2954, 6);
  });

  it('lists lines due within a week of the data as due soon', () => {
    const soon = line({ id: 'soon|fnb|2000|0', nextDate: d(2026, 8, 20) });
    const later = line({ id: 'later|fnb|2000|0', nextDate: d(2026, 8, 30) });
    const out = buildSubscriptions([soon, later], opts);
    expect(out.dueSoon.map((l) => l.id)).toEqual(['soon|fnb|2000|0']);
  });

  it('never produces a new line from an unpaired bank-side card repayment', () => {
    const rows = withIds([
      ...anchors(),
      ...['2026-06-05', '2026-07-05', '2026-08-05'].map((date) =>
        row(date, 'Credit Card Repayment', BANK, -8000, { Category: 'Credit Card Repayment', 'Spending Group': 'Transfer' }),
      ),
    ]);
    const cal = buildCycleCalendar(rows, months(rows), ASOF);
    const transfers = buildFullTransfers(rows);
    const { lines } = buildRecurringLines(rows, { calendar: cal, transfers, asOf: ASOF });
    expect(lines.some((l) => /repayment/i.test(l.category ?? ''))).toBe(false);
    const out = buildSubscriptions(lines, { calendar: cal, asOf: ASOF });
    expect(out.newLines).toHaveLength(0);
    // And a hand-built line carrying that category is refused on its category alone.
    const fake = line({ id: 'rep|fnb|2000|0', category: 'Credit Card Repayment', kind: 'other', dates: [d(2026, 6, 5), d(2026, 7, 5), d(2026, 8, 5)] });
    expect(buildSubscriptions([fake], opts).newLines).toHaveLength(0);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('subscriptions on the real export', () => {
  const allMonths = months(real ?? []);
  const realCalendar = buildCycleCalendar(real, allMonths, ASOF);
  const transfers = buildFullTransfers(real);
  const { lines } = buildRecurringLines(real, { calendar: realCalendar, transfers, asOf: ASOF });
  const out = buildSubscriptions(lines, { calendar: realCalendar, asOf: ASOF });

  it('separates the instalments from the optional services', () => {
    expect(out.byKind.instalment.count).toBeGreaterThanOrEqual(4);
    expect(out.byKind.repayment.count).toBeGreaterThanOrEqual(1);
    expect(out.optionalPerCycle).toBeGreaterThan(500);
    expect(out.optionalPerCycle).toBeLessThan(10000);
    expect(out.byKind.optional.count).toBeGreaterThanOrEqual(5);
    expect(out.byCadence.monthly).toBeGreaterThanOrEqual(12);
    expect(out.cycles.length).toBeGreaterThanOrEqual(24);
  });

  it('keeps debt, transfers and shop visits out of the new and lapsed lists', () => {
    out.newLines.forEach((l) => {
      expect(l.source).toBe('charge');
      expect(['instalment', 'repayment']).not.toContain(l.kind);
      expect(/transfer|repayment/i.test(l.category ?? '')).toBe(false);
      expect(l.tentative || l.cadence !== 'irregular').toBe(true);
    });
    out.lapsedLines.forEach((l) => {
      expect(['monthly', 'bimonthly', 'quarterly', 'annual']).toContain(l.cadence);
      expect(l.regular).toBe(true);
    });
    expect(out.realisedPerCycle).toBeGreaterThanOrEqual(0);
    expect(out.realisedPerCycle).toBeLessThan(10000);
    expect(out.newLines.filter((l) => l.headline).length).toBeLessThanOrEqual(2);
  });
});
