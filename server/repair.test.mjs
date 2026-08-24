import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './test/harness.mjs';

/**
 * The clean-up after a mis-read export, and the guard that stops it happening twice.
 *
 * On 24 August 2026 an export arrived with its columns renamed. The importer of the day read it
 * literally: `pay_month` fell back to an empty string and unparseable account names fell back to
 * `raw|<name>` ids, so four thousand rows landed belonging to no cycle and no account, and the app
 * — which builds its cycles from the pay months in the data — rendered nothing at all.
 */

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'db/migrations/002_repair_unparsed_import.sql'),
  'utf8',
);

const good = (key, month = '2026-08') => ({
  key,
  account_id: 'fnb|9986',
  date: '2026-08-20',
  pay_month: month,
  category: 'Groceries',
  amount_cents: -10999,
  row: JSON.stringify({ key, Date: '2026-08-20', 'Pay Month': month, Account: 'FNB Bank *9986', AmountNum: -109.99 }),
});
const debris = (key) => ({
  key,
  account_id: 'raw|fnb gold cheque account',
  date: '2026-08-20',
  pay_month: '',
  category: 'Transfer',
  amount_cents: 801,
  row: JSON.stringify({ key, Date: '2026-08-20', Account: 'FNB Gold Cheque Account', AmountNum: 8.01 }),
});

describe('repairing what the mis-read export wrote', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  const insert = async (rows) => {
    for (const r of rows) {
      await h.store.query(
        `insert into transactions (key, account_id, date, pay_month, category, amount_cents, row, first_seen, last_seen)
         values ($1,$2,$3,$4,$5,$6,$7, now(), now())`,
        [r.key, r.account_id, r.date, r.pay_month, r.category, r.amount_cents, r.row],
      );
    }
  };
  const count = async (sql) => Number((await h.store.query(sql)).rows[0].n);

  it('removes only the rows that belong to no cycle and no account', async () => {
    await insert([good('a'), good('b'), debris('c'), debris('d')]);
    await h.store.exec(SQL);
    expect(await count('select count(*)::int n from transactions')).toBe(2);
    expect(await count("select count(*)::int n from transactions where account_id like 'raw|%'")).toBe(0);
    const kept = (await h.store.query('select key from transactions order by key')).rows.map((r) => r.key);
    expect(kept).toEqual(['a', 'b']);
  });

  it('leaves a row alone when only one of the two marks is on it', async () => {
    // A real account, but no pay month: not this import's debris, so not this migration's business.
    await insert([{ ...good('e'), pay_month: '' }, { ...debris('f'), pay_month: '2026-08' }]);
    await h.store.exec(SQL);
    expect(await count('select count(*)::int n from transactions')).toBe(2);
  });

  it('removes the accounts that import invented, and keeps the real ones', async () => {
    await h.store.query(
      `insert into accounts (id, record, updated_at) values
        ('fnb|9986', $1, now()), ('raw|fnb gold cheque account', $2, now())`,
      [JSON.stringify({ id: 'fnb|9986', rawName: 'FNB Bank *9986' }), JSON.stringify({ id: 'raw|fnb gold cheque account', rawName: 'FNB Gold Cheque Account' })],
    );
    await insert([good('a'), debris('c')]);
    await h.store.exec(SQL);
    const ids = (await h.store.query('select id from accounts order by id')).rows.map((r) => r.id);
    expect(ids).toEqual(['fnb|9986']);
  });

  it('bumps the data version so a browser reloads instead of showing what was removed', async () => {
    const version = async () => (await h.store.query("select value from meta where key = 'data_version'")).rows[0].value;
    const before = Number(await version());
    await h.store.exec(SQL);
    expect(Number(await version())).toBe(before + 1);
  });
});

describe('refusing a file whose rows belong to no cycle', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
  });
  afterEach(() => h.close());

  it('rejects the import whole rather than storing rows with no pay month', async () => {
    // The 2026 export's own columns, but pretending the app never learned to read them: this is
    // the shape that got through before, and it must not get through again.
    const csv = [
      'Date,Description,Account,Spending Group,Category,Currency,Amount,Type,Status',
      '2026-08-20,Woolworths,FNB Bank *9986,Day-to-day,Groceries,ZAR,-109.99,Expense,Completed',
    ].join('\n');
    const r = await h.call('POST', '/api/import', { fileName: 'no-pay-month.csv', text: csv });
    expect(r.statusCode).toBe(400);
    expect(r.json().error ?? r.json().message).toMatch(/pay month/i);
    const boot = (await h.bootstrap()).body;
    expect(boot.transactions).toHaveLength(0);
  });
});
