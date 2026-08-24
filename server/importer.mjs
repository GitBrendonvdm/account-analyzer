import { accountIdOf, buildAccountRecord } from '../src/db/accountIdentity.js';
import { assignKeys, changedFields } from '../src/db/txnKey.js';
import {
  accountsById,
  addImport,
  bumpVersion,
  putAccounts,
  transactionsByKey,
  upsertTransactions,
} from './db/data.mjs';

/**
 * The browser's import, run on the server.
 *
 * This is src/db/importTransactions.js with Postgres where Dexie was, and it has to stay that —
 * the rules it applies were hard-won (see that file and lib/mergeTransactions.js): nothing is ever
 * deleted, exact duplicates within a file are numbered rather than collapsed, only the mutable
 * fields of a row may change, and an older file may never revise what a newer one wrote. Every
 * decision is delegated to the same pure modules the browser used, so the two cannot drift; the
 * only thing written here is the plumbing between those decisions and the tables.
 *
 * Everything happens in one transaction. A file that fails halfway leaves no trace, which is what
 * makes "just import it again" a safe instruction.
 */

/**
 * @param store    a connection from adapter.mjs (the transaction is opened here)
 * @param rows     parsed CSV rows (utils/csv.js), unsaved
 * @param fileName the file they came from, for the import log
 * @param meta     what the parser had to do to the file to produce those rows (format, duplicates
 *                 paired off) — carried into the summary so the app can say so rather than quietly
 *                 turning 4 060 lines into 3 254 transactions
 * @returns the same summary the browser's importer produced
 */
export async function importRows(store, rows, fileName, meta = {}) {
  if (!rows?.length) {
    return { rowsTotal: 0, added: 0, updated: 0, unchanged: 0, accountsNew: [], accountsRenamed: [] };
  }

  assignKeys(rows);
  const prepared = rows.map((r) => ({
    ...r,
    accountId: accountIdOf(r.Account),
    payMonth: r['Pay Month'],
    date: r.Date,
  }));

  const dates = prepared.map((r) => r.Date).filter(Boolean).sort();
  const vintage = dates[dates.length - 1] ?? null;
  const summary = {
    fileName,
    importedAt: new Date().toISOString(),
    format: meta.format ?? 'legacy',
    duplicatesIgnored: meta.duplicatesIgnored ?? 0,
    repeatsCollapsed: meta.repeatsCollapsed ?? 0,
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

  await store.transaction(async (tx) => {
    const existing = await transactionsByKey(tx, prepared.map((r) => r.key));
    const toAdd = [];
    const toUpdate = [];

    prepared.forEach((row) => {
      const stored = existing.get(row.key);
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
    const stored = await accountsById(tx, ids);
    const records = ids.map((id) => {
      const prior = stored.get(id) ?? null;
      // Spread the prior record underneath: fields the server added since the browser's schema
      // (overdraftLimit, interestRate, the statement-sourced ones) are not buildAccountRecord's
      // to know about, and must not vanish on the next import. An account created by hand that
      // now has transactions behind it stops being external — its history anchors it from here.
      const record = { ...prior, ...buildAccountRecord([...namesById.get(id)], prior, vintage) };
      if (prior?.external) record.external = false;
      if (!prior) summary.accountsNew.push(record.rawName);
      else if (record.rawName !== prior.rawName) {
        summary.accountsRenamed.push(`${prior.rawName} → ${record.rawName}`);
      }
      return record;
    });

    // The import row is written first so the transactions can point back at it.
    const importId = await addImport(tx, summary);
    if (toAdd.length || toUpdate.length) await upsertTransactions(tx, [...toAdd, ...toUpdate], importId);
    await putAccounts(tx, records);
    // Re-importing a file that changes nothing is a no-op for the data, so the ETag holds.
    if (toAdd.length || toUpdate.length || summary.accountsNew.length || summary.accountsRenamed.length) {
      await bumpVersion(tx);
    }
  });

  return summary;
}
