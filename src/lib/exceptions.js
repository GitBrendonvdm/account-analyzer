import {
  EXCEPTION_MONTH_RATIO,
  INCOME_EXCEPTION_MONTH_RATIO,
  OUTLIER_MIN_AMOUNT,
  OUTLIER_MULTIPLIER,
  UNCATEGORIZED_CATEGORY_LABELS,
} from '../constants';
import { getPayMonth } from './effectivePayMonth';
import { buildDescriptionClusters } from './descriptionClustering';
import { isTransfer } from './transfers';

const CATEGORY_SEPARATOR = '\u0000';

function categoryName(transaction) {
  return transaction.Category || 'Uncategorized';
}

function isUncategorizedCategory(transaction) {
  const raw = transaction.Category;
  if (!raw || raw.trim() === '') return true;
  return UNCATEGORIZED_CATEGORY_LABELS.some(
    (label) => label.toLowerCase() === raw.trim().toLowerCase(),
  );
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function activeMonthsForCategory(items, category) {
  const months = new Set();
  items.forEach((t) => {
    if (categoryName(t) === category) months.add(getPayMonth(t));
  });
  return months;
}

function isSparseCategory(items, category, visibleMonths, monthRatio) {
  const currentMonth = visibleMonths[visibleMonths.length - 1];
  const monthSet = activeMonthsForCategory(items, category);
  const activeCount = monthSet.size;
  if (activeCount === 0) return false;

  const ratio = activeCount / visibleMonths.length;
  const onlyInCurrentMonth = activeCount === 1 && monthSet.has(currentMonth);
  return onlyInCurrentMonth || ratio < monthRatio;
}

function categoryMonthlyTotals(items, category, months) {
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  items.forEach((t) => {
    const m = getPayMonth(t);
    if (categoryName(t) !== category || !months.includes(m)) return;
    totals[m] += Math.abs(t.AmountNum);
  });
  return totals;
}

function isOutlierTransaction(transaction, items, category, months) {
  const priorMonths = months.slice(0, -1);
  const monthlyTotals = categoryMonthlyTotals(items, category, months);
  const priorValues = priorMonths.map((m) => monthlyTotals[m]).filter((v) => v > 0.001);
  const baseline = priorValues.length > 0 ? median(priorValues) : 0;
  const amount = Math.abs(transaction.AmountNum);

  if (baseline < 0.001) {
    return amount >= OUTLIER_MIN_AMOUNT * OUTLIER_MULTIPLIER;
  }

  return amount >= OUTLIER_MULTIPLIER * baseline && amount >= OUTLIER_MIN_AMOUNT;
}

function buildSparseCategorySet(items, months, monthRatio) {
  const categories = new Set(items.map(categoryName));
  const sparse = new Set();
  categories.forEach((category) => {
    if (isSparseCategory(items, category, months, monthRatio)) sparse.add(category);
  });
  return sparse;
}

function activeMonthsForItems(items) {
  return new Set(items.map(getPayMonth));
}

function hasStableRecurringDescription(items) {
  if (items.length < 2) return false;

  const { clusterInfo } = buildDescriptionClusters(items.map((t) => t.Description));
  return [...clusterInfo.values()].some((info) => {
    const clusterItems = items.filter((t) => info.variants.includes(t.Description));
    const clusterMonths = activeMonthsForItems(clusterItems);
    const coversCategory = clusterItems.length / items.length >= 0.8;

    return coversCategory && clusterMonths.size >= 2;
  });
}

function keepStableDescriptionIncomeRegular(incomeItems, sparseCategories) {
  sparseCategories.forEach((category) => {
    const categoryItems = incomeItems.filter((t) => categoryName(t) === category);
    if (hasStableRecurringDescription(categoryItems)) sparseCategories.delete(category);
  });
}

function buildOutlierTransactionIds(items, months, recurringCategories) {
  const outlierIds = new Set();
  const currentMonth = months[months.length - 1];

  recurringCategories.forEach((category) => {
    items
      .filter((t) => categoryName(t) === category && getPayMonth(t) === currentMonth)
      .forEach((t) => {
        if (isOutlierTransaction(t, items, category, months)) outlierIds.add(t.id);
      });
  });

  return outlierIds;
}

/** Description clustering for display grouping only — not used for exception classification. */
function buildDisplayDescriptionClusters(items) {
  const descToCluster = new Map();
  const byCategory = new Map();

  items.forEach((t) => {
    const category = categoryName(t);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(t.Description);
  });

  byCategory.forEach((descriptions, category) => {
    const local = buildDescriptionClusters(descriptions);
    local.descToCluster.forEach((canonical, description) => {
      descToCluster.set(
        `${category}${CATEGORY_SEPARATOR}${description}`,
        `${category}${CATEGORY_SEPARATOR}${canonical}`,
      );
    });
  });

  return descToCluster;
}

export function buildExceptionClusters(items, months, transferIds) {
  const scoped = items.filter(
    (t) => months.includes(getPayMonth(t)) && !isTransfer(t, transferIds),
  );
  const incomeItems = scoped.filter((t) => t.AmountNum > 0);
  const expenseItems = scoped.filter((t) => t.AmountNum < 0);

  const incomeSparseCategories = buildSparseCategorySet(
    incomeItems,
    months,
    INCOME_EXCEPTION_MONTH_RATIO,
  );
  const expenseSparseCategories = buildSparseCategorySet(
    expenseItems,
    months,
    EXCEPTION_MONTH_RATIO,
  );

  keepStableDescriptionIncomeRegular(incomeItems, incomeSparseCategories);

  // Uncategorized income is sporadic by nature — always route to Income Exceptions.
  incomeItems.forEach((t) => {
    if (isUncategorizedCategory(t)) incomeSparseCategories.add(categoryName(t));
  });

  const incomeCategories = new Set(incomeItems.map(categoryName));
  const expenseCategories = new Set(expenseItems.map(categoryName));
  const recurringIncome = [...incomeCategories].filter((c) => !incomeSparseCategories.has(c));
  const recurringExpense = [...expenseCategories].filter((c) => !expenseSparseCategories.has(c));

  const outlierTransactionIds = new Set([
    ...buildOutlierTransactionIds(incomeItems, months, recurringIncome),
    ...buildOutlierTransactionIds(expenseItems, months, recurringExpense),
  ]);

  return {
    incomeSparseCategories,
    expenseSparseCategories,
    outlierTransactionIds,
    descToCluster: buildDisplayDescriptionClusters(scoped),
    currentMonth: months[months.length - 1],
  };
}

export function resolveMainGroup(transaction, state) {
  const {
    incomeSparseCategories,
    expenseSparseCategories,
    outlierTransactionIds,
    transferIds,
  } = state;

  if (isTransfer(transaction, transferIds)) return 'Transfers';

  const category = categoryName(transaction);
  const isExceptionIncome =
    incomeSparseCategories.has(category) || outlierTransactionIds.has(transaction.id);
  const isExceptionExpense =
    expenseSparseCategories.has(category) || outlierTransactionIds.has(transaction.id);

  if (transaction.AmountNum > 0) {
    return isExceptionIncome ? 'Income Exceptions' : 'Income';
  }

  if (transaction.AmountNum < 0) {
    return isExceptionExpense ? 'Expense Exceptions' : 'Expense';
  }

  return 'Transfers';
}
