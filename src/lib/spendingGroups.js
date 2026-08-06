/**
 * The `Spending Group` column is the export's own taxonomy — Day-to-day, Recurring, Debt,
 * Insurance, Bank Fees, Communications, Invest-save-repay — and the app ignored it entirely,
 * flattening everything into ~40 categories at one level. Used as a nesting level it takes the top
 * of the table down to about nine rows, and separates the split that actually matters for
 * forecasting: committed recurring cost versus discretionary day-to-day spend.
 *
 * Older exports (and the bundled sample) don't carry the column, so the level is only introduced
 * when the data actually has it.
 */

export const UNCLASSIFIED_SPENDING_GROUP = 'Unclassified';
export const TRANSFER_SPENDING_GROUP = 'Transfer';

/** Roughly committed-to-discretionary; unknown values are appended alphabetically. */
export const SPENDING_GROUP_ORDER = [
  'Income',
  'Recurring',
  'Debt',
  'Insurance',
  'Communications',
  'Bank Fees',
  'Day-to-day',
  'Invest-save-repay',
  'Exceptions',
  'Transfer',
  UNCLASSIFIED_SPENDING_GROUP,
];

export function spendingGroupOf(transaction) {
  const raw = transaction?.['Spending Group'];
  return (typeof raw === 'string' && raw.trim()) || UNCLASSIFIED_SPENDING_GROUP;
}

/** True when the export carries the column at all — otherwise the level is skipped. */
export function hasSpendingGroups(data) {
  return Boolean(data?.some((t) => typeof t?.['Spending Group'] === 'string' && t['Spending Group'].trim()));
}

export function compareSpendingGroups(a, b) {
  const ia = SPENDING_GROUP_ORDER.indexOf(a);
  const ib = SPENDING_GROUP_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}
