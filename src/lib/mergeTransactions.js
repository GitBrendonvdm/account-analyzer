import { assignKeys, changedFields } from '../db/txnKey';
import { accountIdOf } from './accounts';

/**
 * The merge rules, with no storage attached.
 *
 * Two things import exports: the browser, into IndexedDB, and the ingest watcher, into a master
 * CSV on disk. They have to agree exactly — a watcher that deduped differently from the app would
 * quietly produce a file the app then re-imported as thousands of new rows. So the rules live here
 * and both callers use them.
 *
 * The rules, in full:
 *
 *   1. Identity is date + account + amount + description, with exact duplicates within one file
 *      numbered in order (see txnKey.js). Accounts reduce to bank+mask, so a renamed account
 *      doesn't duplicate its history.
 *   2. Nothing is ever removed. An export covers a sliding window; a row's absence from a later
 *      file is not evidence it didn't happen.
 *   3. A file carries a vintage — its latest transaction date. Only a file at least as new as the
 *      one that last wrote a row may revise it. Without this, importing an older export to recover
 *      history rolls settled transactions back to Pending.
 */

/** The latest transaction date in a batch — the file's vintage. */
export function vintageOf(rows) {
  let latest = null;
  rows.forEach((r) => {
    if (r.Date && (!latest || r.Date > latest)) latest = r.Date;
  });
  return latest;
}

/**
 * @param stored   rows already held, each carrying `key` and `observedThrough`
 * @param incoming freshly parsed rows from one export
 * @returns the merged set plus a breakdown of what changed
 */
export function mergeTransactions(stored, incoming) {
  const vintage = vintageOf(incoming);
  assignKeys(incoming);

  const byKey = new Map(stored.map((r) => [r.key, r]));
  const added = [];
  const updated = [];
  let unchanged = 0;
  let superseded = 0;

  incoming.forEach((raw) => {
    const row = {
      ...raw,
      accountId: accountIdOf(raw.Account),
      payMonth: raw['Pay Month'],
      date: raw.Date,
    };
    const existing = byKey.get(row.key);

    if (!existing) {
      const fresh = { ...row, observedThrough: vintage };
      byKey.set(row.key, fresh);
      added.push(fresh);
      return;
    }

    const changed = changedFields(existing, row);
    if (changed.length === 0) {
      unchanged += 1;
      return;
    }
    if (existing.observedThrough && vintage && vintage <= existing.observedThrough) {
      superseded += 1;
      return;
    }
    const merged = { ...existing, ...row, observedThrough: vintage };
    byKey.set(row.key, merged);
    updated.push({ row: merged, changed, before: existing });
  });

  const rows = [...byKey.values()].sort((a, b) =>
    a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : a.key < b.key ? -1 : 1,
  );

  return {
    rows,
    added,
    updated,
    unchanged,
    superseded,
    vintage,
    counts: {
      total: incoming.length,
      added: added.length,
      updated: updated.length,
      unchanged,
      superseded,
      held: rows.length,
    },
  };
}
