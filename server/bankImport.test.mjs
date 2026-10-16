import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importRows } from './importer.mjs';
import { countTransactions, dataVersion, getAccount, listAccounts, listTransactions } from './db/data.mjs';
import { historyTextFor } from '../src/lib/reconcile.js';
import { clone, createHarness, row } from './test/harness.mjs';

/**
 * FNB's own history files, through the real route and a real (in-memory) Postgres.
 *
 * The fixtures are invented but shaped like the files: newest first, a running balance, the odd
 * line that never moved the balance. What is being protected is the app's central promise —
 * importing is safe to repeat and safe to do in any order — now that two different sources
 * describe the same transactions in different words.
 */

function history({ number, name, balance, available = balance, lines }) {
  const body = lines.map(([date, amount, running, description]) => `${date}, ${amount.toFixed(2)}, ${running.toFixed(2)}, ${description}`);
  return [
    'ACCOUNT TRANSACTION HISTORY',
    '',
    'Name:, A, Person',
    `Account:, ${number}, [${name}]`,
    `Balance:, ${balance.toFixed(2)}, ${available.toFixed(2)}`,
    '',
    'Date, Amount, Balance, Description',
    ...body,
    '',
  ].join('\n');
}

// Two windows onto one cheque account: the short one is the tail of the long one.
const CHEQUE_LONG = history({
  number: '62500009986',
  name: 'FNB Gold Cheque Account',
  balance: 700,
  available: 5700,
  lines: [
    ['2026/10/10', -300, 700, 'SPAR BRACKENFELL'],
    ['2026/10/09', 100, 1000, 'EDO ATTEMPT'], // never moved the balance
    ['2026/10/09', -250, 1000, 'MONTHLY ACCOUNT FEE'],
    ['2026/10/05', -50, 1250, 'MONTHLY CREDIT FEE'],
    ['2026/10/05', -50, 1300, 'MONTHLY CREDIT FEE'],
    ['2026/09/30', 1350, 1350, 'SALARY ACME'],
  ],
});
const CHEQUE_SHORT = history({
  number: '62500009986',
  name: 'FNB Gold Cheque Account',
  balance: 700,
  available: 5700,
  lines: [
    ['2026/10/10', -300, 700, 'SPAR BRACKENFELL'],
    ['2026/10/09', 100, 1000, 'EDO ATTEMPT'],
    ['2026/10/09', -250, 1000, 'MONTHLY ACCOUNT FEE'],
  ],
});
const REVOLVING = history({
  number: '63200007586',
  name: 'FNB Revolving Facility',
  balance: -5000,
  available: 0,
  lines: [
    ['2026/10/10', -4000, -5000, 'TRANSFER'],
    ['2026/10/10', -1000, -1000, '#RF INITIATION FEE'],
  ],
});
const EBUCKS = history({
  number: '80100008452',
  name: 'eBucks Account',
  balance: 0,
  lines: [['2026/10/10', -4750, 0, 'Pay in eB - MONTHLYACCOUNTFEE']],
});

