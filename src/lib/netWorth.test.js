import { describe, expect, it } from 'vitest';
import { buildAccountPositions } from './accountSeries';
import { applyBalances, cardHeadroom, overdraftHeadroom, summariseNetWorth } from './netWorth';
import { positionAt, accountRows } from './ledger';
import { parseTransactionDate } from '../utils/date';

const MONTHS = ['2026-06', '2026-07', '2026-08'];
const BANK = 'FNB Bank *1111';
const CARD = 'FNB Credit Card *2222';

let nextId = 1;
function row(date, account, amount) {
  const payMonth = date < '2026-06-23' ? '2026-06' : date < '2026-07-23' ? '2026-07' : '2026-08';
  return {
    id: nextId++,
    Date: date,
    DateObj: parseTransactionDate(date),
    Description: 'row',
    Account: account,
    Category: 'Groceries',
    'Pay Month': payMonth,
    AmountNum: amount,
  };
}

const record = (id, rawName, type, extra = {}) => ({
  id,
  rawName,
  type,
  typeOverride: null,
  label: null,
  seenNames: [rawName],
  currentBalance: null,
  balanceAsOf: null,
  creditLimit: null,
  overdraftLimit: null,
  external: false,
  ...extra,
});

const baseRows = () => [
  row('2026-06-01', BANK, 5000),
  row('2026-06-15', BANK, -1200),
  row('2026-07-05', BANK, -800),
  row('2026-07-20', BANK, 3000),
  row('2026-08-02', BANK, -400),
  row('2026-06-10', CARD, -2000),
  row('2026-07-10', CARD, -1500),
  row('2026-08-01', CARD, 2000),
];

