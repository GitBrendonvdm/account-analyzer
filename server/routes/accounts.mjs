import { randomBytes } from 'node:crypto';
import { bumpVersion, deleteAccount, getAccount, putAccounts } from '../db/data.mjs';

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
  interestRate: number,
  minimumPayment: number,
  termMonths: integer,
  balloon: number,
  feesMonthly: number,
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

export default async function accountRoutes(app) {
  const { store } = app;

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
