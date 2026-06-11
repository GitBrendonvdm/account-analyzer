import { AVG_RECENCY_DECAY, AVG_RECENCY_INITIAL_WEIGHT } from '../constants';
import { getPayMonth } from './effectivePayMonth';

/** Months used for Avg / Remaining — excludes the current (last visible) month. */
export function avgMonths(months) {
  return months.length > 1 ? months.slice(0, -1) : [];
}

/**
 * Prior-month average with heavy recency weighting.
 * Latest prior month has weight 0.4, then 0.2, 0.1, 0.05, etc. for older months.
 * We normalize over the selected visible prior months so the month selector controls the window.
 */
export function monthlyAvg(totalsByMonth, months) {
  const prior = avgMonths(months);
  if (prior.length === 0) return 0;

  let weightedSum = 0;
  let weightTotal = 0;

  [...prior].reverse().forEach((m, i) => {
    const weight = AVG_RECENCY_INITIAL_WEIGHT * AVG_RECENCY_DECAY ** i;
    weightedSum += (totalsByMonth[m] ?? 0) * weight;
    weightTotal += weight;
  });
  return weightedSum / weightTotal;
}

/** Remaining gap to average — 0 when at or above average. */
export function computeRemaining(current, avg, kind = 'expense') {
  if (kind === 'income') {
    return current >= avg ? 0 : avg - current;
  }
  const cur = Math.abs(current);
  const av = Math.abs(avg);
  return cur >= av ? 0 : avg - current;
}

export function computeCurrentMinusAvg(totalsByMonth, months, kind = 'expense') {
  const currentMonth = months[months.length - 1];
  const current = totalsByMonth[currentMonth] ?? 0;
  const avg = monthlyAvg(totalsByMonth, months);
  return computeRemaining(current, avg, kind);
}

/** Month-end net if each side closes its remaining gap to average. */
export function projectedMonthNet(incomeCurrent, incomeAvg, expenseCurrent, expenseAvg) {
  const projectedIncome = incomeCurrent >= incomeAvg ? incomeCurrent : incomeAvg;
  const projectedExpense =
    Math.abs(expenseCurrent) >= Math.abs(expenseAvg) ? expenseCurrent : expenseAvg;
  return projectedIncome + projectedExpense;
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

export function computeExpectedValue(items, months, transferIds = new Set(), kind = 'expense') {
  return computeCurrentMinusAvg(totalsFromItems(items, months, transferIds), months, kind);
}
