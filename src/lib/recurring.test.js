import { describe, expect, it } from 'vitest';
import { buildRecurringLines, EMBEDDED_RE, linesDueBetween } from './recurring';
import { buildFullTransfers, completeMonths } from './flows';
import { buildCycleCalendar } from './cycleCurve';
import { isPersonPayment, mergePrefixKeys, PERSON_LABEL } from './merchants';
import { assignKeys } from '../db/txnKey';
import { loadRealExport } from '../test/realData';

/**
 * Fixtures follow the real export's 23rd→22nd cycle. Salary anchors on every 23rd pin the calendar
 * boundary; a marker row at `dataThrough` makes the calendar's own "data through" agree with the
 * option passed in. asOf = 22 Aug 2026, dataThrough = 18 Aug 2026 unless a test says otherwise.
 */
const BANK = 'FNB Bank *2000';
const CARD = 'FNB Credit Card *0000';
const LOAN = 'FNB Loan *4081';

function payMonthOf(date) {
  const [y, m, day] = date.split('-').map(Number);
  const key = day >= 23 ? new Date(y, m, 1) : new Date(y, m - 1, 1);
  return `${key.getFullYear()}-${String(key.getMonth() + 1).padStart(2, '0')}`;
}

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

const isoOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const iso = (x) => isoOf(x.getFullYear(), x.getMonth() + 1, x.getDate());

/** The 1st (or `day`) of each of `n` consecutive months starting at year/month. */
function monthly(start, n, { day = 1 } = {}) {
  const [y, m] = start.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return isoOf(d.getFullYear(), d.getMonth() + 1, day);
  });
}

function anchors(through) {
  const rows = [row('2024-08-23', 'Salary', BANK, 50000)];
  for (let i = 1; i < 24; i += 1) {
    const d = new Date(2024, 7 + i, 23);
    rows.push(row(isoOf(d.getFullYear(), d.getMonth() + 1, 23), 'Salary', BANK, 50000));
  }
  rows.push(row(through, 'Checkers', BANK, -100, { key: 'marker' }));
  return rows;
}

/** Build lines from fixture rows. Returns the engine's result plus the non-anchor lines. */
function build(rows, { through = '2026-08-18', asOf = new Date(2026, 7, 22), includeRepayments = true } = {}) {
  const data = [...anchors(through), ...rows].map((r, i) => ({ ...r, id: i, key: r.key ?? `k${i}` }));
  const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
  const calendar = buildCycleCalendar(data, months, asOf);
  const transfers = buildFullTransfers(data);
  const [y, m, d] = through.split('-').map(Number);
  const result = buildRecurringLines(data, {
    calendar,
    transfers,
    asOf,
    dataThrough: new Date(y, m - 1, d),
    includeRepayments,
  });
  return { ...result, data, calendar, lines: result.lines.filter((l) => l.key !== 'checkers') };
}

describe('merchants additions', () => {
  it('folds truncation variants onto the shortest specific key', () => {
    const m = mergePrefixKeys(['apple.com bi', 'apple.com bil', 'apple.com bill']);
    expect(m.get('apple.com bi')).toBe('apple.com bi');
    expect(m.get('apple.com bil')).toBe('apple.com bi');
    expect(m.get('apple.com bill')).toBe('apple.com bi');
  });

  it('leaves keys that only share a first token, and short keys, alone', () => {
    const engen = mergePrefixKeys(['engen capegate', 'engen durbanville']);
    expect(engen.get('engen capegate')).toBe('engen capegate');
    expect(engen.get('engen durbanville')).toBe('engen durbanville');
    const spar = mergePrefixKeys(new Set(['spar', 'spar ma']));
    expect(spar.get('spar')).toBe('spar');
    expect(spar.get('spar ma')).toBe('spar ma');
    // A prefix that splits a token is not a prefix of that merchant.
    expect(mergePrefixKeys(['checkers', 'checkersss hyper']).get('checkersss hyper')).toBe('checkersss hyper');
  });

  it('recognises person-to-person payments', () => {
    expect(isPersonPayment('1Sa Some Person Ref')).toBe(true);
    expect(isPersonPayment('  1sa x')).toBe(true);
    expect(isPersonPayment('1Sax Shop')).toBe(false);
    expect(isPersonPayment('Checkers')).toBe(false);
    expect(isPersonPayment(null)).toBe(false);
    expect(PERSON_LABEL).toBe('Payment to a person');
  });
});

