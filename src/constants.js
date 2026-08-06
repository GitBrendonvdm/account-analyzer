export const STORAGE_KEY = 'money-visualizer-state';

export const DESCRIPTION_SIMILARITY_THRESHOLD = 0.68;
/** Expense categories must appear in at least this share of visible months to stay regular. */
export const EXCEPTION_MONTH_RATIO = 0.35;
/** Income categories must appear in at least this share of visible months to stay regular. */
export const INCOME_EXCEPTION_MONTH_RATIO = 0.7;
/** Flag a transaction when its amount exceeds this multiple of the category's median monthly spend. */
export const OUTLIER_MULTIPLIER = 2.5;
/** Minimum absolute amount before outlier detection applies. */
export const OUTLIER_MIN_AMOUNT = 1000;
/** Income without a reliable category label is treated as exception income. */
export const UNCATEGORIZED_CATEGORY_LABELS = ['Uncategorized', 'Uncategorised'];
/** Latest prior month starts here, then each older month gets half the previous weight. */
export const AVG_RECENCY_INITIAL_WEIGHT = 0.4;
export const AVG_RECENCY_DECAY = 0.5;

/**
 * How much of the current week's remaining expectation follows the pace you're actually running at
 * versus reverting to the weekly average. 0 = ignore pace entirely, 1 = follow it completely.
 * Half keeps a floor under the estimate: one quiet start to a week isn't proof of a quiet week.
 */
export const PACE_BLEND = 0.5;
/**
 * At or below this median transactions-per-cycle a category is treated as discrete events (rent, a
 * debit order) rather than a stream of spend. Discrete categories are never prorated within a week
 * — a bill that always lands Friday must not be written off on Thursday.
 */
export const DISCRETE_MAX_TXN_PER_CYCLE = 3;
/** Below this much total spend (ZAR) a weekday shape is noise; fall back to a flat curve. */
export const WEEKDAY_CURVE_MIN_MASS = 1000;

export const GROUP_ORDER = [
  'Income',
  'Expense',
  'Transfers',
  'Income Exceptions',
  'Expense Exceptions',
];
