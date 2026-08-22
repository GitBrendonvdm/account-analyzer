import { describe, expect, it } from 'vitest';
import { buildCashToPayday } from './cashToPayday';
import { buildFullTransfers } from './flows';
import { parseTransactionDate } from '../utils/date';

const d = (y, m, day) => new Date(y, m - 1, day);
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const BANK = 'fnb|1111';
const OTHER = 'fnb|3333';
const CARD = 'fnb|2222';

/** One cycle, 23 Jul – 22 Aug 2026; the data ends on cycle day 5 (Mon 27 Jul). */
const CAL = {
  starts: { '2026-08': d(2026, 7, 23) },
  ends: { '2026-08': d(2026, 8, 22) },
  lengths: { '2026-08': 31 },
  isPartial: { '2026-08': true },
  isProjected: { '2026-08': true },
  dataThrough: d(2026, 7, 27),
  currentMonth: '2026-08',
  boundaryDom: 23,
  startMonthOffset: -1,
};
const DATA = [
  { id: 1, Date: '2026-07-23', DateObj: parseTransactionDate('2026-07-23'), Description: 'Checkers', Account: 'FNB Bank *1111', Category: 'Groceries', 'Pay Month': '2026-08', AmountNum: -100 },
];
const TRANSFERS = buildFullTransfers(DATA);
const flat = () => new Array(33).fill(1000);

const account = (id, rawName, type, extra = {}) => ({ id, rawName, type, typeOverride: null, hidden: false, currentBalance: null, balanceAsOf: null, creditLimit: null, overdraftLimit: null, external: false, ...extra });
const item = (over = {}) => ({ label: 'Insurance', kind: 'insurance', amount: 6000, level: 'high', payingAccountId: BANK, status: 'due', ...over });

function run(over = {}) {
  return buildCashToPayday({
    data: DATA,
    accounts: [account(BANK, 'FNB Bank *1111', 'Bank')],
    calendar: CAL,
    transfers: TRANSFERS,
    lines: [],
    explained: new Set(),
    upcoming: { entries: [{ date: d(2026, 8, 1), items: [item()] }] },
    incomeProfile: null,
    asOf: d(2026, 7, 27),
    dataThrough: d(2026, 7, 27),
    extendDays: 0,
    overrides: { pace: { [BANK]: flat() }, start: { [BANK]: 20000 }, weekdayFactor: null },
    ...over,
  });
}

const dayOf = (path, cycleDay) => path.days.find((x) => x.cycle === 'current' && x.cycleDay === cycleDay);