describe('buildRecurringLines', () => {
  it('1. twelve monthly charges on the 1st become one high-confidence monthly line', () => {
    const rows = monthly('2025-09', 12).map((d) =>
      row(d, 'Netflix.Com', BANK, -499, { Category: 'Entertainment', 'Spending Group': 'Recurring' }),
    );
    const { lines, explained, cycles } = build(rows);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.key).toBe('netflix.com');
    expect(line.label).toBe('Netflix.Com');
    expect(line.id).toBe('netflix.com|fnb|2000|0');
    expect(line.source).toBe('charge');
    expect(line.kind).toBe('optional');
    expect(line.cadence).toBe('monthly');
    expect(line.perYear).toBe(12);
    expect(line.dom).toBe(1);
    expect(line.domIqr).toBe(0);
    expect(line.weekendShift).toBeNull();
    expect(line.level).toBe('high');
    expect(line.confidence).toBeCloseTo(1, 6);
    expect(iso(line.nextDate)).toBe('2026-09-01');
    expect(line.dueCycle).toBe('2026-09');
    expect(line.dueThisCycle).toBe(false);
    expect(line.status).toBe('active');
    expect(line.cycleStatus).toBe('landed');
    expect(line.landedKey).toBeTruthy();
    expect(line.perCycle).toBe(499);
    expect(line.perYearAmount).toBe(499 * 12);
    expect(line.amount).toBe(499);
    expect(line.amountStable).toBe(true);
    expect(line.regular).toBe(true);
    expect(line.range).toEqual([499, 499]);
    expect(line.regimes).toHaveLength(1);
    expect(line.regimes[0]).toEqual({ from: '2025-09', to: '2026-08', amount: 499, count: 12 });
    expect(line.priceChange).toBeNull();
    expect(line.outliers).toBe(0);
    expect(line.observations).toBe(12);
    expect(line.tentative).toBe(false);
    expect(line.cyclesSinceFirst).toBe(11);
    expect(line.cyclesPresent).toBe(11);
    expect(line.presence).toBe(1);
    expect(line.perCycleAmounts).toEqual(new Array(11).fill(499));
    expect(iso(line.firstSeen)).toBe('2025-09-01');
    expect(iso(line.lastSeen)).toBe('2026-08-01');
    expect(line.accountId).toBe('fnb|2000');
    expect(line.payingAccountId).toBe('fnb|2000');
    expect(line.loanAccountId).toBeNull();
    expect(line.cardAccountId).toBeNull();
    expect(line.category).toBe('Entertainment');
    expect(line.spendingGroup).toBe('Recurring');
    expect(line.items).toHaveLength(12);
    line.items.forEach((t) => expect(explained.has(t)).toBe(true));
    expect(cycles[cycles.length - 1]).toBe('2026-07');
  });

  it('2. learns that a line moves to the Monday after a weekend 1st', () => {
    const dates = monthly('2025-09', 12).map((d) =>
      d === '2025-11-01' ? '2025-11-03' : d === '2026-03-01' ? '2026-03-02' : d,
    );
    const { lines } = build(dates.map((d) => row(d, 'Gym Co', BANK, -499)));
    expect(lines).toHaveLength(1);
    expect(lines[0].weekendShift).toBe('later');
    expect(lines[0].cadence).toBe('monthly');
    expect(lines[0].dom).toBe(1);
    expect(lines[0].cycleStatus).toBe('landed');

    // With the data stopping in July, the predicted 1 Aug 2026 is a Saturday → Monday 3 Aug.
    const short = build(dates.slice(0, 11).map((d) => row(d, 'Gym Co', BANK, -499)), {
      through: '2026-08-10',
    });
    expect(short.lines).toHaveLength(1);
    expect(iso(short.lines[0].nextDate)).toBe('2026-08-03');
    expect(short.lines[0].dueThisCycle).toBe(true);
    expect(short.lines[0].dueCycle).toBe('2026-08');
    // 3 Aug + 3 days grace < 10 Aug and nothing landed → overdue.
    expect(short.lines[0].cycleStatus).toBe('overdue');
  });

  it('3. truncation variants of one description are one line', () => {
    const names = ['Apple.Com Bi', 'Apple.Com Bil', 'Apple.Com Bill'];
    const rows = monthly('2025-09', 12, { day: 15 }).map((d, i) => row(d, names[i % 3], BANK, -199.99));
    const { lines } = build(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0].key).toBe('apple.com bi');
    expect(lines[0].observations).toBe(12);
    expect(lines[0].kind).toBe('optional');
  });

  it('4a. two amounts interleaved in time are two lines', () => {
    const rows = monthly('2026-02', 6, { day: 5 }).flatMap((d) => [
      row(d, 'Gym Co', BANK, -200),
      row(d.replace(/-05$/, '-12'), 'Gym Co', BANK, -150),
    ]);
    const { lines } = build(rows);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.amount).sort((a, b) => a - b)).toEqual([150, 200]);
    expect(lines.map((l) => l.id).sort()).toEqual(['gym co|fnb|2000|0', 'gym co|fnb|2000|1']);
    expect(lines.find((l) => l.amount === 150).id).toBe('gym co|fnb|2000|0');
    lines.forEach((l) => expect(l.cadence).toBe('monthly'));
  });

  it('4b. a price step within 45 days is one line with two regimes', () => {
    const rows = [
      ...monthly('2025-07', 6, { day: 15 }).map((d) => row(d, 'Afrihost', BANK, -449)),
      ...monthly('2026-01', 6, { day: 15 }).map((d) => row(d, 'Afrihost', BANK, -519)),
    ];
    const { lines } = build(rows);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.regimes).toHaveLength(2);
    expect(line.regimes[0]).toEqual({ from: '2025-07', to: '2025-12', amount: 449, count: 6 });
    expect(line.regimes[1]).toEqual({ from: '2026-01', to: '2026-06', amount: 519, count: 6 });
    expect(line.amount).toBe(519);
    expect(line.priceChange.from).toBe(449);
    expect(line.priceChange.to).toBe(519);
    expect(line.priceChange.pct).toBeCloseTo(0.156, 3);
    expect(line.priceChange.since).toBe('2026-01');
    expect(line.perCycle).toBe(519);
    expect(line.observations).toBe(12);
  });

  it('4c. a one-off inside the span is an outlier, not a regime', () => {
    const rows = monthly('2025-09', 12, { day: 15 }).map((d) => row(d, 'Dis-Chem', BANK, -300));
    rows.push(row('2026-02-20', 'Dis-Chem', BANK, -1200));
    const { lines } = build(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0].outliers).toBe(1);
    expect(lines[0].regimes).toHaveLength(1);
    expect(lines[0].amount).toBe(300);
    expect(lines[0].observations).toBe(13);
    expect(lines[0].items).toHaveLength(13);
  });

  it('5. weekly charges every Monday predict the next Monday', () => {
    const rows = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(2026, 2, 30 + 7 * i);
      return row(iso(d), 'Uber Eats', BANK, -180, { Category: 'Eating Out & Takeaways' });
    });
    const { lines } = build(rows);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.cadence).toBe('weekly');
    expect(line.perYear).toBe(52);
    expect(iso(line.lastSeen)).toBe('2026-08-10');
    expect(iso(line.nextDate)).toBe('2026-08-17');
    expect(line.gapIqr).toBe(0);
    expect(line.domIqr).toBeNull();
    expect(line.presence).toBe(1);
    expect(line.perCycle).toBeCloseTo((180 * 52) / 12, 6);
    expect(line.cycleStatus).toBeNull();
    expect(line.status).toBe('active');
  });

  it('6. a missing charge is overdue past the grace, or unobservable when the export is stale', () => {
    const rows = monthly('2026-01', 7, { day: 10 }).map((d) => row(d, 'Vodacom', BANK, -899));
    const overdue = build(rows, { through: '2026-08-14' });
    expect(overdue.lines).toHaveLength(1);
    expect(overdue.lines[0].dom).toBe(10);
    expect(overdue.lines[0].status).toBe('active');
    expect(overdue.lines[0].cycleStatus).toBe('overdue');
    expect(iso(overdue.lines[0].nextDate)).toBe('2026-08-10');

    const stale = build(rows, { through: '2026-08-08' });
    expect(stale.lines[0].cycleStatus).toBe('unobservable');

    // Before the predicted date, and before today: simply due.
    const due = build(rows, { through: '2026-08-08', asOf: new Date(2026, 7, 9) });
    expect(due.lines[0].cycleStatus).toBe('due');
  });

  it('7. budget-facility direct payments are not candidates, so the instalment is one line', () => {
    const rows = monthly('2026-02', 6, { day: 20 }).flatMap((d) => [
      row(d, 'Budget Facility Instalment', CARD, -1200, { Category: 'Credit Card Repayment' }),
      row(d, 'Budget Facility Direct Payment', CARD, -1200, { Category: 'Other' }),
    ]);
    // The instalment carries a repayment category in the real export; here it must stay a spend
    // row, so give it an ordinary one.
    rows.forEach((r) => {
      if (r.Description === 'Budget Facility Instalment') r.Category = 'General Purchases';
    });
    const { lines, data } = build(rows);
    const budget = lines.filter((l) => l.key === 'budget facility');
    expect(budget).toHaveLength(1);
    expect(budget[0].observations).toBe(6);
    expect(budget[0].items.every((t) => /instalment/i.test(t.Description))).toBe(true);
    expect(data.filter((t) => /direct payment/i.test(t.Description))).toHaveLength(6);
  });

  it('8. a paired loan instalment is an instalment line carrying both account ids', () => {
    const rows = monthly('2026-02', 6, { day: 25 }).flatMap((d) => [
      row(d, 'Wesbank Instalment', BANK, -4990.67, { Category: 'Vehicle Loan / Car Loan' }),
      row(d, 'Instalment received', LOAN, 4990.67, { Category: 'Vehicle Loan / Car Loan' }),
    ]);
    const { lines, explained } = build(rows);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.source).toBe('instalment');
    expect(line.kind).toBe('instalment');
    expect(line.id).toBe('loan|fnb|4081|fnb|2000|0');
    expect(line.loanAccountId).toBe('fnb|4081');
    expect(line.payingAccountId).toBe('fnb|2000');
    expect(line.accountId).toBe('fnb|2000');
    expect(line.amount).toBe(4990.67);
    expect(line.cadence).toBe('monthly');
    expect(line.dom).toBe(25);
    expect(line.category).toBe('Vehicle Loan / Car Loan');
    expect(line.items.every((t) => t.Account === BANK)).toBe(true);
    line.items.forEach((t) => expect(explained.has(t)).toBe(true));
  });

  it('8b. an instalment whose amount steps keeps one line with two regimes', () => {
    const rows = [
      ...monthly('2025-09', 5, { day: 25 }).map((d) => row(d, 'Bond', BANK, -24868, { Category: 'Home Loan / Bond' })),
      ...monthly('2026-02', 6, { day: 25 }).map((d) => row(d, 'Bond', BANK, -22855, { Category: 'Home Loan / Bond' })),
      // One doubled payment is an outlier, not a third regime.
      row('2026-04-28', 'Bond', BANK, -45710, { Category: 'Home Loan / Bond' }),
    ];
    const { lines } = build(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0].source).toBe('instalment');
    expect(lines[0].id).toBe('loan|Home Loan / Bond|fnb|2000|fnb|2000|0');
    expect(lines[0].regimes.map((r) => r.amount)).toEqual([24868, 22855]);
    expect(lines[0].priceChange.pct).toBeCloseTo(22855 / 24868 - 1, 6);
    expect(lines[0].outliers).toBe(1);
  });

  it('9. a payment to a person is labelled as one', () => {
    const rows = monthly('2026-01', 8).map((d) => row(d, '1Sa Some Person Ref', BANK, -800));
    const { lines } = build(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe(PERSON_LABEL);
    expect(lines[0].kind).toBe('person');
    expect(lines[0].id).toBe('person|some person|fnb|2000|0');
  });

  it('10. two charges a month apart are kept as tentative', () => {
    const rows = [row('2026-06-25', 'Showmax', BANK, -99), row('2026-07-25', 'Showmax', BANK, -99)];
    const { lines } = build(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0].tentative).toBe(true);
    expect(lines[0].cadence).toBe('insufficient');
    expect(lines[0].level).toBe('low');
    expect(lines[0].observations).toBe(2);
    expect(lines[0].nextDate).toBeNull();
    expect(lines[0].cycleStatus).toBeNull();
    expect(lines[0].perCycle).toBe(99);
    expect(lines[0].kind).toBe('optional');
    // Two charges ten days apart are merely insufficient and are dropped.
    const dropped = build([row('2026-07-05', 'Showmax', BANK, -99), row('2026-07-15', 'Showmax', BANK, -99)]);
    expect(dropped.lines).toHaveLength(0);
  });

  it('11. card repayments become a repayment line, dated by the debit, capped at medium', () => {
    const rows = monthly('2026-01', 7, { day: 26 }).flatMap((d) => [
      row(d, 'Payment to card', BANK, -5000, { Category: 'Credit Card Repayment' }),
      row(d.replace(/-26$/, '-27'), 'Payment received', CARD, 5000, { Category: 'Credit Card Repayment' }),
    ]);
    const { lines, explained } = build(rows);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.source).toBe('repayment');
    expect(line.kind).toBe('repayment');
    expect(line.id).toBe('repayment|fnb|0000|fnb|2000|fnb|2000|0');
    expect(line.cardAccountId).toBe('fnb|0000');
    expect(line.payingAccountId).toBe('fnb|2000');
    expect(line.dom).toBe(26);
    expect(line.amount).toBe(5000);
    expect(line.regimes).toHaveLength(1);
    expect(line.priceChange).toBeNull();
    expect(line.level).toBe('medium');
    expect(line.label).toBe('Card repayment');
    expect(explained.size).toBe(14);
    expect(build(rows, { includeRepayments: false }).lines).toHaveLength(0);
  });

  it('12. embedded loan cover and fees are lines of their own kind', () => {
    const rows = [
      ...monthly('2026-01', 7, { day: 5 }).map((d) => row(d, 'Cpp Insurance Premium', LOAN, -607.04, { Category: 'Other Insurance' })),
      ...monthly('2026-01', 7, { day: 5 }).map((d) => row(d, 'Nca Service Fee', LOAN, -69, { Category: 'Bank Charges' })),
      ...monthly('2026-01', 7, { day: 5 }).map((d) => row(d, 'Interest', LOAN, -2400, { Category: 'Interest' })),
    ];
    const { lines } = build(rows);
    expect(lines).toHaveLength(2);
    lines.forEach((l) => expect(l.source).toBe('embedded'));
    expect(lines.map((l) => l.kind).sort()).toEqual(['fee', 'insurance']);
    expect(EMBEDDED_RE.test('Credit Life Premium')).toBe(true);
  });

  it('drops a line present only in the current cycle, and reads a future line as active', () => {
    const single = build([row('2026-08-02', 'New Thing', BANK, -250), row('2026-08-09', 'New Thing', BANK, -250), row('2026-08-16', 'New Thing', BANK, -250)]);
    expect(single.lines).toHaveLength(0);

    const rows = monthly('2025-09', 12).map((d) => row(d, 'Netflix.Com', BANK, -499));
    const early = build(rows, { through: '2025-06-10', asOf: new Date(2025, 5, 10) });
    expect(early.lines).toHaveLength(0);
  });

  it('orders lines by per-cycle cost and lists what is due in a window', () => {
    const rows = [
      ...monthly('2025-09', 12, { day: 1 }).map((d) => row(d, 'Netflix.Com', BANK, -499)),
      ...monthly('2025-09', 12, { day: 15 }).map((d) => row(d, 'Spotify', BANK, -80)),
    ];
    const { lines } = build(rows);
    expect(lines.map((l) => l.key)).toEqual(['netflix.com', 'spotify']);
    const due = linesDueBetween(lines, new Date(2026, 7, 19), new Date(2026, 8, 10));
    expect(due.map((l) => l.key)).toEqual(['netflix.com']);
    expect(linesDueBetween(lines, new Date(2026, 7, 19), new Date(2026, 8, 20)).map((l) => l.key)).toEqual([
      'netflix.com',
      'spotify',
    ]);
    expect(linesDueBetween(lines, null, new Date())).toEqual([]);
  });

  it('returns an empty result without data, a calendar or transfers', () => {
    expect(buildRecurringLines([], {}).lines).toEqual([]);
    expect(buildRecurringLines([row('2026-01-01', 'x', BANK, -1)], { calendar: null, transfers: null }).lines).toEqual([]);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('recurring on the real export', () => {
  // The bootstrap hands rows over with their stable keys; the raw CSV does not carry them yet.
  const data = real ? assignKeys(real) : [];
  const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
  const asOf = new Date(2026, 7, 22);
  const calendar = buildCycleCalendar(data, months, asOf);
  const transfers = buildFullTransfers(data);
  const { lines, explained, cycles } = buildRecurringLines(data, { calendar, transfers, asOf });

  it('finds a dozen high-confidence monthly lines and every loan instalment', () => {
    expect(cycles).toEqual(completeMonths(calendar));
    expect(lines.length).toBeGreaterThan(20);
    const monthlyHigh = lines.filter((l) => l.cadence === 'monthly' && l.level === 'high');
    expect(monthlyHigh.length).toBeGreaterThanOrEqual(12);
    const instalments = lines.filter((l) => l.source === 'instalment');
    expect(instalments.length).toBeGreaterThanOrEqual(4);
    instalments.forEach((l) => {
      expect(l.kind).toBe('instalment');
      expect(l.payingAccountId).toBeTruthy();
    });
    expect(lines.filter((l) => l.source === 'repayment').length).toBeGreaterThan(0);
  });

  it('keeps every line well-formed and never keys on a row id', () => {
    lines.forEach((l) => {
      expect(l.id).toMatch(/\|\d+$/);
      expect(l.id.startsWith(l.key) || /^(loan|repayment|person)\|/.test(l.id)).toBe(true);
      expect(['charge', 'embedded', 'instalment', 'repayment']).toContain(l.source);
      expect(['active', 'lapsed']).toContain(l.status);
      expect(['high', 'medium', 'low']).toContain(l.level);
      expect(l.perCycle).toBeGreaterThanOrEqual(0);
      expect(l.items.length).toBe(l.observations);
      l.items.forEach((t) => expect(explained.has(t)).toBe(true));
      if (l.nextDate) expect(l.dueCycle).toMatch(/^\d{4}-\d{2}$/);
      if (l.tentative) expect(l.level).toBe('low');
    });
    const ids = lines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('judges the current cycle against the data, with landed charges carrying a key', () => {
    const judged = lines.filter((l) => l.cycleStatus);
    expect(judged.length).toBeGreaterThan(5);
    judged
      .filter((l) => l.cycleStatus === 'landed')
      .forEach((l) => expect(typeof l.landedKey).toBe('string'));
    expect(judged.every((l) => ['landed', 'due', 'overdue', 'unobservable'].includes(l.cycleStatus))).toBe(true);
  });
});
