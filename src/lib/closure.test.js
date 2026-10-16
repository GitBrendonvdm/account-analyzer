import { describe, expect, it } from 'vitest';
import { closureSuggestions, settlementFor } from './closure';

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

describe('settlementFor', () => {
  const NEDBANK_CARD = 'Nedbank Credit Card *4714';
  const rows = (...amounts) => amounts.map((a, i) => row(`2026-0${i + 1}-10`, NEDBANK_CARD, a, 'x'));
  const monthOf = () => '2026-10';

  it('pays a debt off: what the rows add up to, the other way round, filed as a movement', () => {
    const s = settlementFor({ account: OLD_CARD, data: rows(-1000, -250), closedOn: '2026-10-15', payMonthOf: monthOf });
    expect(s).toEqual({
      amount: 1250,
      description: 'Paid off — recorded when the account was closed',
      category: 'Credit Card Repayment',
      group: 'Transfer',
      payMonth: '2026-10',
    });
  });

  it('takes money held out of a cheque or savings account', () => {
    const account = acct('nedbank|1825', 'Savings', { rawName: 'Nedbank Savings *1825' });
    const data = [row('2026-01-10', 'Nedbank Savings *1825', 500), row('2026-02-10', 'Nedbank Savings *1825', 300)];
    const s = settlementFor({ account, data, closedOn: '2026-10-15', payMonthOf: monthOf });
    expect(s).toMatchObject({ amount: -800, category: 'Transfer', group: 'Transfer' });
  });

  it('works from the stated balance when there is one, so the account ends at nothing either way', () => {
    // The rows add up to −1 250 but the account was typed as owing 1 300 on the 15th of Feb.
    const account = { ...OLD_CARD, currentBalance: -1300, balanceAsOf: '2026-02-15' };
    const s = settlementFor({ account, data: rows(-1000, -250), closedOn: '2026-10-15', payMonthOf: monthOf });
    expect(s.amount).toBe(1300);
  });

  it('files a loan payoff under the loan’s own category', () => {
    const account = acct('fnb|4081', 'Loan', { rawName: 'FNB Loan *4081' });
    const data = [
      row('2026-01-25', 'FNB Loan *4081', -70000, 'Disbursement'),
      row('2026-02-25', 'FNB Loan *4081', 4990.67, 'Dc'),
      { ...row('2026-03-25', 'FNB Loan *4081', 4990.67, 'Dc'), Category: 'Vehicle Loan / Car Loan' },
      { ...row('2026-04-25', 'FNB Loan *4081', 4990.67, 'Dc'), Category: 'Vehicle Loan / Car Loan' },
    ];
    const s = settlementFor({ account, data, closedOn: '2026-10-15', payMonthOf: monthOf });
    expect(s).toMatchObject({ category: 'Vehicle Loan / Car Loan', group: 'Debt' });
    expect(s.amount).toBeCloseTo(70000 - 3 * 4990.67, 2);
  });

  it('sizes a loan that was exported mid-life from what the engine says is owed, not from its ledger', () => {
    // This ledger only adds up to what has been repaid since the export began: positive, and not a debt.
    const account = acct('fnb|4081', 'Loan', { rawName: 'FNB Loan *4081' });
    const data = [row('2026-01-25', 'FNB Loan *4081', 4990.67), row('2026-02-25', 'FNB Loan *4081', 4990.67)];
    expect(settlementFor({ account, data, closedOn: '2026-10-15', payMonthOf: monthOf }).amount).toBe(-9981.34); // the ledger's answer: wrong
    const s = settlementFor({ account, data, closedOn: '2026-10-15', payMonthOf: monthOf, owed: 64938.12 });
    expect(s).toMatchObject({ amount: 64938.12, group: 'Debt' });
  });

  it('records nothing for an account that is already at nothing, and replaces rather than stacks an old settlement', () => {
    expect(settlementFor({ account: OLD_CARD, data: rows(-1000, 1000), closedOn: '2026-10-15', payMonthOf: monthOf })).toBeNull();
    const closed = { ...OLD_CARD, closedOn: '2026-09-01', currentBalance: 0, balanceAsOf: '2026-09-01', preClosure: { currentBalance: null, balanceAsOf: null } };
    const data = [...rows(-1000, -250), { ...row('2026-09-01', NEDBANK_CARD, 1250), Source: 'settlement' }];
    expect(settlementFor({ account: closed, data, closedOn: '2026-10-15', payMonthOf: monthOf }).amount).toBe(1250);
  });
});
