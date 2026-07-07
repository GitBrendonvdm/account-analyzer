import { parseTransactionDate } from '../utils/date';

/**
 * "Missed payment" detection.
 *
 * A category's recurring payment is *missed* when it reliably lands by a certain cycle-week,
 * that week has already passed in the current cycle, and nothing has landed for it yet.
 *
 * Detection ONLY — this flag currently has no effect on the estimate and is not rendered
 * anywhere. It exists so a future view can surface "you usually pay X by now and haven't".
 */

const DAY_MS = 86400000;
const WEEK_DAYS = 7;
// Only flag payments that recur in a clear majority of cycles — a miss on an occasional
// category isn't meaningful.
const MIN_OCCURRENCE_RATE = 0.6;
const MIN_OBSERVATIONS = 3;
// Flag only once we're past the week by which the payment has *usually* landed (75th percentile),
// so normal week-to-week drift isn't mistaken for a miss.
const LATE_PERCENTILE = 0.75;

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

/**
 * @param items       all transactions for one category (across cycles)
 * @param priorMonths raw pay-month keys excluding the current cycle
 * @param currentMonth raw pay-month key of the current (in-progress) cycle
 * @param starts      cycle start date keyed by raw pay-month
 * @param curDay      how many days into the current cycle we are
 * @returns true when the payment's usual week has passed with nothing landed this cycle
 */
export function isMissedThisCycle(items, priorMonths, currentMonth, starts, curDay) {
  if (!priorMonths.length) return false;

  // earliest cycle-week the category landed in, per prior cycle
  const occurrenceWeeks = [];
  priorMonths.forEach((m) => {
    const start = starts[m];
    const earliest = items
      .filter((t) => t['Pay Month'] === m)
      .map((t) => cycleWeekIndex(itemDate(t), start))
      .filter((w) => w != null)
      .sort((a, b) => a - b)[0];
    if (earliest != null) occurrenceWeeks.push(earliest);
  });

  if (occurrenceWeeks.length < MIN_OBSERVATIONS) return false;
  if (occurrenceWeeks.length / priorMonths.length < MIN_OCCURRENCE_RATE) return false;

  // already landed this cycle → not missed
  if (items.some((t) => t['Pay Month'] === currentMonth)) return false;

  const sorted = [...occurrenceWeeks].sort((a, b) => a - b);
  const usualLatestWeek = sorted[Math.floor((sorted.length - 1) * LATE_PERCENTILE)];
  const currentWeek = Math.floor(curDay / WEEK_DAYS);

  return currentWeek > usualLatestWeek;
}
