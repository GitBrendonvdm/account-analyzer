import { randomBytes } from 'node:crypto';
import {
  bumpVersion,
  deleteAccount,
  deleteTransactionByKey,
  getAccount,
  putAccounts,
  upsertTransactions,
} from '../db/data.mjs';

/**
 * What the user says about an account, and accounts that exist only because the user said so.
 *
 * PATCH is the browser's updateAccount with the same one rule: a type override is user-
 * authoritative and decides whether the account is a liability. The patch is a whitelist because
 * the record also carries what the importer derived (rawName, seenNames, seenThrough) and a typo
 * in a client must not be able to overwrite those.
 *
 * POST and DELETE exist for accounts with no transactions behind them — a retirement annuity, an
 * emergency fund at another bank, a card whose statements never reach the export. They are marked
 * `external` so a later import cannot be confused about where they came from, and only those can
 * be deleted: an account with history is never removed, because its rows would be orphaned.
 */

const LIABILITY = new Set(['Credit Card', 'Loan']);

const number = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
const integer = (v) => v === null || Number.isInteger(v);
const text = (v) => v === null || typeof v === 'string';
const isoDay = (v) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v));

/** Everything a patch may touch, with what each must look like. `external` is deliberately absent. */
const PATCHABLE = {
  currentBalance: number,
  balanceAsOf: isoDay,
  creditLimit: number,
  overdraftLimit: number,
  label: text,
  typeOverride: text,
  hidden: (v) => typeof v === 'boolean',
  // The day the account was settled or closed: its balance is nothing from then, and nothing more
  // is expected of it. null reopens it.
  closedOn: isoDay,
  interestRate: number,
  minimumPayment: number,
  termMonths: integer,
  balloon: number,
  feesMonthly: number,
  // Where the balance came from, so the UI can say "from your FNB summary, 22 Aug" rather than
  // implying the user typed it.
  source: (v) => v === null || ['csv', 'statement', 'history', 'manual'].includes(v),
  statementName: text,
};

const SOURCES = new Set(['statement', 'manual']);

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'Send { patch }';
  for (const [key, value] of Object.entries(patch)) {
    const check = PATCHABLE[key];
    if (!check) return `"${key}" is not something an account patch may set`;
    if (!check(value)) return `"${key}" has the wrong shape`;
  }
  return null;
}

export function applyPatch(existing, patch) {
  const next = { ...existing, ...patch };
  // Type is user-authoritative once set, and it decides whether the account is a liability.
  if (patch.typeOverride !== undefined) {
    next.type = patch.typeOverride ?? existing.type;
    next.isLiability = LIABILITY.has(next.type);
  }
  return next;
}

/** The key of the one row an account's closing writes. One per account, so closing twice replaces it. */
export const settlementKey = (accountId) => `settlement|${accountId}`;

const GROUPS = new Set(['Transfer', 'Debt']);

/**
 * The row that takes a closed account to exactly nothing, built from a few validated facts rather than
 * from whatever the client sent: the amount, what to call it, the category and group it files under
 * and the cycle it falls in. Everything else about the row is fixed here.
 */
function settlementRow(record, closedOn, s) {
  const amount = Math.round(Number(s.amount) * 100) / 100;
  const now = new Date().toISOString();
  return {
    key: settlementKey(record.id),
    accountId: record.id,
    Date: closedOn,
    date: closedOn,
    Description: s.description,
    Account: record.rawName,
    'Spending Group': s.group,
    Category: s.category,
    'Pay Month': s.payMonth,
    payMonth: s.payMonth,
    'Split Transaction': 'No',
    Currency: 'ZAR',
    Amount: String(amount),
    'Original Currency': '',
    'Original Amount': '',
    Type: amount < 0 ? 'Expense' : 'Income',
    Status: 'Completed',
    Tags: '',
    Notes: '',
    AmountNum: amount,
    // Marks the row as the app's own: it is the one kind of row a reopen may delete.
    Source: 'settlement',
    firstSeen: now,
    lastSeen: now,
    observedThrough: closedOn,
  };
}

function validateSettlement(s) {
  if (s === null || s === undefined) return null;
  if (typeof s !== 'object' || Array.isArray(s)) return 'settlement must be an object or null';
  const amount = Number(s.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1e10) return 'settlement.amount must be a non-zero number';
  if (typeof s.description !== 'string' || !s.description.trim() || s.description.length > 200) return 'settlement.description is required';
  if (typeof s.category !== 'string' || !s.category.trim() || s.category.length > 80) return 'settlement.category is required';
  if (!GROUPS.has(s.group)) return "settlement.group must be 'Transfer' or 'Debt'";
  if (typeof s.payMonth !== 'string' || !/^\d{4}-\d{2}$/.test(s.payMonth)) return 'settlement.payMonth must look like 2026-10';
  return null;
}

