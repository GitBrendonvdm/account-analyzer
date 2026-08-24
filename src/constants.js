export const STORAGE_KEY = 'money-visualizer-state';

export const DESCRIPTION_SIMILARITY_THRESHOLD = 0.68;
/** Expense categories must appear in at least this share of visible months to stay regular. */
export const EXCEPTION_MONTH_RATIO = 0.35;
/** Income categories must appear in at least this share of visible months to stay regular. */
export const INCOME_EXCEPTION_MONTH_RATIO = 0.7;
/**
 * Splitting a cycle that ran above its usual.
 *
 * A category that normally costs R10 000 and cost R15 000 this cycle has not become a R15 000
 * category: R10 000 of it is the usual and R5 000 is the event. The usual stays where it is and
 * only the surplus is treated as an exception, so the averages, the forecast and safe-to-spend
 * keep describing the ordinary month while the surprise is still visible and still counted.
 */
/** A category needs this many cycles of its own history before "usual" means anything. */
export const SPLIT_MIN_ACTIVE_CYCLES = 3;
/** How far above its usual a cycle has to run before the surplus is called an event. */
export const SPLIT_TOLERANCE = 0.25;
/** And by at least this many rand, so an ordinary wobble is not one. */
export const SPLIT_MIN_EXCESS = 1000;
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

/**
 * Colours for overlaid pay cycles. Three clearly separated hues rather than three shades of one —
 * neighbouring blues read as the same line at a glance, which defeats the comparison. Order is
 * newest first: the current cycle is the blue.
 */
export const CYCLE_TONES = ['#0a84ff', '#ff9f0a', '#63e6e2', '#ff375f'];

export const GROUP_ORDER = [
  'Income',
  'Expense',
  'Transfers',
  'Income Exceptions',
  'Expense Exceptions',
];

/* ------------------------------------------------------------------------------------------------
 * Analytics thresholds (the debt / savings / cash-flow build). Each block names the module that
 * reads it; the values are the ones the spec fixed, and the modules import them rather than
 * carrying their own copies so that tuning happens in one place.
 * ---------------------------------------------------------------------------------------------- */

/* ---- lib/cadence.js: inter-charge interval classifier ---------------------------------------- */
/**
 * Gaps are calendar days between consecutive distinct dates; `lo..hi` bounds the MEDIAN gap and
 * `mad` caps the median absolute deviation. MAD rather than a mean so one skipped month (a ~62-day
 * gap among 31s) leaves a monthly charge monthly. Annual is judged by every gap, not the median.
 */
export const CADENCE_RULES = [
  { cadence: 'weekly', lo: 5, hi: 9, mad: 3, perYear: 52 },
  { cadence: 'fortnightly', lo: 12, hi: 16, mad: 3, perYear: 26 },
  { cadence: 'monthly', lo: 26, hi: 35, mad: 4, perYear: 12 },
  { cadence: 'bimonthly', lo: 55, hi: 70, mad: 6, perYear: 6 },
  { cadence: 'quarterly', lo: 85, hi: 100, mad: 8, perYear: 4 },
  { cadence: 'annual', lo: 340, hi: 390, mad: null, perYear: 1 },
];
export const CADENCE_MIN_OBSERVATIONS = 3;
export const CADENCE_ANNUAL_MIN_OBSERVATIONS = 2;

/* ---- lib/merchants.js: truncation variants of one merchant key ------------------------------- */
/** A key shorter than this is too generic to be a safe prefix ("spar" must not absorb "spar ma"). */
export const MERGE_PREFIX_MIN_LENGTH = 6;

/* ---- lib/ledger.js and lib/inferRates.js: loan self-anchoring -------------------------------- */
export const SELF_ANCHOR_MIN_MULTIPLE = 20;
export const SELF_ANCHOR_MIN_DRAW = 50000;
export const SELF_ANCHOR_FIRST_ROWS = 5;

/* ---- lib/recurring.js: the recurring-charge engine ------------------------------------------- */
export const AMOUNT_CLUSTER_MIN_GAP = 2;
export const AMOUNT_CLUSTER_TOLERANCE = 0.025;
export const REGIME_CHAIN_MAX_GAP_DAYS = 45;
export const PRICE_STEP_MIN_PCT = 0.04;
export const PRICE_STEP_MIN_RAND = 10;
export const RECURRING_PRESENCE_WINDOW = 12;
export const RECURRING_MIN_PRESENCE_MONTHLY = 0.6;
export const RECURRING_MIN_PRESENCE_WEEKLY = 0.5;
export const LAPSED_GAP_FACTOR = 1.5;
export const LAPSED_IRREGULAR_DAYS = 90;
export const STATUS_LANDED_WINDOW_DAYS = 5;
export const STATUS_OVERDUE_GRACE_DAYS = 3;
export const CONFIDENCE_HIGH = 0.8;
export const CONFIDENCE_MEDIUM = 0.5;
/** Categories the export gives loan instalments — the paying leg on a bank account. */
export const LOAN_CATEGORIES = ['Home Loan / Bond', 'Vehicle Loan / Car Loan', 'Personal Loan'];

