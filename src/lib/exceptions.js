import {
  EXCEPTION_MONTH_RATIO,
  INCOME_EXCEPTION_MONTH_RATIO,
  SPLIT_MIN_ACTIVE_CYCLES,
  SPLIT_MIN_EXCESS,
  SPLIT_TOLERANCE,
  UNCATEGORIZED_CATEGORY_LABELS,
} from '../constants';
import { getPayMonth, isSalaryCategory } from './effectivePayMonth';
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

/**
 * How much of a cycle was not the usual, category by category.
 *
 * A category that normally runs at R10 000 and ran at R15 000 has not become a R15 000 category.
 * The old rule moved the whole transaction that caused it into Exceptions, which threw the usual
 * part out with the surprise: a month of groceries would vanish from Groceries because one shop was
 * large. This keeps the usual where it belongs and treats only the surplus as the event, so the
 * averages and the forecast still describe an ordinary cycle while the surprise stays visible.
 *
 * "Usual" is the median of the category's OTHER active cycles, which is why one enormous cycle
 * cannot drag its own baseline up to meet itself. A category needs three active cycles before it
 * has a usual at all, and a category already routed to Exceptions is left alone — all of it is the
 * exception, so there is nothing to split off.
 *
 * The surplus comes off the largest transactions first, because that is nearly always where it came
 * from, and it is taken from real rows so that every rand in Exceptions can still be pointed at.
 *
 * @returns {Map<transactionId, number>} how much of each transaction is surplus, as a magnitude
 */
function buildSplitAmounts(items, months, profile, sparseCategories, skipCategory = () => false) {
  const splits = new Map();
  const byCategoryMonth = new Map();
  items.forEach((t) => {
    const category = categoryName(t);
    if (sparseCategories.has(category) || skipCategory(category)) return;
    const key = `${category}${CATEGORY_SEPARATOR}${getPayMonth(t)}`;
    if (!byCategoryMonth.has(key)) byCategoryMonth.set(key, []);
    byCategoryMonth.get(key).push(t);
  });

  profile.forEach((entry, category) => {
    if (sparseCategories.has(category) || skipCategory(category)) return;
    const active = months.filter((m) => entry.totals[m] > 0.001);
    if (active.length < SPLIT_MIN_ACTIVE_CYCLES) return;

    active.forEach((m) => {
      const usual = median(active.filter((other) => other !== m).map((other) => entry.totals[other]));
      if (!(usual > 0.001)) return;
      const over = (x) => (entry.totals[x] ?? 0) - usual > Math.max(usual * SPLIT_TOLERANCE, SPLIT_MIN_EXCESS);
      const excess = entry.totals[m] - usual;
      if (!over(m)) return;

      /**
       * An event stands out from the cycles either side of it. A level that persists is not an
       * event, it is the new level: a medical aid that starts at R10 000 shows up as two cycles
       * running far above a usual built from the months before it existed, and calling each of
       * them a surprise would be wrong twice — the second one especially, by which time it is
       * plainly what this category now costs. So a raised cycle next to another raised cycle is
       * left whole, and the category's usual catches up with it as the window moves on.
       */
      const at = months.indexOf(m);
      const neighbourRaised = [months[at - 1], months[at + 1]].some((x) => x && over(x));
      if (neighbourRaised) return;

      let left = excess;
      const rows = [...(byCategoryMonth.get(`${category}${CATEGORY_SEPARATOR}${m}`) ?? [])].sort(
        (a, b) => Math.abs(b.AmountNum) - Math.abs(a.AmountNum),
      );
      for (const t of rows) {
        if (left <= 0.005) break;
        const take = Math.min(Math.abs(t.AmountNum), left);
        splits.set(t.id, (splits.get(t.id) ?? 0) + take);
        left -= take;
      }
    });
  });

  return splits;
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

  const splitAmounts = new Map([
    // Pay is left whole. A cycle with two salary runs in it has not earned more; it has been paid
    // early or late, which the effective pay month and the vitals already account for. Splitting it
    // would take a real salary out of income and invent a deficit in the cycle it was paid for.
    ...buildSplitAmounts(incomeItems, months, incomeProfile, incomeSparseCategories, isSalaryCategory),
    ...buildSplitAmounts(expenseItems, months, expenseProfile, expenseSparseCategories),
  ]);

  const state = {
    incomeSparseCategories,
    expenseSparseCategories,
    splitAmounts,
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
  const { incomeSparseCategories, expenseSparseCategories, excessIds, transferIds } = state;

  if (isTransfer(transaction, transferIds)) return 'Transfers';

  // The surplus half of a split row is the exception itself — see buildSplitAmounts.
  const category = categoryName(transaction);
  const isSurplus = excessIds?.has(transaction.id) ?? false;
  const isExceptionIncome = isSurplus || incomeSparseCategories.has(category);
  const isExceptionExpense = isSurplus || expenseSparseCategories.has(category);

  if (transaction.AmountNum > 0) {
    return isExceptionIncome ? 'Income Exceptions' : 'Income';
  }

  if (transaction.AmountNum < 0) {
    return isExceptionExpense ? 'Expense Exceptions' : 'Expense';
  }

  return 'Transfers';
}
