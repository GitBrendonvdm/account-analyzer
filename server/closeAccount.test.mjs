import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importRows } from './importer.mjs';
import { countTransactions, getAccount, listAccounts, listTransactions } from './db/data.mjs';
import { clone, createHarness, row } from './test/harness.mjs';

/**
 * Closing an account writes the row that takes it to nothing, and says what it said before so that
 * reopening can put it back. All or nothing, and the row is the one kind the app may delete again.
 */

const ROWS = [
  row('2026-07-01', 'Spar', 'Nedbank Credit Card *4714', -1000),
  row('2026-08-01', 'Pharmacy', 'Nedbank Credit Card *4714', -250),
  row('2026-08-02', 'Spar', 'FNB Bank *9986', -100),
];
const SETTLEMENT = {
  amount: 1250,
  description: 'Settled — balance cleared when the account was closed',
  category: 'Credit Card Repayment',
  group: 'Transfer',
  payMonth: '2026-10',
};
const ID = 'nedbank|4714';

describe('closing and reopening an account', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
    await importRows(h.store, clone(ROWS), 'file.csv');
    // The account has a balance somebody typed, which closing must remember.
    await h.call('PATCH', `/api/accounts/${encodeURIComponent(ID)}`, { patch: { currentBalance: -1250, balanceAsOf: '2026-08-01', source: 'manual' } });
  });
  afterEach(() => h.close());

  const stored = async () => listTransactions(h.store, await listAccounts(h.store));
  const close = (body, id = ID) => h.call('POST', `/api/accounts/${encodeURIComponent(id)}/close`, body);

  it('writes the settlement, closes the account at nothing, and remembers what it said before', async () => {
    const r = await close({ closedOn: '2026-10-15', settlement: SETTLEMENT });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      closedOn: '2026-10-15',
      currentBalance: 0,
      balanceAsOf: '2026-10-15',
      preClosure: { currentBalance: -1250, balanceAsOf: '2026-08-01', source: 'manual' },
    });
    const row = (await stored()).find((t) => t.Source === 'settlement');
    expect(row).toMatchObject({
      Date: '2026-10-15',
      AmountNum: 1250,
      Account: 'Nedbank Credit Card *4714',
      Category: 'Credit Card Repayment',
      'Spending Group': 'Transfer',
      'Pay Month': '2026-10',
      Type: 'Income',
    });
    expect(await countTransactions(h.store)).toBe(4);
  });

  it('closing again moves the date and replaces the row; it does not stack another or forget the original balance', async () => {
    await close({ closedOn: '2026-10-15', settlement: SETTLEMENT });
    const again = await close({ closedOn: '2026-09-30', settlement: { ...SETTLEMENT, payMonth: '2026-10' } });
    expect(again.json().preClosure).toMatchObject({ currentBalance: -1250 });
    expect(await countTransactions(h.store)).toBe(4);
    expect((await stored()).find((t) => t.Source === 'settlement').Date).toBe('2026-09-30');
  });

  it('closes an account that is already at nothing without writing a row', async () => {
    const r = await close({ closedOn: '2026-10-15', settlement: null });
    expect(r.statusCode).toBe(200);
    expect(await countTransactions(h.store)).toBe(3);
  });

  it('reopening removes the settlement and restores the balance the account had', async () => {
    await close({ closedOn: '2026-10-15', settlement: SETTLEMENT });
    const r = await h.call('POST', `/api/accounts/${encodeURIComponent(ID)}/reopen`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ closedOn: null, currentBalance: -1250, balanceAsOf: '2026-08-01', preClosure: null });
    expect(await countTransactions(h.store)).toBe(3);
    expect((await getAccount(h.store, ID)).closedOn).toBeNull();
  });

  it('an import afterwards does not reopen it', async () => {
    await close({ closedOn: '2026-10-15', settlement: SETTLEMENT });
    await importRows(h.store, clone([row('2026-09-01', 'Late charge', 'Nedbank Credit Card *4714', -10)]), 'later.csv');
    expect(await getAccount(h.store, ID)).toMatchObject({ closedOn: '2026-10-15', currentBalance: 0 });
  });

  it('refuses what it cannot trust, and writes nothing', async () => {
    expect((await close({ closedOn: 'soon', settlement: SETTLEMENT })).statusCode).toBe(400);
    expect((await close({ closedOn: '2026-10-15', settlement: { ...SETTLEMENT, amount: 0 } })).statusCode).toBe(400);
    expect((await close({ closedOn: '2026-10-15', settlement: { ...SETTLEMENT, group: 'Income' } })).statusCode).toBe(400);
    expect((await close({ closedOn: '2026-10-15', settlement: { ...SETTLEMENT, payMonth: 'October' } })).statusCode).toBe(400);
    expect((await close({ closedOn: '2026-10-15', settlement: SETTLEMENT }, 'nobody')).statusCode).toBe(404);
    expect((await h.call('POST', '/api/accounts/nobody/reopen', {})).statusCode).toBe(404);
    expect(await countTransactions(h.store)).toBe(3);
    expect((await getAccount(h.store, ID)).closedOn).toBeFalsy();
  });
});