/* ---- lib/inferRates.js: liability terms --------------------------------------------------------- */
export const RATE_MEDIAN_POSTINGS = 3;
export const RATE_VARIABLE_MIN_PP = 0.001;
export const RATE_STEP_MIN_PP = 0.0015;
export const REGRESSION_MIN_R2 = 0.99;
export const REGRESSION_MIN_POSTINGS = 8;
export const INSTALMENT_PAIR_WINDOW_DAYS = 5;
export const INSTALMENT_PAIR_TOLERANCE = 0.2;
export const INSTALMENT_LOOKBACK_POSTINGS = 6;
export const FEE_MAX_AMOUNT = 5000;
/** Annual nominal rates assumed when nothing can be inferred and nothing was typed. */
export const DEFAULT_RATE_BY_KIND = { bond: 0.11, vehicle: 0.125, personal: 0.18, card: 0.2075, loan: 0.13 };
/** National Credit Act maximum margins over the repo rate, by kind of credit. */
export const NCA_CAP_MARGIN = { bond: 0.12, card: 0.14, vehicle: 0.17, personal: 0.21, loan: 0.21 };
export const PRIME_REPO_SPREAD = 0.035;
export const CARD_MINIMUM_PCT_DEFAULT = 5;
export const CARD_MINIMUM_FLOOR = 50;

/* ---- lib/debtPlan.js: the amortisation engine ----------------------------------------------- */
export const DEBT_HORIZON_CAP = 600;
export const DEBT_EPS = 0.005;
export const MARGINAL_AMOUNT_DEFAULT = 1000;
export const MARGINAL_HORIZON_MONTHS = 12;
export const RATE_SENSITIVITY_SHIFTS_BP = [-100, -50, -25, 0, 25, 50, 100];
export const NEVER_CLEARS_WARN_BP = 75;
export const DEBT_BUDGET_CYCLES = 6;

/* ---- lib/solver.js: "what would it take" bisection ------------------------------------------ */
export const SOLVER_TOLERANCE = 10;
export const SOLVER_MAX_ITER = 40;

/* ---- lib/subscriptions.js: recurring audit, new and lapsed charges -------------------------- */
export const NEW_LINE_CYCLES = 3;
export const NEW_LINE_HEADLINE_MIN = 1000;
export const TRIAL_MAX_FIRST = 10;
export const TRIAL_MIN_RATIO = 10;
export const DUE_SOON_DAYS = 7;

/* ---- lib/priceCreep.js --------------------------------------------------------------------- */
export const PRICE_CREEP_MIN_CYCLES = 6;
export const PRICE_VARIABLE_MAX_SINGLETON_SHARE = 0.3;

/* ---- lib/basket.js: trips versus ticket ----------------------------------------------------- */
/** Cycles per comparison window; two windows are needed, so 12 complete cycles enable the split. */
export const BASKET_WINDOW = 6;
export const BASKET_CATEGORIES = [
  'Groceries',
  'Transport & Fuel',
  'Eating Out & Takeaways',
  'Coffee',
  'Personal Care',
  'Pets',
  'Alcohol',
];
export const BASKET_MIN_TICKET = 20;

/* ---- lib/drift.js: category drift, median + MAD --------------------------------------------- */
export const DRIFT_RECENT_CYCLES = 3;
export const DRIFT_BASELINE_CYCLES = 12;
export const DRIFT_MIN_BASELINE_CYCLES = 6;
export const DRIFT_SD_FLOOR_SHARE = 0.05;
export const DRIFT_SD_FLOOR_RAND = 50;
export const DRIFT_MIN_Z = 2.5;
export const DRIFT_MIN_DELTA = 300;
export const DRIFT_MIN_BASELINE = 200;

/* ---- lib/fees.js --------------------------------------------------------------------------- */
export const FEES_RUN_RATE_CYCLES = 6;

/* ---- lib/savingsFinder.js ------------------------------------------------------------------ */
export const SAVINGS_CONFIDENCE_WEIGHT = { high: 1, medium: 0.6, low: 0.25 };

/* ---- lib/upcoming.js: the bills calendar --------------------------------------------------- */
export const UPCOMING_DAYS = 30;

/* ---- lib/incomeProfile.js ------------------------------------------------------------------ */
export const INCOME_HISTORY_CYCLES = 12;
export const INCOME_REFUND_WINDOW_DAYS = 60;
export const INCOME_INTEREST_MAX = 50;
export const INCOME_BAND_TOLERANCE = 0.15;
export const SALARY_SHARE_MIN = 0.4;
export const LATE_DAYS = 3;

/* ---- lib/vitals.js: vitals and direction ---------------------------------------------------- */
export const VITALS_SHORT = 3;
export const VITALS_LONG = 12;
export const SAVINGS_RATE_GREEN = 0.1;
export const SAVINGS_RATE_AMBER = 0;
export const DSR_AMBER = 0.3;
export const DSR_RED = 0.4;
export const BURDEN_AMBER = 0.1;
export const BURDEN_RED = 0.2;
export const RUNWAY_AMBER = 1;
export const RUNWAY_GREEN = 3;
export const CREDIT_RUNWAY_AMBER = 3;
export const CREDIT_RUNWAY_GREEN = 6;
export const UTIL_AMBER = 0.3;
export const UTIL_RED = 0.75;
export const DEFICIT_RED_SHARE = 0.05;
export const VITALS_NOISE_PP = 0.02;
export const RUNWAY_NOISE = 0.25;
export const UTIL_NOISE = 0.05;
export const INCOME_SHIFTED_SHARE = 0.25;
export const DIRECTION_NOISE_SHARE = 0.02;
export const DIRECTION_NOISE_RAND = 500;

/* ---- lib/cashToPayday.js ------------------------------------------------------------------- */
export const CASH_EXTEND_DAYS = 7;
export const CASH_HISTORY_CYCLES = 6;
export const CASH_SMOOTH_DAYS = 3;
export const LATE_SALARY_MIN_RISK = 0.05;
