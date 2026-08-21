import Dexie from 'dexie';

/**
 * Local store for everything the app knows.
 *
 * Two reasons this exists, and neither is size. First, each export covers a SLIDING window: the
 * 21 August file begins three weeks later than the 6 August one, so 67 rows of history fell off
 * the front. Replacing a blob in localStorage on every upload quietly destroyed them. Imports here
 * only ever add.
 *
 * Second, everything the user authors — opening balances, budgets, goals, account names, category
 * corrections — has to outlive the next import. In the old model there was nowhere to put it that
 * an upload wouldn't overwrite.
 *
 * Everything stays on the device. No server, no sync, no account.
 */
export const db = new Dexie('money-visualizer');

// IndexedDB key paths have to be valid property paths, so the export's own column names — "Pay
// Month", "Spending Group" — can't be indexed as they stand. Rows carry lowercase mirrors of the
// two fields worth indexing; the original columns are kept untouched for the pipeline to read.
db.version(1).stores({
  // key = date|account|cents|description(|#n for exact duplicates) — see txnKey.js
  transactions: 'key, payMonth, date, accountId, Category, importId',
  // id = bank|mask, stable across the export renaming an account's type
  accounts: 'id, type',
  imports: '++id, importedAt',
  // Per-category spending targets. scope is a Pay Month key, or 'default' for the standing target.
  budgets: '[scope+category], scope, category',
  goals: '++id, createdAt',
  settings: 'key',
});

/**
 * Opening the database can fail outright if a previous build wrote an invalid schema. There is
 * nothing to preserve in that case — every transaction can be re-imported from the CSV — so the
 * broken store is dropped rather than leaving the app permanently unable to start.
 */
export async function openDatabase() {
  try {
    await db.open();
    return { ok: true };
  } catch (err) {
    if (err?.name === 'DatabaseClosedError' || err?.name === 'VersionError' || err?.name === 'SyntaxError') {
      await db.delete();
      await db.open();
      return { ok: true, recovered: true };
    }
    throw err;
  }
}

/** Simple key/value for UI state that used to live in localStorage. */
export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : row.value;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

export async function getSettings(keys) {
  const rows = await db.settings.bulkGet(keys);
  return Object.fromEntries(keys.map((k, i) => [k, rows[i]?.value]));
}

/**
 * Everything, ordered oldest first — the shape the rest of the app already expects.
 *
 * `Account` is rewritten to the account's canonical raw name so that a mid-history rename
 * ("FNB Savings *9547" → "FNB Bank *9547") reads as one account everywhere downstream. It stays a
 * RAW name rather than the user's own label, because `parseAccount` reads the type out of it and a
 * label like "Main cheque" would strip a loan of its loan-ness — and with it the rule that keeps
 * loan-internal interest out of the flows.
 */
export async function loadAllTransactions(accounts) {
  const rows = await db.transactions.toArray();
  const canonical = new Map((accounts ?? []).map((a) => [a.id, a.rawName]));
  rows.sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
  // The pipeline indexes rows by `id` in several places (transfer pairing, exception clusters).
  // Assign them here, once, so those lookups stay integer-keyed and cheap.
  rows.forEach((r, i) => {
    r.id = i;
    r.Account = canonical.get(r.accountId) ?? r.Account;
  });
  return rows;
}

export async function listAccounts() {
  return db.accounts.orderBy('id').toArray();
}

export async function listImports() {
  return db.imports.orderBy('importedAt').reverse().toArray();
}

/** Wipe everything. Used by the "start over" control; deliberately explicit. */
export async function clearAllData() {
  await db.transaction('rw', db.transactions, db.accounts, db.imports, db.budgets, db.goals, db.settings, async () => {
    await Promise.all([
      db.transactions.clear(),
      db.accounts.clear(),
      db.imports.clear(),
      db.budgets.clear(),
      db.goals.clear(),
      db.settings.clear(),
    ]);
  });
}
