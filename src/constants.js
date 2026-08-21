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
/**
 * Each older cycle gets this share of the previous one's weight in the average.
 * (The old AVG_RECENCY_INITIAL_WEIGHT was removed: it cancelled under normalisation, so it was a
 * knob that did nothing.)
 */
export const AVG_RECENCY_DECAY = 0.75;
/** Clamp each series to these percentiles before averaging, so one abnormal cycle can't set the level. */
export const WINSOR_LOWER = 0.1;
export const WINSOR_UPPER = 0.9;
/** Below this many observed cycles the percentiles are meaningless — average them as they are. */
export const WINSOR_MIN_OBSERVATIONS = 5;

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

/**
 * A scheduled payment is not just a category that shows up often — it repeats at a stable amount.
 * Dispersion is measured robustly (median absolute deviation over the median) so one double
 * payment doesn't disqualify a real debit order, and the gate is what separates "Vehicle Loan,
 * R4 991 every cycle" from "Clothing, somewhere between R100 and R4 202".
 */
export const MISSED_MAX_AMOUNT_DISPERSION = 0.25;
/** And it lands in nearly every cycle, not merely a majority of them. */
export const MISSED_MIN_OCCURRENCE_RATE = 0.8;

/** Days behind before the staleness badge escalates from a note to a warning, then to an alarm. */
export const STALE_WARN_DAYS = 3;
export const STALE_ALARM_DAYS = 7;

export const GROUP_ORDER = [
  'Income',
  'Expense',
  'Transfers',
  'Income Exceptions',
  'Expense Exceptions',
];
