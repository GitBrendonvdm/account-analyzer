import { parseMonthKey } from '../utils/date';

/**
 * Pay-cycle boundaries.
 *
 * Payday is the 25th of the month; if the 25th lands on a weekend it rolls forward to the first
 * Monday after. A pay-cycle runs from one payday to the next, so the cycle for pay-month "YYYY-MM"
 * starts at the PRIOR month's payday and ends at that month's payday (the next pay boundary).
 *
 * These deterministic paydays anchor the weekly-envelope buckets and the "next pay" projection —
 * far more stable than inferring the boundary from the earliest transaction of each cycle.
 */

const DAY_MS = 86400000;
const PAYDAY_DATE = 25;

function daysBetween(from, to) {
  return Math.round((to - from) / DAY_MS);
}

/** The 25th of the given month, rolled forward to the first Monday if it falls on a weekend. */
export function paydayForMonth(year, monthIndex) {
  const d = new Date(year, monthIndex, PAYDAY_DATE);
  const dow = d.getDay(); // 0 = Sun, 6 = Sat
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return d;
}

/** Cycle start for a pay-month key = the prior month's payday. */
export function cycleStartForKey(key) {
  const { year, monthIndex } = parseMonthKey(key);
  return paydayForMonth(year, monthIndex - 1);
}

/** Cycle end (next pay boundary) for a pay-month key = that month's payday. */
export function cycleEndForKey(key) {
  const { year, monthIndex } = parseMonthKey(key);
  return paydayForMonth(year, monthIndex);
}

/** Payday-based start date for each pay-cycle, keyed by pay-month. */
export function cycleStarts(months) {
  const starts = {};
  months.forEach((m) => {
    starts[m] = cycleStartForKey(m);
  });
  return starts;
}

/** Length in days of the cycle for a pay-month key (start payday → next payday). */
export function cycleLengthForKey(key) {
  return daysBetween(cycleStartForKey(key), cycleEndForKey(key));
}

/** Current cycle-day for `asOf`, clamped into [0, cycleLen]. */
export function currentCycleDay(asOf, currentStart, cycleLen) {
  if (!currentStart) return cycleLen;
  return Math.max(0, Math.min(cycleLen, daysBetween(currentStart, asOf)));
}