describe('buildCashToPayday', () => {
  it('walks a thousand a day from R20 000 and dips below zero on day 20', () => {
    const p = run();
    expect(p.total.days[0].cycleDay).toBe(5);
    expect(p.total.days[0].balance).toBe(20000);
    expect(p.total.days[0].observed).toBe(true);
    expect(dayOf(p.total, 10).balance).toBe(9000);
    expect(dayOf(p.total, 10).scheduled).toHaveLength(1);
    expect(dayOf(p.total, 18).balance).toBe(1000);
    expect(dayOf(p.total, 19).balance).toBe(0);
    expect(p.total.firstBelowFloor.cycleDay).toBe(20);
    expect(p.total.firstBelowFloor.value).toBe(-1000);
    expect(iso(p.horizon.to)).toBe('2026-08-23');
    expect(iso(p.total.min.date)).toBe(iso(p.horizon.to));
    expect(p.total.min.value).toBe(p.total.endOfHorizon);
    expect(p.estimate).toBe(true);
    expect(p.anchored).toBe(false); // the start came from the override, not a typed balance
    expect(p.assumptions.some((a) => /spend pace/.test(a))).toBe(true);
  });

  it('measures the buffer from the floor', () => {
    const p = run({ buffer: 2000 });
    expect(p.total.firstBelowBuffer.cycleDay).toBe(18);
    expect(p.total.firstBelowBuffer.value).toBe(1000);
    expect(p.total.firstBelowFloor.cycleDay).toBe(20);
    expect(p.total.daysUnderBuffer).toBeGreaterThan(0);
  });

  it('lets an overdraft lower the account floor, but not the aggregate one', () => {
    const p = run({ accounts: [account(BANK, 'FNB Bank *1111', 'Bank', { overdraftLimit: 5000 })] });
    const [acct] = p.accounts;
    expect(acct.floor).toBe(-5000);
    expect(dayOf(acct, 24).balance).toBe(-5000);
    expect(acct.firstBelowFloor.cycleDay).toBe(25);
    expect(acct.firstBelowFloor.value).toBe(-6000);
    expect(p.total.firstBelowFloor.cycleDay).toBe(20);
  });

  it('flags the days between the data and today as unobserved', () => {
    const p = run({ asOf: d(2026, 7, 31) });
    [6, 7, 8, 9].forEach((k) => {
      const day = dayOf(p.total, k);
      expect(day.observed).toBe(false);
      expect(day.elapsed).toBe(true);
    });
    expect(dayOf(p.total, 10).elapsed).toBe(false);
    expect(p.total.days[0].observed).toBe(true);
  });

  it('lands the salary on payday', () => {
    const incomeProfile = {
      sources: [{ id: 's', accountId: BANK, kind: 'salary', presence: 1, expectedAmount: 75000, expectedNext: d(2026, 8, 23) }],
      salary: { lateRisk: 0, lateDelayP90: 0 },
    };
    const p = run({ incomeProfile });
    expect(p.total.atPayday.after - p.total.atPayday.before).toBe(75000);
    const payday = p.total.days.find((x) => x.cycle === 'next');
    expect(payday.income).toBe(75000);
    expect(p.lateSalary).toBeNull();
  });

  it('reruns with the salary late when the profile says it has been', () => {
    const incomeProfile = {
      sources: [{ id: 's', accountId: BANK, kind: 'salary', presence: 1, expectedAmount: 75000, expectedNext: d(2026, 8, 23) }],
      salary: { lateRisk: 0.25, lateDelayP90: 5, cycles: 12, missingCycles: ['2026-01'], lateCycles: ['2026-04', '2026-06'] },
    };
    const p = run({ incomeProfile, extendDays: 7 });
    expect(p.lateSalary).not.toBeNull();
    expect(p.lateSalary.delayDays).toBe(5);
    expect(p.lateSalary.probability).toBe(0.25);
    expect(p.lateSalary.min.value).toBeLessThan(p.total.min.value);
    expect(p.assumptions.some((a) => /5 days late/.test(a))).toBe(true);
  });

  it('shows change since today when no balance is known', () => {
    const p = run({ overrides: { pace: { [BANK]: flat() }, weekdayFactor: null } });
    expect(p.anchored).toBe(false);
    expect(p.total.days[0].balance).toBe(0);
    expect(dayOf(p.total, 10).balance).toBe(-11000);
  });

  it('never deducts a landed item again, and charges an item to its own account', () => {
    const p = run({
      accounts: [account(BANK, 'FNB Bank *1111', 'Bank'), account(OTHER, 'FNB Bank *3333', 'Bank', { external: true, currentBalance: 5000, balanceAsOf: '2026-07-27' })],
      upcoming: {
        entries: [
          { date: d(2026, 7, 29), items: [item({ label: 'Landed', amount: 5000, status: 'landed' })] },
          { date: d(2026, 8, 1), items: [item(), item({ label: 'Other bill', amount: 4000, payingAccountId: OTHER })] },
        ],
      },
      overrides: { pace: { [BANK]: flat(), [OTHER]: new Array(33).fill(0) }, start: { [BANK]: 20000 }, weekdayFactor: null },
    });
    const [bank, other] = p.accounts;
    expect(dayOf(bank, 7).balance).toBe(18000);
    expect(dayOf(bank, 7).scheduled).toHaveLength(0);
    expect(other.known).toBe(true);
    expect(other.start).toBe(5000);
    expect(dayOf(other, 9).balance).toBe(5000);
    expect(dayOf(other, 10).balance).toBe(1000);
    expect(dayOf(p.total, 10).balance).toBe(9000 + 1000);
    expect(p.anchored).toBe(true);
  });

  it('runs a card to its limit at a thousand a day', () => {
    const p = run({
      accounts: [
        account(BANK, 'FNB Bank *1111', 'Bank'),
        account(CARD, 'FNB Credit Card *2222', 'Credit Card', { currentBalance: -50000, balanceAsOf: '2026-07-27', creditLimit: 60000 }),
      ],
      overrides: { pace: { [BANK]: flat(), [CARD]: flat() }, start: { [BANK]: 20000 }, weekdayFactor: null },
    });
    expect(p.cards).toHaveLength(1);
    expect(p.cards[0].start).toBe(-50000);
    expect(p.cards[0].firstLimit.cycleDay).toBe(15);
    expect(p.cards[0].days.every((x) => x.balance >= -60000)).toBe(true);
    // Card spend never touches the cash path.
    expect(dayOf(p.total, 10).balance).toBe(9000);
  });

  it('drops the low band below and lifts the high band above the central path', () => {
    const p = run({
      upcoming: { entries: [{ date: d(2026, 8, 1), items: [item(), item({ label: 'Maybe', amount: 2000, level: 'low' }), item({ label: 'Probably', amount: 1000, level: 'medium' })] }] },
    });
    const day = dayOf(p.total, 10);
    expect(day.balance).toBe(9000 - 1000);
    expect(day.low).toBe(day.balance - 2000);
    expect(day.high).toBe(day.balance + 1000);
  });

  it('returns null without a liquid account', () => {
    expect(run({ accounts: [] })).toBeNull();
  });
});
