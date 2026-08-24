import { monthKeyFromDate, parseMonthKey, parseTransactionDate } from '../utils/date';

/** Categories where duplicate same-month credits are treated as staggered pay (e.g. two salary runs). */
const SALARY_CATEGORY_RE = /salaries?|wages?/i;

/** Pay, by the category's own name. */
export function isSalaryCategory(category) {
  return SALARY_CATEGORY_RE.test(category || '');
}

export function getPayMonth(transaction) {
  return transaction.effectivePayMonth ?? transaction['Pay Month'];
}

export function isSalaryLikeIncome(transaction) {
  if (transaction.AmountNum <= 0) return false;
  return isSalaryCategory(transaction.Category);
}

/** Null for a key that is not a key — see parseMonthKey. */
export function addMonthsToKey(monthKey, offset) {
  const { year, monthIndex } = parseMonthKey(monthKey);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  return monthKeyFromDate(new Date(year, monthIndex + offset, 1));
}

/** Prefer calendar next month when it is already in the visible window; otherwise use the next bucket in range. */
function resolveShiftedMonth(originalMonth, offset, visibleMonths) {
  const calendarTarget = addMonthsToKey(originalMonth, offset);
  if (!calendarTarget) return originalMonth;
  if (visibleMonths.includes(calendarTarget)) return calendarTarget;

  const idx = visibleMonths.indexOf(originalMonth);
  if (idx >= 0 && idx + offset < visibleMonths.length) {
    return visibleMonths[idx + offset];
  }

  return originalMonth;
}

/**
 * When two or more salary-like credits share a pay month, keep the earliest and virtually
 * move each subsequent one forward — but only into months already in the visible window.
 */
export function enrichWithEffectivePayMonths(transactions, visibleMonths) {
  const shifts = new Map();
  const byCategoryMonth = new Map();

  transactions.forEach((t) => {
    // A row with no pay month belongs to no cycle, so there is no cycle to move it into.
    if (!isSalaryLikeIncome(t) || !t['Pay Month']) return;
    const key = `${t.Category}\u0000${t['Pay Month']}`;
    if (!byCategoryMonth.has(key)) byCategoryMonth.set(key, []);
    byCategoryMonth.get(key).push(t);
  });

  byCategoryMonth.forEach((items) => {
    if (items.length <= 1) return;
    items.sort((a, b) => {
      const da = parseTransactionDate(a.Date)?.getTime() ?? 0;
      const db = parseTransactionDate(b.Date)?.getTime() ?? 0;
      return da - db || (a.id ?? 0) - (b.id ?? 0);
    });
    items.forEach((t, index) => {
      if (index === 0) return;
      shifts.set(t.id, resolveShiftedMonth(t['Pay Month'], index, visibleMonths));
    });
  });

  return transactions.map((t) => ({
    ...t,
    effectivePayMonth: shifts.get(t.id) ?? t['Pay Month'],
  }));
}
