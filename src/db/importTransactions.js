import { db } from './db';
import { accountIdOf, buildAccountRecord } from './accountIdentity';
import { assignKeys, changedFields } from './txnKey';

/**
 * Append-and-dedupe import.
 *
 * The old behaviour was replacement: the new file became the dataset. Because each export covers a
 * sliding window, that silently deleted whatever had fallen off the front — comparing the 6 August
 * and 21 August files, 66 rows arrived and 67 disappeared, and the 67 were gone for good.
 *
 * Here nothing is ever deleted. Rows that vanish from a later export stay put: absence from a
 * window is not evidence a transaction didn't happen.
 *
 * IMPORTS ARE UNORDERED. Recovering history means importing an OLDER export on top of a newer one,
 * and that has to be safe. So every file carries a vintage — the latest transaction date in it —
 * and an older file may only ADD rows, never revise them. Without that rule, re-importing the
 * 6 August export rolled three settled transactions back to Pending and renamed an account to what
 * it used to be called, because "last write wins" is the wrong rule for data arriving out of order.
 */

/**
 * @param rows     parsed CSV rows (from utils/csv.js), unsaved
 * @param fileName the file they came from, for the import log
 * @returns a summary of what the import actually changed
 */
export async function importTransactions(rows, fileName) {
  if (!rows?.length) {
    return { rowsTotal: 0, added: 0, updated: 0, unchanged: 0, accountsNew: [], accountsRenamed: [] };
  }

  assignKeys(rows);
  const prepared = rows.map((r) => ({
    ...r,
    accountId: accountIdOf(r.Account),
    // Indexable mirrors — see the schema note in db.js.
    payMonth: r['Pay Month'],
    date: r.Date,
  }));

  const dates = prepared.map((r) => r.Date).filter(Boolean).sort();
  const vintage = dates[dates.length - 1] ?? null;
  const summary = {
    fileName,
    importedAt: new Date().toISOString(),
    rowsTotal: prepared.length,
    added: 0,
    updated: 0,
    unchanged: 0,
    superseded: 0,
    dateFrom: dates[0] ?? null,
    dateTo: vintage,
    vintage,
    accountsNew: [],
    accountsRenamed: [],
    updatedExamples: [],
  };

  await db.transaction('rw', db.transactions, db.accounts, db.imports, async () => {
    const existing = await db.transactions.bulkGet(prepared.map((r) => r.key));
    const toAdd = [];
    const toUpdate = [];

    prepared.forEach((row, i) => {
      const stored = existing[i];
      if (!stored) {
        toAdd.push({
          ...row,
          firstSeen: summary.importedAt,
          lastSeen: summary.importedAt,
          observedThrough: vintage,
        });
        return;
      }
      const changed = changedFields(stored, row);
      if (changed.length === 0) {
        summary.unchanged += 1;
        return;
      }
      // This file is older than the one that produced the stored row: it can't know better.
      if (stored.observedThrough && vintage && vintage <= stored.observedThrough) {
        summary.superseded += 1;
        return;
      }
      toUpdate.push({
        ...stored,
        ...row,
        firstSeen: stored.firstSeen,
        lastSeen: summary.importedAt,
        observedThrough: vintage,
      });
      if (summary.updatedExamples.length < 5) {
        summary.updatedExamples.push({
          description: row.Description,
          date: row.Date,
          fields: changed.map((f) => `${f}: ${stored[f] || '—'} → ${row[f] || '—'}`),
        });
      }
    });

    if (toAdd.length) await db.transactions.bulkAdd(toAdd);
    if (toUpdate.length) await db.transactions.bulkPut(toUpdate);
    summary.added = toAdd.length;
    summary.updated = toUpdate.length;

    // Accounts: fold every raw name seen onto its stable id, preserving anything the user set.
    // The file's vintage decides whose name wins, for the same reason as above.
    const namesById = new Map();
    prepared.forEach((r) => {
      if (!namesById.has(r.accountId)) namesById.set(r.accountId, new Set());
      namesById.get(r.accountId).add(r.Account);
    });
    const ids = [...namesById.keys()];
    const stored = await db.accounts.bulkGet(ids);
    const records = ids.map((id, i) => {
      const prior = stored[i] ?? null;
      const record = buildAccountRecord([...namesById.get(id)], prior, vintage);
      if (!prior) summary.accountsNew.push(record.rawName);
      else if (record.rawName !== prior.rawName) {
        summary.accountsRenamed.push(`${prior.rawName} → ${record.rawName}`);
      }
      return record;
    });
    await db.accounts.bulkPut(records);

    const { updatedExamples, ...logged } = summary;
    await db.imports.add({ ...logged, updatedExamples });
  });

  return summary;
}

/**
 * One-time migration from the localStorage blob.
 *
 * Runs only when the database is empty, so a user who has already imported keeps their history
 * even though the old key is still sitting there.
 */
export async function migrateFromLocalStorage(storageKey) {
  const count = await db.transactions.count();
  if (count > 0) return null;
  let saved;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(saved?.data) || saved.data.length === 0) return null;
  const summary = await importTransactions(saved.data, saved.fileName ?? 'previously saved data');
  if (Array.isArray(saved.selectedAccounts) && saved.selectedAccounts.length) {
    await db.settings.put({
      key: 'selectedAccountIds',
      value: [...new Set(saved.selectedAccounts.map(accountIdOf))],
    });
  }
  if (saved.monthRange) await db.settings.put({ key: 'monthRange', value: saved.monthRange });
  return summary;
}
