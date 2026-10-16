import { describe, expect, it } from 'vitest';
import { dormantAccounts, namesOf } from './hiddenAccounts';

const acct = (id, extra = {}) => ({ id, rawName: `${id} name`, ...extra });
const row = (Date, Account) => ({ Date, Account, AmountNum: -1 });

describe('namesOf', () => {
  it('collects every name an account has been exported under', () => {
    const names = namesOf([acct('a|1', { seenNames: ['A Savings *1', 'A Bank *1'] }), acct('b|2')]);
    expect([...names].sort()).toEqual(['A Bank *1', 'A Savings *1', 'b|2 name']);
  });
});

describe('dormantAccounts', () => {
  const named = (bank, mask, extra = {}) => ({ id: `${bank.toLowerCase()}|${mask}`, rawName: `${bank} Bank *${mask}`, ...extra });
  const stored = [
    row('2026-10-15', 'FNB Bank *1'),
    row('2023-12-05', 'Discovery Bank *2'),
    row('2023-12-05', 'Rich Bank *3'),
    row('2026-06-01', 'Quiet Bank *4'),
    row('2021-04-28', 'Closed Bank *5'),
  ];

  it('proposes the account with no activity in over a year that holds nothing', () => {
    const accounts = [
      named('FNB', '1'),
      named('Discovery', '2'),
      { id: 'rich|3', rawName: 'Rich Bank *3', currentBalance: 5000 },
      named('Quiet', '4'),
      { id: 'closed|5', rawName: 'Closed Bank *5', currentBalance: 0, closedOn: '2021-04-28' },
    ];
    expect(dormantAccounts(accounts, stored).map((a) => a.id)).toEqual(['discovery|2', 'closed|5']);
  });

  it('never proposes what is hidden, external or has no rows', () => {
    const accounts = [named('Discovery', '2', { hidden: true }), { id: 'ext|9', rawName: 'Ext', external: true }, named('None', '8')];
    expect(dormantAccounts(accounts, stored)).toEqual([]);
  });

  it('says nothing about an empty file', () => {
    expect(dormantAccounts([named('Discovery', '2')], [])).toEqual([]);
  });
});
