import { AVG_RECENCY_DECAY, WINSOR_LOWER, WINSOR_MIN_OBSERVATIONS, WINSOR_UPPER } from '../constants';
import { getPayMonth } from './effectivePayMonth';

/** Months used for Avg / Remaining — excludes the current (last visible) month. */
export function avgMonths(months) {
  return months.length > 1 ? months.slice(0, -1) : [];
}

/**
 * Pull extreme values in to a percentile bound instead of dropping them.
 *
 * One abnormal cycle otherwise dominates a recency-weighted mean: 2026-01 carries R578k of income
 * against a typical R190-260k, and at a 0.5 decay the three most recent cycles hold 87% of the
 * weight. Winsorising keeps the month counted — it still reads as "unusually high" — but stops it
 * setting the level on its own. Trimming would discard a fifth of the evidence on a 5-cycle window,
 * and a hardcoded exclusion list needs hand-maintaining forever.
 */
export function winsorize(values, lower = WINSOR_LOWER, upper = WINSOR_UPPER) {
  if (values.length < WINSOR_MIN_OBSERVATIONS) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
  const lo = at(lower);
  const hi = at(upper);
  return values.map((v) => Math.min(hi, Math.max(lo, v)));
}

/**
 * Recency-weighted expectation per cycle, robust to an abnormal month.
 *
 * A cycle in which the category never appeared counts as a real zero — if you only buy it in two
 * cycles out of six, the expected spend per cycle genuinely is a third of what you spend when you
 * do. That makes this `level x presence`, which is what the weighting below already computes.
 *
 * `excludeMonths` drops cycles that can't be compared fairly — chiefly the first cycle in an
 * export, which starts mid-stream and is therefore structurally too small.
 */
export function monthlyAvg(totalsByMonth, months, { excludeMonths } = {}) {
  const prior = avgMonths(months).filter((m) => !excludeMonths?.has(m));
  if (prior.length === 0) return 0;

  // Newest first, so index 0 carries the most weight.
  const ordered = [...prior].reverse();
  const weights = ordered.map((_, i) => AVG_RECENCY_DECAY ** i);
  const weightTotal = weights.reduce((s, w) => s + w, 0);
  if (!weightTotal) return 0;

  // Winsorise only the cycles the category actually appeared in — including the structural zeros
  // would drag the percentile bounds down and defeat the purpose.
  const presentIdx = ordered
    .map((m, i) => (Math.abs(totalsByMonth[m] ?? 0) > 0.001 ? i : -1))
    .filter((i) => i >= 0);
  const capped = winsorize(presentIdx.map((i) => totalsByMonth[ordered[i]] ?? 0));
  const values = new Array(ordered.length).fill(0);
  presentIdx.forEach((idx, k) => {
    values[idx] = capped[k];
  });

  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / weightTotal;
}

export function totalsFromItems(items, months, transferIds = new Set()) {
  const totalsByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  items.forEach((t) => {
    const m = getPayMonth(t);
    if (!months.includes(m) || transferIds.has(t.id)) return;
    totalsByMonth[m] = (totalsByMonth[m] || 0) + t.AmountNum;
  });
  return totalsByMonth;
}

/** Month-end net if each side closes its remaining gap to average. */
export function projectedMonthNet(incomeCurrent, incomeAvg, expenseCurrent, expenseAvg) {
  const projectedIncome = incomeCurrent >= incomeAvg ? incomeCurrent : incomeAvg;
  const projectedExpense =
    Math.abs(expenseCurrent) >= Math.abs(expenseAvg) ? expenseCurrent : expenseAvg;
  return projectedIncome + projectedExpense;
}
