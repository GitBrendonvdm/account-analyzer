import { MISSED_MAX_AMOUNT_DISPERSION, MISSED_MIN_OCCURRENCE_RATE } from '../constants';
import { parseTransactionDate } from '../utils/date';

/**
 * "Missed payment" detection.
 *
 * A category's recurring payment is *missed* when it reliably lands by a certain cycle-week,
 * that week has already passed in the current cycle, and nothing has landed for it yet.
 *
 * The original test was presence alone — a category appearing in 60% of cycles counted as a
 * scheduled payment. On real data that flagged nine categories at once, most of which are nothing
 * of the kind: Clothing (R100 to R4 202 depending on the month), Investments (R1 000, R1 000,
 * R5 000), General Purchases (R765 to R56 206). What actually distinguishes a bill is that the
 * AMOUNT repeats, so presence is now only half the test:
 *
 *   Vehicle Loan   4991 / 4991 / 4991 / 4991 / 4991 / 4991   dispersion 0.00  → a bill
 *   Bank Charges   1460 / 1465 / 1071 / 1163 / 1180 / 1124   dispersion 0.06  → a bill
 *   Clothing       2006 / 1227 /  100 / 4202                 dispersion 0.59  → not a bill
 *
 * Dispersion is median-absolute-deviation over the median rather than a standard deviation, so a
 * single doubled instalment (5140 / 5140 / 10420 / 5340 / 5140) doesn't disqualify a payment that
 * is otherwise perfectly regular.
 */

const DAY_MS = 86400000;
const WEEK_DAYS = 7;
const MIN_OBSERVATIONS = 3;
// Flag only once we're past the week by which the payment has *usually* landed (75th percentile),
// so normal week-to-week drift isn't mistaken for a miss.
const LATE_PERCENTILE = 0.75;

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median absolute deviation as a share of the median. 0 = every cycle charged the same amount.
 * Returns Infinity when there is no level to compare against, so an all-zero category can't
 * masquerade as perfectly regular.
 */
export function amountDispersion(values) {
  const magnitudes = values.map((v) => Math.abs(v));
  const mid = median([...magnitudes].sort((a, b) => a - b));
  if (mid <= 0) return Infinity;
  const deviations = magnitudes.map((v) => Math.abs(v - mid)).sort((a, b) => a - b);
  return median(deviations) / mid;
}

function itemDate(t) {
  return parseTransactionDate(t.Date);
}

// Which cycle-week (0-indexed: week 1 = days 0-6) a date falls in, relative to its cycle start.
function cycleWeekIndex(date, start) {
  if (!date || !start) return null;
  const day = Math.floor((date - start) / DAY_MS);
  if (day < 0) return null;
  return Math.floor(day / WEEK_DAYS);
}

/** Below this a category is rounding error, not a bill worth reasoning about. */
const MIN_BILL_AMOUNT = 50;
/** With few observations the median absolute deviation can read 0 for a plainly irregular series. */
const FEW_OBSERVATIONS = 5;
const MAX_RANGE_RATIO = 3;

/**
 * Does this look like a payment that repeats at the same amount?
 *
 * Median absolute deviation alone is too forgiving on short series: Investments charged
 * 5 000 / 1 000 / 1 000, and because two of the three sit exactly on the median the MAD is zero.
 * So below five observations the spread between largest and smallest has to be modest as well.
 */
export function isRegularAmount(values) {
  const magnitudes = values.map((v) => Math.abs(v)).filter((v) => v > 0);
  if (magnitudes.length === 0) return false;
  const mid = median([...magnitudes].sort((a, b) => a - b));
  if (mid < MIN_BILL_AMOUNT) return false;
  if (amountDispersion(magnitudes) > MISSED_MAX_AMOUNT_DISPERSION) return false;
  if (magnitudes.length < FEW_OBSERVATIONS) {
    const lo = Math.min(...magnitudes);
    const hi = Math.max(...magnitudes);
    if (lo <= 0 || hi / lo > MAX_RANGE_RATIO) return false;
  }
  return true;
}

/**
 * @param items       all transactions for one category (across cycles)
 * @param priorMonths raw pay-month keys excluding the current cycle
 * @param currentMonth raw pay-month key of the current (in-progress) cycle
 * @param starts      cycle start date keyed by raw pay-month
 * @param observedDay how many days into the current cycle the DATA reaches — not the wall clock.
 *                    A payment can only be seen to have landed up to the export's last date, so
 *                    measuring lateness against today would call every unexported bill overdue.
 * @returns true when the payment's usual week has passed with nothing landed this cycle
 */
export function isMissedThisCycle(items, priorMonths, currentMonth, starts, observedDay) {
  if (!priorMonths.length) return false;

  // earliest cycle-week the category landed in, and what it charged, per prior cycle
  const occurrenceWeeks = [];
  const cycleTotals = [];
  priorMonths.forEach((m) => {
    const start = starts[m];
    const inMonth = items.filter((t) => t['Pay Month'] === m);
    const earliest = inMonth
      .map((t) => cycleWeekIndex(itemDate(t), start))
      .filter((w) => w != null)
      .sort((a, b) => a - b)[0];
    if (earliest != null) {
      occurrenceWeeks.push(earliest);
      cycleTotals.push(inMonth.reduce((sum, t) => sum + t.AmountNum, 0));
    }
  });

  if (occurrenceWeeks.length < MIN_OBSERVATIONS) return false;
  if (occurrenceWeeks.length / priorMonths.length < MISSED_MIN_OCCURRENCE_RATE) return false;
  // A bill charges the same amount. Discretionary spend that merely recurs does not.
  if (!isRegularAmount(cycleTotals)) return false;

  // already landed this cycle → not missed
  if (items.some((t) => t['Pay Month'] === currentMonth)) return false;

  const sorted = [...occurrenceWeeks].sort((a, b) => a - b);
  const usualLatestWeek = sorted[Math.floor((sorted.length - 1) * LATE_PERCENTILE)];
  const observedWeek = Math.floor(observedDay / WEEK_DAYS);

  return observedWeek > usualLatestWeek;
}
