import { getPayMonth } from './effectivePayMonth';
import { clusterKey, buildDescriptionClusters } from './descriptionClustering';
import { providerOf } from './providers';
import { monthlyAvg } from './expected';

/**
 * Split a category's remaining across its description clusters, pro-rata by each cluster's typical
 * size.
 *
 * These rows used to run their own estimate — a whole-month gap-to-average with no week awareness —
 * while the category above them used the weekly envelope. Two different models over two different
 * windows meant the children never added up to the parent, which makes the tree impossible to read.
 * An allocation is a weaker claim than an independent forecast, but ~25 cycles cannot support a
 * per-description weekly shape, and estimates that don't sum are worse than ones that do.
 */
function allocate(groups, { expected = 0, weeklyRemaining = [], excludeMonths } = {}, months) {
  const weights = groups.map((g) => Math.abs(monthlyAvg(g.amountsByMonth, months, { excludeMonths })));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    // Nothing to weight by — give it all to the largest cluster rather than smearing it evenly.
    const largest = groups.reduce(
      (best, g, i) => {
        const size = Object.values(g.amountsByMonth).reduce((s, v) => s + Math.abs(v), 0);
        return size > best.size ? { i, size } : best;
      },
      { i: 0, size: -1 },
    ).i;
    return groups.map((_, i) => ({
      expected: i === largest ? expected : 0,
      weeklyRemaining: weeklyRemaining.map((v) => (i === largest ? v : 0)),
    }));
  }
  return groups.map((_, i) => {
    const share = weights[i] / total;
    return {
      expected: expected * share,
      weeklyRemaining: weeklyRemaining.map((v) => v * share),
    };
  });
}

/**
 * @param providers  Provider[] (settings.txnProviders). A provider folds the branches of one chain
 *   onto one row — "Pnp Crp Glengarry", "Pnp Hpr Brackenfell" and "Pick N Pay Asap Kenilworth" are
 *   three strings the clusterer cannot relate, because as text they are not similar, and one shop.
 *   The branches become this row's variants, which is the container the table already has for
 *   "several names, one thing", so nothing below here changes.
 */
export function groupTransactionsByDescription(items, months, skipExpected = false, parent = {}, providers = null) {
  const currentMonth = months[months.length - 1] ?? '';
  const { descToCluster, clusterInfo } = buildDescriptionClusters(items.map((t) => t.Description));
  const groups = new Map();

  items.forEach((item) => {
    const m = getPayMonth(item);
    if (!months.includes(m)) return;
    const provider = providerOf(item.Description, providers);
    const key = provider ?? clusterKey(item.Description, descToCluster);
    if (!groups.has(key)) {
      const info = provider ? null : clusterInfo.get(key);
      groups.set(key, {
        description: provider ?? info?.canonical ?? key,
        provider: provider ?? null,
        variants: provider ? [] : (info?.variants ?? [key]),
        amountsByMonth: {},
        datesByMonth: {},
        // Transaction keys, so the reader's corrections can be written against the rows this
        // display group actually stands for. See lib/txnOverrides.js.
        keys: [],
      });
    }
    const g = groups.get(key);
    // A provider's variants are the real descriptions it stands for, collected as they are met.
    if (provider && !g.variants.includes(item.Description)) g.variants.push(item.Description);
    g.amountsByMonth[m] = (g.amountsByMonth[m] || 0) + item.AmountNum;
    g.datesByMonth[m] = item.Date;
    if (item.key) g.keys.push(item.key);
  });

  const list = [...groups.values()];
  const shares = skipExpected
    ? list.map(() => ({ expected: 0, weeklyRemaining: [] }))
    : allocate(list, parent, months);

  return list
    .map((g, gi) => {
      const activeMonths = months.filter(
        (m) => g.amountsByMonth[m] != null && Math.abs(g.amountsByMonth[m]) > 0.001,
      );
      const variantRows = g.variants.map((variantDesc) => {
        const amountsByMonth = {};
        const datesByMonth = {};
        const variantKeys = [];
        items.forEach((item) => {
          const m = getPayMonth(item);
          if (item.Description !== variantDesc || !months.includes(m)) return;
          amountsByMonth[m] = (amountsByMonth[m] || 0) + item.AmountNum;
          datesByMonth[m] = item.Date;
          if (item.key) variantKeys.push(item.key);
        });
        return { description: variantDesc, amountsByMonth, datesByMonth, keys: variantKeys };
      });
      return {
        ...g,
        variantRows,
        expected: shares[gi].expected,
        weeklyRemaining: shares[gi].weeklyRemaining,
        currentMonth,
        monthCount: activeMonths.length,
        totalMonths: months.length,
        isException: skipExpected,
      };
    })
    .sort((a, b) => a.description.localeCompare(b.description));
}
