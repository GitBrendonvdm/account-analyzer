import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/utils/csv.js';
import { assignKeys } from '../src/db/txnKey.js';
import { importRows } from './importer.mjs';
import { countTransactions, getAccount, listAccounts, listTransactions, transactionsByKey } from './db/data.mjs';
import { clone, createHarness, csvOf, loadRealExports, row } from './test/harness.mjs';

/**
 * The property that matters: importing exports in any order converges on the same data.
 *
 * These are src/db/importTransactions.test.js's scenarios run against the server, with the same
 * expectations — the rules moved, they did not change. The second half runs the two real exports
 * both ways round, which is where the rules were learned in the first place.
 */

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

describe('importRows', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  const rowsNamed = async (description) =>
    (await listTransactions(h.store, await listAccounts(h.store))).filter((t) => t.Description === description);

  it('adds rather than replaces, so a sliding window cannot destroy history', async () => {
    await importRows(h.store, clone(NEWER), 'newer.csv');
    const second = await importRows(h.store, clone(OLDER), 'older.csv');
    expect(second.added).toBe(1);
    expect(await countTransactions(h.store)).toBe(4);
  });

  it('lets a newer export revise a row that has settled', async () => {
    await importRows(h.store, clone(OLDER), 'older.csv');
    const second = await importRows(h.store, clone(NEWER), 'newer.csv');
    expect(second.updated).toBe(1);
    expect((await rowsNamed('Woolworths'))[0].Status).toBe('Completed');
  });

  it('refuses to let an older export un-settle a row', async () => {
    await importRows(h.store, clone(NEWER), 'newer.csv');
    const second = await importRows(h.store, clone(OLDER), 'older.csv');
    expect(second.superseded).toBe(1);
    expect(second.updated).toBe(0);
    expect((await rowsNamed('Woolworths'))[0].Status).toBe('Completed');
  });

  it('converges on the same state whichever order the files arrive in', async () => {
    const snapshot = async () => ({
      count: await countTransactions(h.store),
      statuses: (await listTransactions(h.store, [])).map((t) => t.Status).sort(),
      accountName: (await getAccount(h.store, 'fnb|9547')).rawName,
    });
    await importRows(h.store, clone(NEWER), 'newer.csv');
    await importRows(h.store, clone(OLDER), 'older.csv');
    const forwards = await snapshot();

    await h.close();
    h = await createHarness();
    await importRows(h.store, clone(OLDER), 'older.csv');
    await importRows(h.store, clone(NEWER), 'newer.csv');
    expect(await snapshot()).toEqual(forwards);
  });

  it('treats a renamed account as one account, keeping the newer name', async () => {
    await importRows(h.store, clone(OLDER), 'older.csv');
    await importRows(h.store, clone(NEWER), 'newer.csv');
    const account = await getAccount(h.store, 'fnb|9547');
    expect(account.rawName).toBe('FNB Bank *9547');
    expect(account.seenNames).toEqual(expect.arrayContaining(['FNB Savings *9547', 'FNB Bank *9547']));
    expect(await listAccounts(h.store)).toHaveLength(2);
  });

  it('keeps anything the user authored across an import', async () => {
    await importRows(h.store, clone(OLDER), 'older.csv');
    await h.signIn();
    const patched = await h.call('PATCH', `/api/accounts/${encodeURIComponent('fnb|9547')}`, {
      patch: { currentBalance: 1234, label: 'Rainy day', overdraftLimit: 5000 },
    });
    expect(patched.statusCode).toBe(200);
    await importRows(h.store, clone(NEWER), 'newer.csv');
    const account = await getAccount(h.store, 'fnb|9547');
    expect(account.currentBalance).toBe(1234);
    expect(account.label).toBe('Rainy day');
    // A field the browser's schema never had survives too.
    expect(account.overdraftLimit).toBe(5000);
  });

  it('does not collapse two genuinely identical purchases', async () => {
    const twice = () => [
      row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42),
      row('2026-06-20', 'Flat white', 'FNB Bank *9986', -42),
    ];
    const result = await importRows(h.store, twice(), 'coffee.csv');
    expect(result.added).toBe(2);
    const again = await importRows(h.store, twice(), 'coffee.csv');
    expect(again.added).toBe(0);
    expect(again.unchanged).toBe(2);
  });

  it('presents a renamed account under one name to the pipeline', async () => {
    await importRows(h.store, clone(OLDER), 'older.csv');
    await importRows(h.store, clone(NEWER), 'newer.csv');
    const rows = await listTransactions(h.store, await listAccounts(h.store));
    const names = [...new Set(rows.map((t) => t.Account))].sort();
    expect(names).toEqual(['FNB Bank *9547', 'FNB Bank *9986']);
  });

  it('returns the same summary shape the browser produced', async () => {
    const summary = await importRows(h.store, clone(OLDER), 'older.csv');
    expect(Object.keys(summary).sort()).toEqual(
      ['accountsNew', 'accountsRenamed', 'added', 'dateFrom', 'dateTo', 'duplicatesIgnored', 'fileName', 'format', 'importedAt', 'repeatsCollapsed', 'rowsTotal', 'superseded', 'unchanged', 'updated', 'updatedExamples', 'vintage'],
    );
    expect(summary).toMatchObject({ fileName: 'older.csv', rowsTotal: 3, added: 3, dateFrom: '2026-06-01', dateTo: '2026-07-02', vintage: '2026-07-02' });
    expect(summary.accountsNew.sort()).toEqual(['FNB Bank *9986', 'FNB Savings *9547']);
  });
});

