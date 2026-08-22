import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, loadAllTransactions, openDatabase } from './db';
import { importTransactions } from './importTransactions';
import { applyAccountPatch, buildAccountRecord } from './accountIdentity';

/**
 * The property that matters: importing exports in any order converges on the same data.
 *
 * Real exports slide — each file starts later than the last, so recovering history means importing
 * an OLD file on top of a NEW one. If that rolls settled transactions back to Pending, or renames
 * an account to what it used to be called, the feature is worse than useless.
 */

function row(date, description, account, amount, extra = {}) {
  return {
    Date: date,
    Description: description,
    Account: account,
    Category: 'Groceries',
    'Spending Group': 'Day-to-day',
    'Pay Month': `${date.slice(0, 7)}`,
    Amount: String(amount),
    AmountNum: amount,
    Type: amount < 0 ? 'Expense' : 'Income',
    Status: 'Completed',
    ...extra,
  };
}

// An older export: starts earlier, ends earlier, and still calls the account "FNB Savings".
const OLDER = [
  row('2026-06-01', 'Checkers', 'FNB Savings *9547', -250),
  row('2026-06-14', 'Spar', 'FNB Bank *9986', -120),
  row('2026-07-02', 'Woolworths', 'FNB Bank *9986', -430, { Status: 'Pending' }),
];

// The newer export: the first row has slid out of the window, the last has settled, and the
// account has been re-labelled by the exporter.
const NEWER = [
  row('2026-06-14', 'Spar', 'FNB Bank *9986', -120),
  row('2026-07-02', 'Woolworths', 'FNB Bank *9986', -430, { Status: 'Completed' }),
  row('2026-07-20', 'Makro', 'FNB Bank *9547', -900),
];

const clone = (rows) => rows.map((r) => ({ ...r }));

async function reset() {
  await db.delete();
  await openDatabase();
}

describe('importTransactions', () => {
  beforeEach(reset);

  it('adds rather than replaces, so a sliding window cannot destroy history', async () => {
    await importTransactions(clone(NEWER), 'newer.csv');
    const second = await importTransactions(clone(OLDER), 'older.csv');

    // The 1 June row exists only in the older file. A replacing import would have lost it.
    expect(second.added).toBe(1);
    expect(await db.transactions.count()).toBe(4);
  });

  it('lets a newer export revise a row that has settled', async () => {
    await importTransactions(clone(OLDER), 'older.csv');
    const second = await importTransactions(clone(NEWER), 'newer.csv');

    expect(second.updated).toBe(1);
    const settled = await db.transactions
      .filter((t) => t.Description === 'Woolworths')
      .first();
    expect(settled.Status).toBe('Completed');
  });

  it('refuses to let an older export un-settle a row', async () => {
    await importTransactions(clone(NEWER), 'newer.csv');
    const second = await importTransactions(clone(OLDER), 'older.csv');

    expect(second.superseded).toBe(1);
    expect(second.updated).toBe(0);
    const settled = await db.transactions.filter((t) => t.Description === 'Woolworths').first();
    expect(settled.Status).toBe('Completed');
  });

  it('converges on the same state whichever order the files arrive in', async () => {
    await importTransactions(clone(NEWER), 'newer.csv');
    await importTransactions(clone(OLDER), 'older.csv');
    const forwards = {
      count: await db.transactions.count(),
      statuses: (await db.transactions.toArray()).map((t) => t.Status).sort(),
      accountName: (await db.accounts.get('fnb|9547')).rawName,
    };

    await reset();
    await importTransactions(clone(OLDER), 'older.csv');
    await importTransactions(clone(NEWER), 'newer.csv');
    const backwards = {
      count: await db.transactions.count(),
      statuses: (await db.transactions.toArray()).map((t) => t.Status).sort(),
      accountName: (await db.accounts.get('fnb|9547')).rawName,
    };

    expect(backwards).toEqual(forwards);
  });

  it('treats a renamed account as one account, keeping the newer name', async () => {
    await importTransactions(clone(OLDER), 'older.csv');
    await importTransactions(clone(NEWER), 'newer.csv');

    const account = await db.accounts.get('fnb|9547');
    expect(account.rawName).toBe('FNB Bank *9547');
    expect(account.seenNames).toEqual(
      expect.arrayContaining(['FNB Savings *9547', 'FNB Bank *9547']),
    );
    expect(await db.accounts.count()).toBe(2);
  });

  it('keeps anything the user authored across an import', async () => {
    await importTransactions(clone(OLDER), 'older.csv');
    await db.accounts.update('fnb|9547', { currentBalance: 1234, label: 'Rainy day' });
    await importTransactions(clone(NEWER), 'newer.csv');

    const account = await db.accounts.get('fnb|9547');
    expect(account.currentBalance).toBe(1234);
    expect(account.label).toBe('Rainy day');
  });

  it('does not collapse two genuinely identical purchases', async () => {
    const twice = [
      row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42),
      row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42),
    ];
    const result = await importTransactions(twice, 'coffee.csv');
    expect(result.added).toBe(2);

    // …but re-importing the same file adds nothing.
    const again = await importTransactions(
      [row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42), row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42)],
      'coffee.csv',
    );
    expect(again.added).toBe(0);
    expect(again.unchanged).toBe(2);
  });

  it('presents a renamed account under one name to the pipeline', async () => {
    await importTransactions(clone(OLDER), 'older.csv');
    await importTransactions(clone(NEWER), 'newer.csv');

    const accounts = await db.accounts.toArray();
    const rows = await loadAllTransactions(accounts);
    const names = [...new Set(rows.map((t) => t.Account))].sort();
    expect(names).toEqual(['FNB Bank *9547', 'FNB Bank *9986']);
  });

  it('round-trips the liability terms and the overdraft through an import', async () => {
    await importTransactions(clone(OLDER), 'older.csv');
    await db.accounts.update('fnb|9547', {
      overdraftLimit: 18298.4,
      termMonths: 12,
      interestRate: 9.33,
      minimumPayment: 5,
      balloon: 25000,
      feesMonthly: 69,
      balanceAsOf: '2026-07-01',
    });
    await importTransactions(clone(NEWER), 'newer.csv');

    const account = await db.accounts.get('fnb|9547');
    expect(account.overdraftLimit).toBe(18298.4);
    expect(account.termMonths).toBe(12);
    expect(account.interestRate).toBe(9.33);
    expect(account.minimumPayment).toBe(5);
    expect(account.balloon).toBe(25000);
    expect(account.feesMonthly).toBe(69);
    expect(account.balanceAsOf).toBe('2026-07-01');
    expect(account.external).toBe(false);
    expect(account.source).toBe('csv');
    expect(account.statementName).toBeNull();
  });
});

