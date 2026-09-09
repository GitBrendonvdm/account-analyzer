/**
 * The reader's corrections to individual transactions, and the only place they are applied.
 *
 * Two judgements the data cannot make:
 *
 *   EXPECTED / UNEXPECTED. The exception classifier reasons from sparsity — a category seen in few
 *   cycles, or the surplus half of a charge far above its usual. That is a decent proxy for
 *   "one-off" and only a proxy: a quarterly school fee looks sparse and is entirely expected, while
 *   a R30 000 charge in a category used every week was a burst geyser. The consequence is not
 *   cosmetic — exceptions are excluded from the averages, from the forecast and from the band
 *   around it — so this flag decides whether a payment shapes what the app expects of next cycle.
 *
 *   CATEGORY / SPENDING GROUP. The bank's own labels are frequently wrong or too coarse, and every
 *   total, average and forecast in the app is grouped by them.
 *
 * Both are keyed on the transaction key (db/txnKey.js), which is rebuilt from date, account, amount
 * and description and therefore survives an import — a correction made today still applies to the
 * same row after the export window slides.
 *
 * A RE-LABEL IS APPLIED TO THE ROW, not read at each site. `applyTxnOverrides` rewrites `Category`
 * and `Spending Group` once, at the top of the pipeline, so the exception classifier profiles the
 * row under its new category, the recurring engine keys on it, and every total agrees — rather than
 * a dozen call sites each remembering to ask. The flag cannot work that way (it is not a field on
 * the row) so it travels separately, into `resolveMainGroup`.
 */

export const FLAGS = ['expected', 'unexpected'];

/** The verdict on one row, or null. */
export function flagOf(transaction, overrides) {
  const key = transaction?.key;
  if (!key) return null;
  const flag = overrides?.[key]?.flag ?? null;
  return FLAGS.includes(flag) ? flag : null;
}

/**
 * `data` with every re-labelled row rewritten. Returns the input array untouched when there is
 * nothing to apply, so the memo downstream of it does not invalidate on every render.
 *
 * @param data      transactions carrying `key`
 * @param overrides { [key]: { flag?, category?, spendingGroup? } } (settings.txnOverrides)
 */
export function applyTxnOverrides(data, overrides) {
  if (!data?.length || !overrides) return data;
  const relabelled = Object.values(overrides).some((o) => o?.category || o?.spendingGroup);
  if (!relabelled) return data;
  return data.map((t) => {
    const o = t.key ? overrides[t.key] : null;
    if (!o?.category && !o?.spendingGroup) return t;
    const next = { ...t };
    if (o.category) next.Category = o.category;
    if (o.spendingGroup) next['Spending Group'] = o.spendingGroup;
    return next;
  });
}

/** Every category and spending group in the file, for the pickers. Sorted, deduped, blanks dropped. */
export function labelChoices(data) {
  const categories = new Set();
  const spendingGroups = new Set();
  (data ?? []).forEach((t) => {
    const c = (t.Category ?? '').trim();
    const g = (t['Spending Group'] ?? '').trim();
    if (c) categories.add(c);
    if (g) spendingGroups.add(g);
  });
  const sort = (set) => [...set].sort((a, b) => a.localeCompare(b));
  return { categories: sort(categories), spendingGroups: sort(spendingGroups) };
}

/**
 * The overrides stored for a set of transaction keys, but only where they AGREE.
 *
 * A display row stands for several payments, and they need not have been corrected the same way.
 * A field the rows disagree on reads as null rather than picking one arbitrarily, so the editor
 * shows "as imported" and a change applies to all of them — which is what pressing a control on a
 * row that covers several payments plainly means.
 */
export function sharedOverride(keys, overrides) {
  const values = (keys ?? []).map((k) => overrides?.[k] ?? {});
  if (!values.length) return {};
  const agreed = (field) => {
    const first = values[0]?.[field] ?? null;
    return values.every((v) => (v?.[field] ?? null) === first) ? first : null;
  };
  return { flag: agreed('flag'), category: agreed('category'), spendingGroup: agreed('spendingGroup') };
}

/** A short badge for a corrected row, so a stored verdict is never invisible on a folded table. */
export function overrideBadge(shared) {
  const parts = [];
  if (shared?.flag) parts.push(shared.flag);
  if (shared?.category) parts.push(`→ ${shared.category}`);
  else if (shared?.spendingGroup) parts.push(`→ ${shared.spendingGroup}`);
  return parts.length ? parts.join(' ') : null;
}
