import { getPayMonth } from './effectivePayMonth';
import { clusterKey, buildDescriptionClusters } from './descriptionClustering';
import { computeCurrentMinusAvg } from './expected';

export function groupTransactionsByDescription(items, months, skipExpected = false, kind = 'expense') {
  const currentMonth = months[months.length - 1] ?? '';
  const { descToCluster, clusterInfo } = buildDescriptionClusters(items.map((t) => t.Description));
  const groups = new Map();

  items.forEach((item) => {
    const m = getPayMonth(item);
    if (!months.includes(m)) return;
    const key = clusterKey(item.Description, descToCluster);
    if (!groups.has(key)) {
      const info = clusterInfo.get(key);
      groups.set(key, {
        description: info?.canonical ?? key,
        variants: info?.variants ?? [key],
        amountsByMonth: {},
        datesByMonth: {},
      });
    }
    const g = groups.get(key);
    g.amountsByMonth[m] = (g.amountsByMonth[m] || 0) + item.AmountNum;
    g.datesByMonth[m] = item.Date;
  });

  return [...groups.values()]
    .map((g) => {
      const activeMonths = months.filter(
        (m) => g.amountsByMonth[m] != null && Math.abs(g.amountsByMonth[m]) > 0.001,
      );
      const variantRows = g.variants.map((variantDesc) => {
        const amountsByMonth = {};
        const datesByMonth = {};
        items.forEach((item) => {
          const m = getPayMonth(item);
          if (item.Description !== variantDesc || !months.includes(m)) return;
          amountsByMonth[m] = (amountsByMonth[m] || 0) + item.AmountNum;
          datesByMonth[m] = item.Date;
        });
        return { description: variantDesc, amountsByMonth, datesByMonth };
      });
      const expected = skipExpected ? 0 : computeCurrentMinusAvg(g.amountsByMonth, months, kind);
      return {
        ...g,
        variantRows,
        expected,
        currentMonth,
        monthCount: activeMonths.length,
        totalMonths: months.length,
        isException: skipExpected,
      };
    })
    .sort((a, b) => a.description.localeCompare(b.description));
}
