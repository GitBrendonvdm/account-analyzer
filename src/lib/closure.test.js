import { describe, expect, it } from 'vitest';
import { closurePatch, closureSuggestions, reopenPatch } from './closure';

const acct = (id, type, extra = {}) => ({ id, bank: id.split('|')[0], mask: id.split('|')[1], type, rawName: `${id} ${type}`, ...extra });
const row = (Date, Account, AmountNum, Description = 'x') => ({ Date, Account, AmountNum, Description });

const CHEQUE = acct('fnb|9986', 'Bank');
const CHEQUE_NAME = 'FNB Bank *9986';
const CAR = acct('fnb|4081', 'Loan', { rawName: 'FNB Loan *4081' });
const OLD_CARD = acct('nedbank|4714', 'Credit Card', { rawName: 'Nedbank Credit Card *4714' });
const SAVINGS = acct('nedbank|1825', 'Savings', { rawName: 'Nedbank Savings *1825', currentBalance: 8000 });

const STORED = [
  row('2026-10-15', CHEQUE_NAME, -100),
  row('2026-10-15', CHEQUE_NAME, -63726.77, '1sa Car Payoff Vodsbsw8lb3q'),
  row('2026-10-14', CHEQUE_NAME, -500, 'Pnp'),
  row('2026-07-27', 'FNB Loan *4081', 4990.67, 'Dc Debit Order'),
  row('2026-08-22', 'Nedbank Credit Card *4714', -50, 'Spar'),
  row('2026-08-04', 'Nedbank Savings *1825', -50, 'Spar'),
];

describe('closureSuggestions', () => {
  it('suggests a loan paid off when a payment out of another account meets what it was estimated to owe', () => {
    const out = closureSuggestions({
      accounts: [CHEQUE, CAR],
      stored: STORED,
      inferred: [{ accountId: 'fnb|4081', owed: 64860, payments: 2 }],
    });
    expect(out).toEqual([
      expect.objectContaining({ accountId: 'fnb|4081', kind: 'paid-off', closedOn: '2026-10-15' }),
    ]);
    expect(out[0].evidence).toMatchObject({ amount: 63726.77 });
  });

  it('does not take a payment that is the wrong size for it', () => {
    const out = closureSuggestions({
      accounts: [CHEQUE, CAR],
      stored: STORED,
      inferred: [{ accountId: 'fnb|4081', owed: 150000, payments: 2 }],
    });
    expect(out.find((s) => s.kind === 'paid-off')).toBeUndefined();
  });

  it('suggests an account that went quiet, but not one that holds money or is still being paid', () => {
    const out = closureSuggestions({ accounts: [CHEQUE, OLD_CARD, SAVINGS, CAR], stored: STORED, inferred: [{ accountId: 'fnb|4081', owed: 1, payments: 2 }] });
    expect(out.map((s) => [s.accountId, s.kind])).toEqual([['nedbank|4714', 'idle']]);
    expect(out[0].closedOn).toBe('2026-08-22');
  });

  it('leaves alone what is dismissed, closed or external', () => {
    const accounts = [OLD_CARD, { ...SAVINGS, currentBalance: null, closedOn: '2026-08-04' }, acct('ext|x', 'Savings', { external: true })];
    expect(closureSuggestions({ accounts, stored: STORED, dismissed: ['nedbank|4714'] })).toEqual([]);
  });

  it('says nothing about an empty file', () => {
    expect(closureSuggestions({ accounts: [OLD_CARD], stored: [] })).toEqual([]);
  });
});

describe('patches', () => {
  it('closing says nothing is held from that day; reopening forgets the false zero', () => {
    expect(closurePatch('2026-10-15')).toEqual({ closedOn: '2026-10-15', currentBalance: 0, balanceAsOf: '2026-10-15', source: 'manual' });
    expect(reopenPatch()).toEqual({ closedOn: null, currentBalance: null, balanceAsOf: null });
  });
});
