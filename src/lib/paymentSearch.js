import { getPayMonth } from './effectivePayMonth';

/**
 * Finding one payment among tens of thousands.
 *
 * The ledger is an aggregation: to reach a charge you open a group, a spending group, a category, a
 * description, sometimes a variant. That is the right shape for reading a cycle and the wrong shape
 * for answering "what IS the R29 909 of exceptions" or "where did that Builders charge go" — and
 * without an answer to those, the corrections are unusable, because you cannot correct what you
 * cannot reach.
 *
 * The results are a FLAT LIST, deliberately, and they never filter the table above. Searching must
 * not change a single total: a reader who types "builders" is asking where something is, not asking
 * for a household whose spending excludes everything else. Every figure on the ledger stays exactly
 * where it was; this is a second view onto the same rows.
 */

const text = (v) => (v ?? '').toString().toLowerCase();

/** The filters, as data, so the interface and the tests agree on what each one means. */
export const QUICK_FILTERS = [
  { id: 'exceptions', label: 'Exceptions', hint: 'One-offs — left out of the averages and the forecast' },
  { id: 'uncategorised', label: 'Uncategorised', hint: 'No category from the bank' },
  { id: 'corrected', label: 'Corrected', hint: 'You or a rule changed these' },
  { id: 'thisCycle', label: 'This cycle', hint: 'Since the current pay cycle began' },
  { id: 'income', label: 'Income', hint: 'Money in' },
];

const UNCATEGORISED = new Set(['', 'uncategorized', 'uncategorised', 'other', 'unknown']);

/**
 * @param data       every transaction (already carrying overrides via applyTxnOverrides)
 * @param options    query: string; filters: Set<string>|string[]; minAmount: number|null;
 *                   overrides: the effective correction map; currentMonth: 'YYYY-MM';
 *                   exceptionKeys: Set of keys the classifier put in an Exceptions group;
 *                   limit: how many rows to return (the rest are counted, not built)
 * @returns {{ rows, total, shown, sum }} rows newest first; `total`/`sum` cover every match.
 */
export function findPayments(data, options = {}) {
  const {
    query = '',
    filters = [],
    minAmount = null,
    overrides = null,
    currentMonth = null,
    exceptionKeys = null,
    limit = 200,
  } = options;
  const active = new Set(filters);
  const q = text(query).trim();
  const terms = q ? q.split(/\s+/) : [];

  const matches = (t) => {
    if (terms.length) {
      const haystack = `${text(t.Description)} ${text(t.Category)} ${text(t.Account)}`;
      // Every word must appear somewhere: "builders 2000" finds the Builders charges on *2000.
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    if (Number.isFinite(minAmount) && Math.abs(t.AmountNum ?? 0) < minAmount) return false;
    if (active.has('income') && !(t.AmountNum > 0)) return false;
    if (active.has('uncategorised') && !UNCATEGORISED.has(text(t.Category).trim())) return false;
    if (active.has('thisCycle') && currentMonth && getPayMonth(t) !== currentMonth) return false;
    if (active.has('corrected') && !(t.key && overrides?.[t.key])) return false;
    if (active.has('exceptions') && !(t.key && exceptionKeys?.has(t.key))) return false;
    return true;
  };

  const found = (data ?? []).filter(matches);
  const sum = found.reduce((s, t) => s + (Number(t.AmountNum) || 0), 0);
  const rows = [...found]
    .sort((a, b) => String(b.Date ?? '').localeCompare(String(a.Date ?? '')))
    .slice(0, Math.max(0, limit));
  return { rows, total: found.length, shown: rows.length, sum };
}

/**
 * The keys of every payment the classifier filed under an Exceptions group.
 *
 * Read off `processed` rather than recomputed, so the "Exceptions" filter can never disagree with
 * the Exceptions rows on the table — including after a correction moves a payment between them.
 */
export function exceptionKeysOf(processed) {
  const keys = new Set();
  (processed?.rows ?? [])
    .filter((g) => g.isException)
    .forEach((g) => {
      const walk = (node) => {
        (node.items ?? []).forEach((t) => t.key && keys.add(t.key));
        (node.sub ?? []).forEach(walk);
      };
      walk(g);
    });
  return keys;
}