describe('POST /api/import', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
  });
  afterEach(() => h.close());

  it('parses the CSV with the same parser and applies the same rules', async () => {
    const first = await h.call('POST', '/api/import', { fileName: 'older.csv', text: csvOf(OLDER) });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ added: 3, updated: 0, unchanged: 0 });

    const second = await h.call('POST', '/api/import', { fileName: 'newer.csv', text: csvOf(NEWER) });
    expect(second.json()).toMatchObject({ added: 1, updated: 1, unchanged: 1, superseded: 0 });
    expect(second.json().accountsRenamed).toEqual(['FNB Savings *9547 → FNB Bank *9547']);
  });

  it('re-importing the same file adds nothing and leaves the ETag alone', async () => {
    await h.call('POST', '/api/import', { fileName: 'older.csv', text: csvOf(OLDER) });
    const { etag } = await h.bootstrap();

    const again = await h.call('POST', '/api/import', { fileName: 'older.csv', text: csvOf(OLDER) });
    expect(again.json()).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
    const after = await h.bootstrap();
    expect(after.etag).toBe(etag);

    // And a client that already holds that version gets a 304 rather than the rows again.
    const conditional = await h.call('GET', '/api/bootstrap', undefined, { headers: { 'if-none-match': etag } });
    expect(conditional.statusCode).toBe(304);
  });

  it('rejects an empty file clearly', async () => {
    const r = await h.call('POST', '/api/import', { fileName: 'empty.csv', text: 'Date,Amount\n' });
    expect(r.statusCode).toBe(400);
  });
});

const real = loadRealExports();

describe.skipIf(!real)('the real exports (test-data/, gitignored)', () => {
  if (!real) return;
  const [older, newer] = [real[0], real[real.length - 1]];

  async function importBoth(order) {
    const h = await createHarness();
    await h.signIn();
    const summaries = [];
    for (const file of order) {
      const r = await h.call('POST', '/api/import', file);
      expect(r.statusCode).toBe(200);
      summaries.push(r.json());
    }
    return { h, summaries };
  }

  it('converge on the same rows in either order, with nothing rolled back', async () => {
    const forwards = await importBoth([older, newer]);
    const backwards = await importBoth([newer, older]);
    try {
      const countF = await countTransactions(forwards.h.store);
      const countB = await countTransactions(backwards.h.store);
      expect(countF).toBe(countB);

      // What the newer file reports as settled must be settled on the server in both orders.
      const settled = assignKeys(parseCsv(newer.text)).filter((r) => r.Status === 'Completed');
      for (const { h } of [forwards, backwards]) {
        const held = await transactionsByKey(h.store, settled.map((r) => r.key));
        expect(held.size).toBe(settled.length);
        const regressed = settled.filter((r) => held.get(r.key).Status !== 'Completed');
        expect(regressed).toEqual([]);
      }

      // Row accounting agrees between the two orders.
      const [fOld, fNew] = forwards.summaries;
      const [bNew, bOld] = backwards.summaries;
      expect(fOld.added).toBe(fOld.rowsTotal);
      expect(bNew.added).toBe(bNew.rowsTotal);
      expect(fOld.rowsTotal + fNew.added).toBe(bNew.rowsTotal + bOld.added);
      expect(bOld.superseded).toBe(fNew.updated);
      expect(bOld.updated).toBe(0);
    } finally {
      await forwards.h.close();
      await backwards.h.close();
    }
  }, 30000);

  it('keep the renamed account as one account under its newer name', async () => {
    for (const order of [[older, newer], [newer, older]]) {
      const { h } = await importBoth(order);
      try {
        const account = await getAccount(h.store, 'fnb|9547');
        expect(account).toBeTruthy();
        expect(account.rawName).toBe('FNB Bank *9547');
        expect(account.seenNames).toHaveLength(2);
        expect(account.seenNames).toEqual(expect.arrayContaining(['FNB Savings *9547', 'FNB Bank *9547']));
      } finally {
        await h.close();
      }
    }
  }, 30000);
});