describe('POST /api/import/bank', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
  });
  afterEach(() => h.close());

  const send = async (...texts) => {
    const r = await h.call('POST', '/api/import/bank', {
      files: texts.map((text, i) => ({ name: `file${i}.csv`, from: `file${i}.zip`, text })),
    });
    if (r.statusCode !== 200) throw new Error(`${r.statusCode} ${r.body}`);
    return r.json();
  };
  const held = async () => listTransactions(h.store, await listAccounts(h.store));

  it('creates accounts, adds lines, and states the balance', async () => {
    const out = await send(CHEQUE_LONG, REVOLVING);
    expect(out.added).toBe(7); // 5 cheque lines (the EDO attempt is set aside) + 2 revolving
    expect(out.accountsNew.sort()).toEqual(['FNB Bank *9986', 'FNB Loan *7586']);
    const cheque = await getAccount(h.store, 'fnb|9986');
    expect(cheque).toMatchObject({ currentBalance: 700, balanceAsOf: '2026-10-10', source: 'history', overdraftLimit: 5000 });
    const loan = await getAccount(h.store, 'fnb|7586');
    expect(loan).toMatchObject({ currentBalance: -5000, type: 'Loan', isLiability: true });
    expect((await held()).some((t) => /edo attempt/i.test(t.Description))).toBe(false);
  });

  it('is safe to repeat: the same files change nothing, not even the data version', async () => {
    await send(CHEQUE_LONG, REVOLVING);
    const before = await dataVersion(h.store);
    const count = await countTransactions(h.store);
    const again = await send(CHEQUE_LONG, REVOLVING);
    expect(again.added).toBe(0);
    expect(await countTransactions(h.store)).toBe(count);
    expect(await dataVersion(h.store)).toBe(before);
  });

  it('counts a line once when two windows overlap, and keeps two identical lines as two', async () => {
    const out = await send(CHEQUE_SHORT, CHEQUE_LONG);
    expect(out.added).toBe(5);
    const fees = (await held()).filter((t) => t.Description === 'Monthly Credit Fee');
    expect(fees).toHaveLength(2);
    // And the short window arriving later finds everything it holds already there.
    const later = await send(CHEQUE_SHORT);
    expect(later.added).toBe(0);
    expect(await countTransactions(h.store)).toBe(5);
  });

  it('does not count the aggregator’s copy of a transaction a second time', async () => {
    // The old export's rows: same money, different words, one of them a day out.
    await importRows(
      h.store,
      clone([
        row('2026-10-10', 'Spar Brackenfell 4**8899 *5646', 'FNB Bank *9986', -300),
        row('2026-10-08', 'Monthly Account Fee', 'FNB Bank *9986', -250),
        row('2026-10-05', 'Monthly Credit Fee', 'FNB Bank *9986', -50),
      ]),
      'old.csv',
    );
    const out = await send(CHEQUE_LONG);
    // Spar and the account fee pair off (the fee is a day out). The first credit fee is the very
    // line the old export held, word for word, so it is simply already there; the second is a
    // transaction that really happened twice. The salary is new.
    expect(out.bank.totals.pairedWithOldExport).toBe(2);
    expect(out.bank.totals.alreadyHeld).toBe(1);
    expect(out.added).toBe(2);
    expect(await countTransactions(h.store)).toBe(5);
    // Repeating it changes nothing: the pairing is deterministic.
    const again = await send(CHEQUE_LONG);
    expect(again.added).toBe(0);
    expect(await countTransactions(h.store)).toBe(5);
  });

  it('never overwrites what the reader corrected', async () => {
    await send(CHEQUE_LONG);
    const tx = (await held()).find((t) => t.Description === 'Salary Acme');
    expect(tx).toBeTruthy();
    // Correct it by hand, the way the app's own edit does: straight on the stored row.
    await h.store.query(`update transactions set row = jsonb_set(row, '{Category}', '"Salaries & Wages"') where key = $1`, [tx.key]);
    await send(CHEQUE_LONG);
    expect((await held()).find((t) => t.Description === 'Salary Acme').Category).toBe('Salaries & Wages');
  });

  it('learns categories from what is already held', async () => {
    await importRows(h.store, clone([row('2026-09-02', 'Spar Brackenfell', 'FNB Bank *9986', -80, { Category: 'Groceries' })]), 'old.csv');
    await send(CHEQUE_LONG);
    expect((await held()).find((t) => t.Description === 'Spar Brackenfell' && t.Date === '2026-10-10')?.Category).toBe('Groceries');
  });

  it('leaves eBucks out and says why', async () => {
    const out = await send(EBUCKS, REVOLVING);
    expect(await getAccount(h.store, 'fnb|8452')).toBeNull();
    expect(out.bank.files[0]).toMatchObject({ status: 'skipped' });
    expect(out.bank.files[0].reason).toMatch(/points/);
  });

  it('does not let an older file pull a balance backwards', async () => {
    await send(CHEQUE_LONG);
    const older = history({
      number: '62500009986',
      name: 'FNB Gold Cheque Account',
      balance: 1350,
      lines: [['2026/09/30', 1350, 1350, 'SALARY ACME']],
    });
    await send(older);
    expect((await getAccount(h.store, 'fnb|9986')).currentBalance).toBe(700);
  });

  it('adds only the lines of a statement the app is missing, through the same door', async () => {
    await importRows(
      h.store,
      clone([row('2026-10-10', 'Spar Brackenfell 4**8899 *5646', 'FNB Bank *9986', -300), row('2026-09-30', 'Earlier', 'FNB Bank *9986', 50)]),
      'old.csv',
    );
    const statement = {
      account: { number: '62500009986', name: 'FNB Fusion Private Clients Acc' },
      closing: 700,
    };
    const lines = [
      { date: '2026-10-10', description: 'POS Purchase Spar', amount: -300, balance: 700 }, // held, worded differently
      { date: '2026-10-09', description: '', amount: -25, balance: 1000 }, // the bank's own fee: not held
    ];
    const out = await send(historyTextFor(statement, lines));
    expect(out.bank.totals.pairedWithOldExport).toBe(1);
    expect(out.added).toBe(1);
    const fee = (await held()).find((t) => t.Date === '2026-10-09');
    expect(fee).toMatchObject({ Description: 'Bank charge', AmountNum: -25, Category: 'Bank Charges' });
    expect(await countTransactions(h.store)).toBe(3);
    // And asking again changes nothing.
    expect((await send(historyTextFor(statement, lines))).added).toBe(0);
  });

  it('refuses a request with nothing in it', async () => {
    expect((await h.call('POST', '/api/import/bank', { files: [] })).statusCode).toBe(400);
    expect((await h.call('POST', '/api/import/bank', {})).statusCode).toBe(400);
  });

  it('puts an unrelated csv in its place instead of failing the batch', async () => {
    const out = await send('Date,Description,Account\n1,2,3\n', CHEQUE_LONG);
    expect(out.bank.files[0]).toMatchObject({ status: 'skipped' });
    expect(out.added).toBe(5);
  });
});