export default async function accountRoutes(app) {
  const { store } = app;

  /**
   * Close an account: paid off, or shut. Everything happens together or not at all —
   *   · the row that takes its balance to nothing on that day (when it holds or owes anything),
   *   · the closing date, and a balance of nothing from it,
   *   · what the account stated before, kept so a reopen can put it back.
   * The settlement is what keeps HISTORY honest: without it, anchoring a zero balance on the closing day
   * would re-base every earlier month and make the debt look as if it had never been owed.
   */
  app.post('/accounts/:id/close', async (request, reply) => {
    const { closedOn, settlement } = request.body ?? {};
    if (typeof closedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(closedOn)) {
      return reply.code(400).send({ error: 'Send { closedOn: "YYYY-MM-DD", settlement }' });
    }
    const problem = validateSettlement(settlement);
    if (problem) return reply.code(400).send({ error: problem });
    const record = await store.transaction(async (tx) => {
      const existing = await getAccount(tx, request.params.id);
      if (!existing) return null;
      if (settlement) await upsertTransactions(tx, [settlementRow(existing, closedOn, settlement)]);
      else await deleteTransactionByKey(tx, settlementKey(existing.id));
      const next = {
        ...existing,
        closedOn,
        currentBalance: 0,
        balanceAsOf: closedOn,
        source: 'manual',
        // Closing an account that is already closed (to move the date) keeps the ORIGINAL pre-closure state.
        preClosure: existing.closedOn
          ? (existing.preClosure ?? null)
          : {
              currentBalance: existing.currentBalance ?? null,
              balanceAsOf: existing.balanceAsOf ?? null,
              source: existing.source ?? null,
            },
      };
      await putAccounts(tx, [next]);
      await bumpVersion(tx);
      return next;
    });
    if (!record) return reply.code(404).send({ error: 'No such account' });
    return record;
  });

  /** Undo a closing: the settlement row goes, and the account says again what it said before. */
  app.post('/accounts/:id/reopen', async (request, reply) => {
    const record = await store.transaction(async (tx) => {
      const existing = await getAccount(tx, request.params.id);
      if (!existing) return null;
      await deleteTransactionByKey(tx, settlementKey(existing.id));
      const before = existing.preClosure ?? {};
      const { preClosure: _gone, ...rest } = existing;
      const next = {
        ...rest,
        closedOn: null,
        currentBalance: before.currentBalance ?? null,
        balanceAsOf: before.balanceAsOf ?? null,
        source: before.source ?? existing.source,
        preClosure: null,
      };
      await putAccounts(tx, [next]);
      await bumpVersion(tx);
      return next;
    });
    if (!record) return reply.code(404).send({ error: 'No such account' });
    return record;
  });

  app.patch('/accounts/:id', async (request, reply) => {
    const patch = request.body?.patch;
    const problem = validatePatch(patch);
    if (problem) return reply.code(400).send({ error: problem });
    const record = await store.transaction(async (tx) => {
      const existing = await getAccount(tx, request.params.id);
      if (!existing) return null;
      const next = applyPatch(existing, patch);
      await putAccounts(tx, [next]);
      await bumpVersion(tx);
      return next;
    });
    if (!record) return reply.code(404).send({ error: 'No such account' });
    return record;
  });

  app.post('/accounts', async (request, reply) => {
    const input = request.body?.record;
    if (!input || typeof input !== 'object') return reply.code(400).send({ error: 'Send { record }' });
    if (!SOURCES.has(input.source)) return reply.code(400).send({ error: "source must be 'statement' or 'manual'" });
    const bank = typeof input.bank === 'string' ? input.bank.trim() : '';
    const mask = typeof input.mask === 'string' ? input.mask.trim() : '';
    const type = typeof input.type === 'string' && input.type ? input.type : 'Other';
    const rawName =
      typeof input.rawName === 'string' && input.rawName.trim()
        ? input.rawName.trim()
        : [bank, type, mask ? `*${mask}` : ''].filter(Boolean).join(' ');
    if (!rawName) return reply.code(400).send({ error: 'Give the account a bank and mask, or a rawName' });

    const patchProblem = validatePatch(
      Object.fromEntries(Object.entries(input).filter(([k]) => k in PATCHABLE && k !== 'typeOverride')),
    );
    if (patchProblem) return reply.code(400).send({ error: patchProblem });

    const id = bank && mask ? `${bank.toLowerCase()}|${mask.toLowerCase()}` : `ext|${randomBytes(4).toString('hex')}`;
    const record = {
      id,
      bank,
      type,
      typeOverride: null,
      mask,
      rawName,
      seenNames: [rawName],
      seenThrough: null,
      label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : null,
      isLiability: typeof input.isLiability === 'boolean' ? input.isLiability : LIABILITY.has(type),
      currentBalance: input.currentBalance ?? null,
      balanceAsOf: input.balanceAsOf ?? null,
      creditLimit: input.creditLimit ?? null,
      overdraftLimit: input.overdraftLimit ?? null,
      hidden: input.hidden === true,
      external: true,
      source: input.source,
    };

    const created = await store.transaction(async (tx) => {
      if (await getAccount(tx, id)) return false;
      await putAccounts(tx, [record]);
      await bumpVersion(tx);
      return true;
    });
    if (!created) return reply.code(409).send({ error: `An account with id ${id} already exists` });
    return reply.code(201).send(record);
  });

  app.delete('/accounts/:id', async (request, reply) => {
    const removed = await store.transaction(async (tx) => {
      const existing = await getAccount(tx, request.params.id);
      if (!existing || existing.external !== true) return false;
      await deleteAccount(tx, request.params.id);
      await bumpVersion(tx);
      return true;
    });
    if (!removed) return reply.code(404).send({ error: 'No such external account' });
    return { ok: true };
  });
}
