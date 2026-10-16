import { describe, expect, it } from 'vitest';
import { everydayAccounts, everydayFlow, netWorthTrend } from './glance';

const acct = (id, type, extra = {}) => ({ id, type, rawName: `${id} ${type}`, ...extra });
const NAME = { 'fnb|9986': 'FNB Bank *9986', 'fnb|0000': 'FNB Credit Card *0000', 'fnb|4359': 'FNB Bank *4359', 'fnb|2000': 'FNB Credit Card *2000', 'fnb|6996': 'FNB Loan *6996' };
const rows = (id, n, date = '2026-10-10') => Array.from({ length: n }, () => ({ Date: date, Account: NAME[id], AmountNum: -10 }));

const CHEQUE = acct('fnb|9986', 'Bank');
const CARD = acct('fnb|0000', 'Credit Card');
const EMERGENCY = acct('fnb|4359', 'Bank');
const OLD_CARD = acct('fnb|2000', 'Credit Card');
const BOND = acct('fnb|6996', 'Loan');

describe('everydayAccounts', () => {
  const data = [...rows('fnb|9986', 150), ...rows('fnb|0000', 170), ...rows('fnb|4359', 12), ...rows('fnb|2000', 40, '2026-03-01'), ...rows('fnb|6996', 25)];

  it('is the cheque account and the card in use, not savings, loans or what went quiet', () => {
    expect(everydayAccounts([CHEQUE, CARD, EMERGENCY, OLD_CARD, BOND], data).map((a) => a.id)).toEqual(['fnb|9986', 'fnb|0000']);
  });

  it('leaves out what is closed, hidden or external', () => {
    const accounts = [CHEQUE, { ...CARD, closedOn: '2026-10-15' }, { ...EMERGENCY, hidden: true }, acct('x|1', 'Bank', { external: true })];
    expect(everydayAccounts(accounts, data).map((a) => a.id)).toEqual(['fnb|9986']);
  });

  it('is empty when there is nothing to go on', () => {
    expect(everydayAccounts([], data)).toEqual([]);
    expect(everydayAccounts([CHEQUE], [])).toEqual([]);
    expect(everydayAccounts([OLD_CARD], rows('fnb|2000', 5, '2020-01-01').concat(rows('fnb|9986', 1)))).toEqual([]);
  });
});

describe('everydayFlow', () => {
  const processed = (cycles, currentMonth) => ({
    months: Object.keys(cycles),
    currentMonth,
    totalsByMonth: {
      Income: Object.fromEntries(Object.entries(cycles).map(([m, [i]]) => [m, i])),
      Expense: Object.fromEntries(Object.entries(cycles).map(([m, [, s]]) => [m, -s])),
    },
  });

  it('says short when finished cycles spend more than they take in, by the median', () => {
    const flow = everydayFlow(processed({ '2026-05': [90, 100], '2026-06': [90, 102], '2026-07': [90, 98], '2026-08': [360, 100], '2026-09': [90, 101], '2026-10': [20, 40] }, '2026-10'));
    expect(flow.verdict).toBe('short');
    expect(flow.typical).toEqual({ income: 90, spend: 100, net: -10 });
    expect(flow.cycles).toBe(5);
    expect(flow.shortCycles).toBe(4);
    expect(flow.rows.at(-1)).toMatchObject({ month: '2026-10', partial: true, net: -20 });
  });

  it('says ahead when there is room, and even when there is hardly any difference', () => {
    expect(everydayFlow(processed({ '2026-08': [100, 80], '2026-09': [100, 85], '2026-10': [10, 5] }, '2026-10')).verdict).toBe('ahead');
    expect(everydayFlow(processed({ '2026-08': [100, 100], '2026-09': [100, 101], '2026-10': [10, 5] }, '2026-10')).verdict).toBe('even');
  });

  it('keeps the unfinished cycle out of the typical figures, and reports no verdict when it is all there is', () => {
    const only = everydayFlow(processed({ '2026-10': [100, 20] }, '2026-10'));
    expect(only).toMatchObject({ typical: null, verdict: null, cycles: 0 });
    expect(only.rows).toHaveLength(1);
  });

  it('is null without a result to read', () => {
    expect(everydayFlow(null)).toBeNull();
    expect(everydayFlow({ months: [], totalsByMonth: {} })).toBeNull();
  });

  it('keeps the last six cycles', () => {
    const cycles = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`2026-0${i + 1}`, [100, 90]]));
    expect(everydayFlow(processed(cycles, '2026-09')).rows.map((r) => r.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });
});

describe('netWorthTrend', () => {
  const summary = (nets, extra = {}) => ({
    net: nets.at(-1),
    knownCount: 4,
    complete: true,
    missing: [],
    byMonth: nets.map((net, i) => ({ month: `2026-0${i + 1}`, net })),
    ...extra,
  });

  it('turns the monthly figures into a change per cycle, with the cycle in progress last', () => {
    const t = netWorthTrend(summary([-100, -80, -90, -50, -20]), { currentMonth: '2026-05' });
    expect(t.now).toBe(-20);
    expect(t.rows.map((r) => r.change)).toEqual([20, -10, 40, 30]);
    expect(t.rows.at(-1).partial).toBe(true);
    expect(t.sinceLast).toBe(30);
    expect(t.up).toBe(2);
    expect(t.of).toBe(3);
  });

  it('carries what is missing so the figure is not mistaken for the whole picture', () => {
    const t = netWorthTrend(summary([0, 10, 20], { complete: false, missing: ['Nedbank Loan *2801'] }));
    expect(t.complete).toBe(false);
    expect(t.missing).toEqual(['Nedbank Loan *2801']);
  });

  it('is null when no balance is known or there is only one month', () => {
    expect(netWorthTrend(summary([1, 2], { knownCount: 0 }))).toBeNull();
    expect(netWorthTrend(summary([1]))).toBeNull();
    expect(netWorthTrend(null)).toBeNull();
  });
});
