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

/**
 * One pass over a flow's rows: per category, the months it is active in and its monthly
 * magnitude totals.
 *
 * This used to be recomputed from scratch for every question asked of it — `isSparseCategory`
 * walked every row once per category, and `isOutlierTransaction` walked every row once per
 * CURRENT-MONTH ROW, which at a 26-cycle range made exception clustering the single most
 * expensive step in the pipeline (≈ 25 ms of a 45 ms run). The answers never changed between
 * calls, so they are computed once here and read from the map below. The arithmetic is the
 * same to the cent: magnitudes summed by effective pay month, months recorded as a set.
 *
 * @returns {Map<string, { totals: Record<string, number>, active: Set<string> }>}
 */
function profileCategories(items, months) {
  const monthSet = new Set(months);
  const profile = new Map();
  items.forEach((t) => {
    const category = categoryName(t);
    const m = getPayMonth(t);
    let entry = profile.get(category);
    if (!entry) {
      entry = { totals: Object.fromEntries(months.map((month) => [month, 0])), active: new Set() };
      profile.set(category, entry);
    }
    entry.active.add(m);
    if (monthSet.has(m)) entry.totals[m] += Math.abs(t.AmountNum);
  });
  return profile;
}

function isSparseCategory(entry, visibleMonths, monthRatio) {
  const currentMonth = visibleMonths[visibleMonths.length - 1];
  const activeCount = entry.active.size;
  if (activeCount === 0) return false;

  const ratio = activeCount / visibleMonths.length;
  const onlyInCurrentMonth = activeCount === 1 && entry.active.has(currentMonth);
  return onlyInCurrentMonth || ratio < monthRatio;
}

function buildSparseCategorySet(profile, months, monthRatio) {
  const sparse = new Set();
  profile.forEach((entry, category) => {
    if (isSparseCategory(entry, months, monthRatio)) sparse.add(category);
  });
  return sparse;
}

/** Median of the category's prior-month totals, ignoring months it was absent from; 0 with no history. */
function outlierBaseline(entry, months) {
  const priorValues = months
    .slice(0, -1)
    .map((m) => entry.totals[m])
    .filter((v) => v > 0.001);
  return priorValues.length > 0 ? median(priorValues) : 0;
}

function isOutlierAmount(amount, baseline) {
  if (baseline < 0.001) return amount >= OUTLIER_MIN_AMOUNT * OUTLIER_MULTIPLIER;
  return amount >= OUTLIER_MULTIPLIER * baseline && amount >= OUTLIER_MIN_AMOUNT;
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

/**
 * Current-month rows of a recurring category whose amount dwarfs the category's usual month.
 * The baseline is read once per category from the profile; the rows are walked once.
 */
function buildOutlierTransactionIds(items, months, recurringCategories, profile) {
  const outlierIds = new Set();
  const currentMonth = months[months.length - 1];
  const baselines = new Map(
    recurringCategories.map((category) => [category, outlierBaseline(profile.get(category), months)]),
  );

  items.forEach((t) => {
    if (getPayMonth(t) !== currentMonth) return;
    const baseline = baselines.get(categoryName(t));
    if (baseline === undefined) return;
    if (isOutlierAmount(Math.abs(t.AmountNum), baseline)) outlierIds.add(t.id);
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
  const incomeProfile = profileCategories(incomeItems, months);
  const expenseProfile = profileCategories(expenseItems, months);

  const incomeSparseCategories = buildSparseCategorySet(
    incomeProfile,
    months,
    INCOME_EXCEPTION_MONTH_RATIO,
  );
  const expenseSparseCategories = buildSparseCategorySet(
    expenseProfile,
    months,
    EXCEPTION_MONTH_RATIO,
  );

  keepStableDescriptionIncomeRegular(incomeItems, incomeSparseCategories);

  // Uncategorized income is sporadic by nature — always route to Income Exceptions.
  incomeItems.forEach((t) => {
    if (isUncategorizedCategory(t)) incomeSparseCategories.add(categoryName(t));
  });

  const recurringIncome = [...incomeProfile.keys()].filter((c) => !incomeSparseCategories.has(c));
  const recurringExpense = [...expenseProfile.keys()].filter((c) => !expenseSparseCategories.has(c));

  const outlierTransactionIds = new Set([
    ...buildOutlierTransactionIds(incomeItems, months, recurringIncome, incomeProfile),
    ...buildOutlierTransactionIds(expenseItems, months, recurringExpense, expenseProfile),
  ]);

  const state = {
    incomeSparseCategories,
    expenseSparseCategories,
    outlierTransactionIds,
    currentMonth: months[months.length - 1],
  };
  // Display clustering is the one genuinely expensive step left (≈ 18 ms of Levenshtein work at a
  // 26-cycle range) and nothing in the pipeline reads it, so it runs the first time something asks
  // for it and is remembered after. Spreading this object still triggers it — callers that only
  // need the sets should read them by name.
  let clusters = null;
  Object.defineProperty(state, 'descToCluster', {
    enumerable: true,
    get() {
      if (!clusters) clusters = buildDisplayDescriptionClusters(scoped);
      return clusters;
    },
  });
  return state;
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
