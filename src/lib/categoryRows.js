/**
 * One row per category, whatever the export filed it under.
 *
 * The table nests categories inside the export's Spending Group, and the same category can appear
 * in more than one of them — "Home & Garden" arrives under both Day-to-day and Recurring, and
 * "Groceries" under Day-to-day and Debt when it was put on a card. That nesting is right for the
 * table, where the grouping is the point.
 *
 * It is wrong everywhere else. A target on Groceries means all groceries; "safe to spend" must not
 * count a category twice; and React needs one row per key. So anything reasoning about categories
 * rather than displaying the tree flattens through here, where same-named rows are merged.
 */
export function flattenCategories(processed) {
  const expenseRow = processed?.rows?.find((r) => r.name === 'Expense');
  const raw = (expenseRow?.sub ?? []).flatMap((s) => (s.isSpendingGroup ? (s.sub ?? []) : [s]));

  const merged = new Map();
  raw.forEach((c) => {
    const existing = merged.get(c.name);
    if (!existing) {
      merged.set(c.name, {
        name: c.name,
        avg: c.avg ?? 0,
        expected: c.expected ?? 0,
        isBill: !!c.isBill,
        // How much of `expected` is committed. A category can be half debit-order and half
        // discretionary when the export filed it under two spending groups, so carrying the amount
        // rather than a flag stops "safe to spend" from treating the whole line as a bill.
        committed: c.isBill ? Math.abs(c.expected ?? 0) : 0,
        totalsByMonth: { ...(c.totalsByMonth ?? {}) },
        groups: [c.spendingGroup].filter(Boolean),
        items: c.items ?? [],
      });
      return;
    }
    existing.avg += c.avg ?? 0;
    existing.expected += c.expected ?? 0;
    existing.committed += c.isBill ? Math.abs(c.expected ?? 0) : 0;
    // Only a category that is a bill in every grouping it appears in is labelled as one.
    existing.isBill = existing.isBill && !!c.isBill;
    Object.entries(c.totalsByMonth ?? {}).forEach(([m, v]) => {
      existing.totalsByMonth[m] = (existing.totalsByMonth[m] ?? 0) + v;
    });
    if (c.spendingGroup) existing.groups.push(c.spendingGroup);
    existing.items = existing.items.concat(c.items ?? []);
  });

  return [...merged.values()];
}