describe('buildAccountRecord', () => {
  it('keeps what a statement said about an account once its rows arrive, and stops calling it external', () => {
    const fromStatement = {
      ...buildAccountRecord(['FNB Loan *1143']),
      interestRate: 17.2,
      termMonths: 56,
      currentBalance: -171031.41,
      balanceAsOf: '2026-08-10',
      external: true,
      source: 'statement',
      statementName: 'FNB Personal Loan',
    };
    const next = buildAccountRecord(['FNB Loan *1143'], fromStatement, '2026-08-21');
    expect(next.interestRate).toBe(17.2);
    expect(next.termMonths).toBe(56);
    expect(next.currentBalance).toBe(-171031.41);
    expect(next.balanceAsOf).toBe('2026-08-10');
    expect(next.statementName).toBe('FNB Personal Loan');
    expect(next.source).toBe('statement');
    expect(next.external).toBe(false);
    expect(next.isLiability).toBe(true);
  });

  it('defaults every authored field explicitly on a fresh record', () => {
    const fresh = buildAccountRecord(['Nedbank Credit Card *4714'], null, '2026-08-21');
    expect(fresh).toMatchObject({
      overdraftLimit: null,
      interestRate: null,
      minimumPayment: null,
      termMonths: null,
      balloon: null,
      feesMonthly: null,
      external: false,
      source: 'csv',
      statementName: null,
    });
  });
});

describe('applyAccountPatch', () => {
  it('re-derives the type and liability flag from a type override', () => {
    const next = applyAccountPatch({ type: 'Bank', isLiability: false, label: null }, { typeOverride: 'Loan' });
    expect(next.type).toBe('Loan');
    expect(next.isLiability).toBe(true);
    expect(next.typeOverride).toBe('Loan');
  });

  it('spreads ordinary fields and leaves the type alone without an override', () => {
    const existing = { type: 'Credit Card', isLiability: true, currentBalance: null };
    const next = applyAccountPatch(existing, { currentBalance: -50000, creditLimit: 60000 });
    expect(next).toEqual({ type: 'Credit Card', isLiability: true, currentBalance: -50000, creditLimit: 60000 });
    expect(existing.currentBalance).toBeNull();
    // Clearing the override keeps the record's current type, as the server does.
    expect(applyAccountPatch({ type: 'Loan', typeOverride: 'Loan' }, { typeOverride: null }).type).toBe('Loan');
  });
});
