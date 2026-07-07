import { AVG_RECENCY_DECAY, AVG_RECENCY_INITIAL_WEIGHT } from '../constants';
import { parseTransactionDate } from '../utils/date';

/**
 * Weekly-envelope projection, bucketed by MONDAY-aligned calendar weeks.
 *
 * We lock each COMPLETED week at its actual spend (a quiet week is just a quiet week — no assumed
 * catch-up) and only carry expectations for the current partial week and the weeks still ahead:
 *
 *   projected cycle total = Σ actual(completed weeks)
 *                         + max(actual, average) for the current week
 *                         + Σ average(future weeks)
 *
 * Weeks are indexed by how many Mon–Sun weeks they sit after the cycle-start's week, so a bill that
 * lands in the same calendar week each cycle averages into the same index. `average(week w)` is the
 * recency-weighted mean of that week's spend across prior cycles.
 */

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

function itemDate(t) {
  return parseTransactionDate(t.Date);
}

/** Midnight on the Monday of the week containing `date`. */
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  d.setDate(d.getDate() - dow);
  return d;
}

/** How many Mon–Sun weeks `date` sits after the cycle-start's week (0 = cycle-start's own week). */
export function mondayWeekIndex(date, cycleStart) {
  if (!date || !cycleStart) return null;
  return Math.round((mondayOf(date) - mondayOf(cycleStart)) / WEEK_MS);
}

/** Recency-weighted average spend per Monday-week index, across prior cycles. */
export function buildWeeklyAvg(items, priorMonths, starts, weekCount) {
  const perCycle = priorMonths.map((m) => {
    const start = starts[m];
    const wk = new Array(weekCount).fill(0);
    items.forEach((t) => {
      if (t['Pay Month'] !== m) return;
      const w = mondayWeekIndex(itemDate(t), start);
      if (w == null) return;
      // Clamp into range: a few pre-payday transactions (negative) fold into week 0; overflow
      // beyond the last week folds into it.
      wk[Math.max(0, Math.min(w, weekCount - 1))] += t.AmountNum;
    });
    return wk;
  });

  const weekAvg = new Array(weekCount).fill(0);
  for (let w = 0; w < weekCount; w++) {
    let ws = 0;
    let wt = 0;
    [...perCycle].reverse().forEach((wk, i) => {
      const weight = AVG_RECENCY_INITIAL_WEIGHT * AVG_RECENCY_DECAY ** i;
      ws += wk[w] * weight;
      wt += weight;
    });
    weekAvg[w] = wt ? ws / wt : 0;
  }
  return weekAvg;
}

/** Gap to a week's average (0 once you're already over it); sign-aware for income/expense. */
function weekGap(actual, avg) {
  return Math.abs(actual) >= Math.abs(avg) ? 0 : avg - actual;
}

/**
 * Remaining spend PER Monday-week under the envelope model. Weeks before the current one contribute
 * 0 (locked at actuals); the current week tops up to its average; future weeks carry their full
 * averages. Indexed 0..weekCount-1; the sum is the total remaining for the cycle.
 */
export function weeklyRemainingByWeek(items, currentMonth, starts, currentWeek, weekAvg) {
  const start = starts[currentMonth];

  let currentWeekActual = 0;
  items.forEach((t) => {
    if (t['Pay Month'] !== currentMonth) return;
    if (mondayWeekIndex(itemDate(t), start) === currentWeek) currentWeekActual += t.AmountNum;
  });

  return weekAvg.map((avg, w) => {
    if (w < currentWeek) return 0; // already-elapsed week — locked, nothing left
    if (w === currentWeek) return weekGap(currentWeekActual, avg); // top up to this week's average
    return avg; // future week — full expected
  });
}
