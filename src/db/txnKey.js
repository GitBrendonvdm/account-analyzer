import { accountIdOf } from './accountIdentity';

/**
 * A transaction's identity across imports.
 *
 * The export carries no transaction id, so identity has to be reconstructed from the fields that
 * don't move: the date it happened, the account it happened on, what it cost, and what it was
 * called. Amount is normalised to cents to survive float formatting, and the account is reduced to
 * its stable id so a renamed account doesn't duplicate its entire history.
 *
 * Two genuinely separate purchases can be identical in all four fields — two flat whites at the
 * same shop on the same morning. Rather than collapse them, identical rows within one file are
 * numbered in the order they appear, which is stable as long as the export's own ordering is. A
 * file that reorders its rows would create churn; in practice these exports do not.
 */

function cents(amount) {
  return Math.round((Number(amount) || 0) * 100);
}

function normalise(text) {
  return (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The identity of one row, ignoring duplicates. */
function baseKey(row) {
  return [
    (row.Date ?? '').trim(),
    accountIdOf(row.Account),
    cents(row.AmountNum ?? row.Amount),
    normalise(row.Description),
  ].join('|');
}

/**
 * Assign a stable key to every row in one file, numbering exact duplicates.
 * Returns the same array with `key` set on each row.
 */
export function assignKeys(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    const base = baseKey(row);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    row.key = n === 0 ? base : `${base}|#${n}`;
  });
  return rows;
}

/**
 * Fields that can legitimately change for a row that already exists — a Pending charge settling,
 * or a category being re-assigned upstream. Everything else is part of the key, so if it differs
 * it is a different transaction.
 */
export const MUTABLE_FIELDS = ['Status', 'Category', 'Spending Group', 'Tags', 'Notes', 'Type'];

/** Which mutable fields differ between a stored row and an incoming one. */
export function changedFields(stored, incoming) {
  return MUTABLE_FIELDS.filter((f) => (stored[f] ?? '') !== (incoming[f] ?? ''));
}
