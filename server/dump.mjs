import {
  accountsById,
  addGoal,
  addImport,
  bumpVersion,
  findGoal,
  hasImport,
  putAccounts,
  putBudget,
  putSetting,
  transactionsByKey,
  upsertTransactions,
} from './db/data.mjs';

/**
 * Moving a browser's data onto the server, once, safely.
 *
 * Until now everything lived in IndexedDB, one copy per browser. The first visit from a browser
 * that still holds rows offers to move them up, and what arrives is the six Dexie tables exactly
 * as stored. Two things make this merge rather than a copy: the user may have imported on the
 * server already from another browser, and the button may be pressed twice. So every table is
 * reconciled rather than appended — posting the same dump again changes nothing.
 *
 * Transactions keep whichever side has seen the row more recently (observedThrough), the server
 * winning ties; accounts keep every user-authored field from either side, the incoming value
 * filling wherever the server had nothing; imports are logged once per file-and-time; the rest
 * are straight upserts.
 */

/** User-authored account fields — the ones that only exist because someone typed them. */
const AUTHORED = ['currentBalance', 'balanceAsOf', 'creditLimit', 'label', 'typeOverride', 'hidden'];

const LIABILITY = new Set(['Credit Card', 'Loan']);

function later(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

export function mergeAccountRecords(server, incoming) {
  // Whichever side has the newer sighting names the account; every name either side saw is kept.
  const serverNewer = !!server.seenThrough && (!incoming.seenThrough || server.seenThrough >= incoming.seenThrough);
  const lead = serverNewer ? server : incoming;
  const merged = {
    ...incoming,
    ...server,
    rawName: lead.rawName ?? server.rawName ?? incoming.rawName,
    bank: lead.bank ?? server.bank,
    mask: lead.mask ?? server.mask,
    seenNames: [...new Set([...(server.seenNames ?? []), ...(incoming.seenNames ?? [])])],
    seenThrough: later(server.seenThrough, incoming.seenThrough),
  };
  AUTHORED.forEach((f) => {
    const mine = server[f];
    const theirs = incoming[f];
    const unset = mine == null || (f === 'hidden' && mine === false);
    if (unset && theirs != null) merged[f] = theirs;
  });
  // Type follows the override when one is present, and the export's reading of the newer name
  // otherwise — the same rule buildAccountRecord applies.
  const baseType = merged.typeOverride ?? lead.type ?? server.type ?? incoming.type;
  merged.type = baseType;
  merged.isLiability = LIABILITY.has(baseType);
  return merged;
}

export async function mergeDump(store, dump) {
  const counts = {
    transactions: { inserted: 0, updated: 0, kept: 0 },
    accounts: { inserted: 0, merged: 0 },
    imports: { inserted: 0, skipped: 0 },
    budgets: 0,
    goals: { inserted: 0, existing: 0 },
    settings: 0,
  };

  await store.transaction(async (tx) => {
    let changed = false;

    const incomingRows = Array.isArray(dump.transactions) ? dump.transactions.filter((r) => r?.key) : [];
    if (incomingRows.length) {
      const held = await transactionsByKey(tx, incomingRows.map((r) => r.key));
      const toWrite = [];
      const seen = new Set();
      incomingRows.forEach((row) => {
        if (seen.has(row.key)) return;
        seen.add(row.key);
        const mine = held.get(row.key);
        if (!mine) {
          toWrite.push(row);
          counts.transactions.inserted += 1;
          return;
        }
        const theirs = row.observedThrough ?? null;
        if (theirs && (!mine.observedThrough || theirs > mine.observedThrough)) {
          toWrite.push({ ...mine, ...row, firstSeen: mine.firstSeen ?? row.firstSeen });
          counts.transactions.updated += 1;
        } else {
          counts.transactions.kept += 1;
        }
      });
      if (toWrite.length) {
        await upsertTransactions(tx, toWrite, null);
        changed = true;
      }
    }

    const incomingAccounts = Array.isArray(dump.accounts) ? dump.accounts.filter((a) => a?.id) : [];
    if (incomingAccounts.length) {
      const held = await accountsById(tx, incomingAccounts.map((a) => a.id));
      const fresh = [];
      const merged = [];
      incomingAccounts.forEach((record) => {
        const mine = held.get(record.id);
        if (!mine) fresh.push(record);
        else merged.push(mergeAccountRecords(mine, record));
      });
      // putAccounts writes only what differs (jsonb compares by content, not key order), so its
      // count is the honest number of records the dump actually changed.
      counts.accounts.inserted = await putAccounts(tx, fresh);
      counts.accounts.merged = await putAccounts(tx, merged);
      if (counts.accounts.inserted || counts.accounts.merged) changed = true;
    }

    for (const entry of Array.isArray(dump.imports) ? dump.imports : []) {
      if (!entry) continue;
      const { id: _ignored, ...summary } = entry;
      if (await hasImport(tx, summary.fileName, summary.importedAt)) {
        counts.imports.skipped += 1;
        continue;
      }
      await addImport(tx, { ...summary, importedAt: summary.importedAt ?? new Date().toISOString() });
      counts.imports.inserted += 1;
      changed = true;
    }

    for (const b of Array.isArray(dump.budgets) ? dump.budgets : []) {
      if (!b?.scope || !b?.category || !Number.isFinite(Number(b.amount))) continue;
      if (await putBudget(tx, b.scope, b.category, Number(b.amount))) changed = true;
      counts.budgets += 1;
    }

    for (const g of Array.isArray(dump.goals) ? dump.goals : []) {
      if (!g) continue;
      const { id: _ignored, ...goal } = g;
      if (!goal.createdAt) goal.createdAt = new Date().toISOString();
      if (await findGoal(tx, goal.createdAt, goal.name)) {
        counts.goals.existing += 1;
        continue;
      }
      await addGoal(tx, goal);
      counts.goals.inserted += 1;
      changed = true;
    }

    for (const s of Array.isArray(dump.settings) ? dump.settings : []) {
      if (!s?.key) continue;
      if (await putSetting(tx, s.key, s.value)) changed = true;
      counts.settings += 1;
    }

    if (changed) await bumpVersion(tx);
  });

  return counts;
}