describe('applyBalances — as-of anchoring', () => {
  it('re-bases every month from a balance stated mid-window, and later rows cannot move it', () => {
    const data = baseRows();
    const accounts = new Map([
      ['fnb|1111', record('fnb|1111', BANK, 'Bank', { currentBalance: 1000, balanceAsOf: '2026-07-10' })],
    ]);
    const positions = buildAccountPositions(data, [BANK], MONTHS);
    const [bank] = applyBalances(positions, accounts, MONTHS, { data });

    const rows = accountRows(data, { rawNames: [BANK] });
    const offset = 1000 - positionAt(rows, '2026-07-10');
    expect(bank.known).toBe(true);
    expect(bank.offset).toBeCloseTo(offset, 6);
    MONTHS.forEach((m) => {
      expect(bank.balanceByMonth[m]).toBeCloseTo(bank.positionByMonth[m] + offset, 6);
    });
    // The balance today is the stated balance plus everything that moved since the as-of date.
    const since = positionAt(rows, '2026-08-31') - positionAt(rows, '2026-07-10');
    expect(bank.balance).toBeCloseTo(1000 + since, 6);

    // Append a row after the as-of date: the offset is unchanged and the balance follows the movement.
    const more = [...data, row('2026-08-20', BANK, 500)];
    const [later] = applyBalances(buildAccountPositions(more, [BANK], MONTHS), accounts, MONTHS, { data: more });
    expect(later.offset).toBeCloseTo(offset, 6);
    expect(later.balance).toBeCloseTo(1000 + since + 500, 6);
    expect(later.balanceByMonth['2026-07']).toBeCloseTo(bank.balanceByMonth['2026-07'], 6);
  });

  it('keeps the legacy current-cycle rule when no rows are given', () => {
    const data = baseRows();
    const accounts = new Map([['fnb|1111', record('fnb|1111', BANK, 'Bank', { currentBalance: 1000 })]]);
    const positions = buildAccountPositions(data, [BANK], MONTHS);
    const [bank] = applyBalances(positions, accounts, MONTHS);
    expect(bank.balance).toBe(1000);
    expect(bank.balanceByMonth['2026-08']).toBe(1000);
  });

  it('appends an external Savings record as a flat line and counts it in assets', () => {
    const data = baseRows();
    const accounts = new Map([
      ['fnb|1111', record('fnb|1111', BANK, 'Bank', { currentBalance: 1000, balanceAsOf: '2026-08-02' })],
      ['ra|9999', record('ra|9999', 'Allan Gray Savings *9999', 'Savings', { currentBalance: 17227.87, external: true, source: 'statement' })],
    ]);
    const balanced = applyBalances(buildAccountPositions(data, [BANK], MONTHS), accounts, MONTHS, { data });
    const external = balanced.find((b) => b.external);
    expect(external).toBeTruthy();
    expect(external.type).toBe('Savings');
    expect(external.known).toBe(true);
    expect(external.balance).toBe(17227.87);
    MONTHS.forEach((m) => expect(external.balanceByMonth[m]).toBe(17227.87));
    expect(external.typicalDelta).toBe(0);
    expect(external.windowChange).toBe(0);

    const summary = summariseNetWorth(balanced, MONTHS);
    expect(summary.assets).toBeCloseTo(1000 + 17227.87, 6);
    expect(summary.totalCount).toBe(2);
  });

  it('does not resurrect a deselected account that has rows', () => {
    const data = baseRows();
    const accounts = new Map([
      ['fnb|1111', record('fnb|1111', BANK, 'Bank', { currentBalance: 1000 })],
      ['fnb|2222', record('fnb|2222', CARD, 'Credit Card', { currentBalance: -500 })],
    ]);
    const balanced = applyBalances(buildAccountPositions(data, [BANK], MONTHS), accounts, MONTHS, { data });
    expect(balanced.map((b) => b.account)).toEqual([BANK]);
  });

  it('honours a typeOverride of Loan on a Bank-named account, making it debt', () => {
    const data = [...baseRows(), row('2026-06-05', 'FNB Bank *3333', -100000), row('2026-07-25', 'FNB Bank *3333', 2000)];
    const accounts = new Map([
      ['fnb|3333', record('fnb|3333', 'FNB Bank *3333', 'Bank', { typeOverride: 'Loan', type: 'Loan', currentBalance: -98000, balanceAsOf: '2026-07-25' })],
    ]);
    const balanced = applyBalances(buildAccountPositions(data, ['FNB Bank *3333'], MONTHS), accounts, MONTHS, { data });
    expect(balanced[0].type).toBe('Loan');
    expect(balanced[0].isLiability).toBe(true);
    const summary = summariseNetWorth(balanced, MONTHS);
    expect(summary.debt).toBe(98000);
    expect(summary.assets).toBe(0);
  });

  it('counts a renamed account once: only the current label is known', () => {
    const data = [...baseRows(), row('2026-08-10', 'FNB Savings *1111', -50)];
    const accounts = new Map([
      ['fnb|1111', record('fnb|1111', 'FNB Savings *1111', 'Savings', { seenNames: [BANK, 'FNB Savings *1111'], currentBalance: 1000 })],
    ]);
    const balanced = applyBalances(buildAccountPositions(data, [BANK, 'FNB Savings *1111'], MONTHS), accounts, MONTHS, { data });
    const known = balanced.filter((b) => b.known);
    expect(known).toHaveLength(1);
    expect(known[0].account).toBe('FNB Savings *1111');
  });
});

describe('headroom', () => {
  it('overdraftHeadroom: balance −9 341.97 against a R18 298.40 facility leaves R8 956.43', () => {
    const [h] = overdraftHeadroom([
      { type: 'Bank', known: true, balance: -9341.97, overdraftLimit: 18298.4, label: 'Cheque', account: BANK },
    ]);
    expect(h.available).toBeCloseTo(8956.43, 2);
    expect(h.limit).toBe(18298.4);
    expect(overdraftHeadroom([{ type: 'Bank', known: true, balance: 500, overdraftLimit: 1000 }])[0].available).toBe(1000);
  });

  it('cardHeadroom rows carry overdraftLimit: null', () => {
    const [h] = cardHeadroom([{ type: 'Credit Card', known: true, balance: -30000, creditLimit: 50000, account: CARD }]);
    expect(h.available).toBe(20000);
    expect(h.overdraftLimit).toBeNull();
  });
});
