import { quantile } from './stats';
import { parseTransactionDate } from '../utils/date';

/**
 * How wrong the forecast could reasonably be, taken from what actually happened.
 *
 * A single number for "where this cycle closes" reads as a promise, and it is not one — it is the
 * middle of a spread. The band around it is NOT a widened average: it is the plain historical
 * distribution of the quantity being forecast. For each prior cycle, this sums what the row
 * actually spent from the SAME cycle day to the end of that cycle. Twelve cycles give twelve
 * observations of "what the rest of a cycle costs from day 18", and the low and high are
 * percentiles of exactly those. Nothing is modelled, so nothing can be modelled wrongly, and the
 * sentence under the figure is literally true of the file.
 *
 * WHY THE PER-CYCLE ARRAY IS THE UNIT and not the low/high pair. Percentiles do not add: a group's
 * p90 is not the sum of its categories' p90s, because the categories do not all have their bad
 * cycle at the same time — summing them would invent a worst case no cycle ever had. So a level of
 * the table combines its children's arrays cycle by cycle first, and takes percentiles of the
 * total. `combine` is that addition, and it is why Net Total's band is honest about income and
 * spend moving together rather than adding two independent extremes.
 *
 * The MID is never computed here. It stays the weekly envelope's own figure, so the Forecast
 * column continues to equal "so far + left to payday" exactly and the table still reconciles; this
 * only says how much room is around it.
 *
 * A range that does not contain the figure it brackets reads as a bug to every reader who meets it,
 * so the band is widened to include the mid when the two disagree. That happens when the cycle is
 * genuinely running outside anything the last twelve did, which is worth knowing rather than
 * hiding, so `midOutside` records it and the caller can say so.
 */

const DAY_MS = 86400000;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const itemDate = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const defaultMonthOf = (t) => t['Pay Month'];

/**
 * Fewer than this many prior cycles and there is nothing to say. Three is low for a percentile —
 * at three points p10 and p90 are barely inside the observed range — but the window is the month
 * slider's, deliberately: processTransactionData keeps display and arithmetic on one window because
 * a slider that moves the columns but not the figures reads as broken. A reader who narrows to four
 * cycles should still get the band those four cycles support, and the tooltip always names the
 * count so the claim stays exactly as strong as its evidence.
 */
export const BAND_MIN_CYCLES = 3;
/** The band's edges. Wide enough to be worth reading, narrow enough not to be a truism. */
export const BAND_LOW = 0.1;
export const BAND_HIGH = 0.9;

/** 1-based day of the cycle a date falls on, counting from `start`. */
function dayOfCycle(date, start) {
  return Math.round((midnight(date) - midnight(start)) / DAY_MS) + 1;
}

/**
 * What this row spent from `fromDay` to the end of each prior cycle — one number per cycle, in
 * `priorMonths` order, signed like the rows themselves.
 *
 * @param items       the row's transactions (any cycle)
 * @param priorMonths completed cycle keys, oldest first
 * @param starts      { [cycleKey]: Date } cycle starts
 * @param fromDay     1-based cycle day to count from (the day the current cycle has reached)
 */
export function remainderPerCycle(items, priorMonths, starts, fromDay, { monthOf = defaultMonthOf } = {}) {
  const totals = new Map(priorMonths.map((m) => [m, 0]));
  (items ?? []).forEach((t) => {
    const m = monthOf(t);
    if (!totals.has(m)) return;
    const start = starts?.[m];
    const d = itemDate(t);
    if (!start || !d) return;
    if (dayOfCycle(d, start) < fromDay) return;
    totals.set(m, totals.get(m) + t.AmountNum);
  });
  return priorMonths.map((m) => totals.get(m) ?? 0);
}

/** Element-wise sum of several per-cycle arrays — the only correct way to roll a band up a level. */
export function combine(arrays) {
  const kept = (arrays ?? []).filter((a) => Array.isArray(a) && a.length);
  if (!kept.length) return [];
  const length = Math.max(...kept.map((a) => a.length));
  return Array.from({ length }, (_, i) => kept.reduce((sum, a) => sum + (a[i] ?? 0), 0));
}

/**
 * The band around a forecast: `mid` plus the low and high the same row's history has actually run.
 *
 * @param soFar     what this cycle has already booked for the row
 * @param mid       the envelope's remaining figure (so `soFar + mid` is the Forecast column)
 * @param remainder per-cycle remainders from `remainderPerCycle` / `combine`
 * @returns {{ low, mid, high, remainingLow, remainingMid, remainingHigh, midOutside, cycles }} in
 *          the row's own sign, or null when there is too little history to say anything — a band
 *          nobody can stand behind is worse than none.
 */
export function forecastBand(soFar, mid, remainder) {
  const observations = (remainder ?? []).filter((v) => Number.isFinite(v));
  if (observations.length < BAND_MIN_CYCLES) return null;
  const lo = quantile(observations, BAND_LOW);
  const hi = quantile(observations, BAND_HIGH);
  const midTotal = soFar + mid;
  // Sign-agnostic: for spend (negative) the "low" quantile is the larger magnitude, so the band is
  // ordered by value at the end rather than assumed.
  const histLow = Math.min(soFar + lo, soFar + hi);
  const histHigh = Math.max(soFar + lo, soFar + hi);
  return {
    low: Math.min(histLow, midTotal),
    mid: midTotal,
    high: Math.max(histHigh, midTotal),
    // The same range with what has already landed taken back off: what is STILL to come. That is
    // the more actionable of the two figures — "R22 991 left to payday" is a claim about a fortnight
    // nobody can make exactly — so it carries a range of its own rather than a bare number.
    remainingLow: Math.min(lo, hi, mid),
    remainingMid: mid,
    remainingHigh: Math.max(lo, hi, mid),
    midOutside: midTotal < histLow || midTotal > histHigh,
    cycles: observations.length,
  };
}
