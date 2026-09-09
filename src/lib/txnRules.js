import { flagOf, FLAGS } from './txnOverrides';

/**
 * Standing corrections: one decision that keeps applying, including to payments not imported yet.
 *
 * A per-payment override (txnOverrides.js) is a judgement about ONE charge. That is right for a
 * burst geyser and hopeless for a merchant you use every week — with R29 909 of exceptions in a
 * cycle, correcting them one at a time is a job, not a feature, and it has to be redone as the
 * export window slides. A rule says the thing once: "anything matching builders is Home
 * Maintenance and unexpected", and it holds for every matching payment, past and future.
 *
 * PRECEDENCE: a rule is a default, and the reader's own correction on a specific payment always
 * beats it. That ordering matters — otherwise a rule written to fix ninety rows would silently
 * undo the one exception the reader made by hand, and they would have no way to express "all of
 * these, except that one". `effectiveOverrides` merges in that order and marks where each field
 * came from, so the interface can show a payment as corrected by rule or corrected by hand.
 *
 * Rules produce exactly the same shape as manual overrides, so nothing downstream needs to know
 * they exist: one map of { key -> { category, spendingGroup, flag } } reaches applyTxnOverrides and
 * the exception classifier, whatever wrote it.
 */

/** A rule matches on any combination of these; an empty rule matches nothing, never everything. */
export const RULE_FIELDS = ['description', 'category', 'account', 'minAmount', 'maxAmount'];

const text = (v) => (v ?? '').toString().trim().toLowerCase();

/** Does this rule say anything at all? A rule with no conditions would rewrite the whole file. */
export function ruleIsUsable(rule) {
  if (!rule) return false;
  const hasMatch =
    text(rule.description) ||
    text(rule.category) ||
    text(rule.account) ||
    Number.isFinite(rule.minAmount) ||
    Number.isFinite(rule.maxAmount);
  const hasEffect = rule.set?.category || rule.set?.spendingGroup || FLAGS.includes(rule.set?.flag);
  return Boolean(hasMatch && hasEffect);
}

/**
 * Every condition present on the rule must hold. Description is a case-insensitive substring —
 * what a person types when they mean "the Builders ones" — while category and account are exact,
 * because those come from pickers and a substring there would quietly catch neighbours
 * ("Insurance" swallowing "Other Insurance").
 */
export function matchesRule(transaction, rule) {
  if (!ruleIsUsable(rule) || rule.enabled === false) return false;
  const description = text(transaction.Description);
  const wanted = text(rule.description);
  if (wanted && !description.includes(wanted)) return false;
  if (text(rule.category) && text(transaction.Category) !== text(rule.category)) return false;
  if (text(rule.account) && text(transaction.Account) !== text(rule.account)) return false;
  const magnitude = Math.abs(Number(transaction.AmountNum) || 0);
  if (Number.isFinite(rule.minAmount) && magnitude < rule.minAmount) return false;
  if (Number.isFinite(rule.maxAmount) && magnitude > rule.maxAmount) return false;
  return true;
}

/** The payments a rule currently covers — what the interface shows before the reader commits. */
export function matchesOf(data, rule) {
  if (!ruleIsUsable(rule)) return [];
  return (data ?? []).filter((t) => matchesRule(t, rule));
}

/** Only the fields a rule actually sets, so an unset field never clobbers one from elsewhere. */
function effectOf(rule) {
  const out = {};
  if (rule.set?.category) out.category = rule.set.category;
  if (rule.set?.spendingGroup) out.spendingGroup = rule.set.spendingGroup;
  if (FLAGS.includes(rule.set?.flag)) out.flag = rule.set.flag;
  return out;
}

/**
 * One map of corrections for the whole file: rules first in order, then the reader's own, which
 * win field by field. `source` records where each field came from — 'rule' or 'manual' — so a row
 * can say which, and a rule's effect is never mistaken for a decision someone made by hand.
 *
 * @param data    transactions carrying `key`
 * @param rules   Rule[] (settings.txnRules), applied in order — a later rule beats an earlier one
 * @param manual  { [key]: { category?, spendingGroup?, flag? } } (settings.txnOverrides)
 */
export function effectiveOverrides(data, rules, manual) {
  const usable = (rules ?? []).filter(ruleIsUsable);
  if (!usable.length) return manual ?? {};
  const out = {};
  (data ?? []).forEach((t) => {
    if (!t.key) return;
    let applied = null;
    usable.forEach((rule) => {
      if (!matchesRule(t, rule)) return;
      const effect = effectOf(rule);
      if (!Object.keys(effect).length) return;
      applied = { ...(applied ?? {}), ...effect };
      const source = { ...(applied.source ?? {}) };
      Object.keys(effect).forEach((field) => {
        source[field] = 'rule';
      });
      applied.source = source;
    });
    if (applied) out[t.key] = applied;
  });
  // The reader's own corrections land on top, field by field.
  Object.entries(manual ?? {}).forEach(([key, own]) => {
    const base = out[key] ?? {};
    const source = { ...(base.source ?? {}) };
    const merged = { ...base };
    ['category', 'spendingGroup', 'flag'].forEach((field) => {
      if (own?.[field] == null) return;
      merged[field] = own[field];
      source[field] = 'manual';
    });
    out[key] = { ...merged, source };
  });
  return out;
}

/** Whether a transaction's correction came from a rule rather than from the reader. */
export function isByRule(transaction, overrides) {
  const entry = transaction?.key ? overrides?.[transaction.key] : null;
  if (!entry?.source) return false;
  return Object.values(entry.source).some((s) => s === 'rule');
}

export { flagOf };
