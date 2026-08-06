import {
  AVG_RECENCY_DECAY,
  DISCRETE_MAX_TXN_PER_CYCLE,
  PACE_BLEND,
  WEEKDAY_CURVE_MIN_MASS,
} from '../constants';
import { parseTransactionDate } from '../utils/date';

/**
 * Weekly-envelope projection.
 *
 * The rule is the user's: a COMPLETED week is locked at its actual spend — a quiet week is just a
 * quiet week, with no assumed catch-up. What was missing is that the CURRENT week is partly
 * history too. `weekGap(actual, avg)` took no date, so on a Thursday it projected the same
 * full-week top-up it would have on Monday morning. Since spend is heavily front-loaded, that
 * over-projected badly.
 *
 *   projected cycle total = Σ actual(completed weeks)
 *                         + the part of this week that hasn't happened yet
 *                         + Σ average(future weeks)
 *
 * Two kinds of category behave differently inside the current week:
 *
 *   VARIABLE (groceries, fuel — several transactions a cycle): the week's expectation is prorated
 *     by the historical Mon→Sun spend shape, then blended with the pace you're actually running at.
 *   DISCRETE (rent, insurance — one transaction a cycle): NOT prorated. A debit order that always
 *     lands on Friday must not be written off on Thursday, so it keeps its full expectation until
 *     the money actually arrives.
 *
 * Columns stay Monday-aligned because that's how the weeks are read. But prior cycles are mapped
 * onto those columns by DAY-OF-CYCLE, not by week index: cycles hold 4, 5 or 6 Monday-weeks
 * depending on which weekday the 23rd falls on, so indexing by week number folded a 6-week cycle's
 * tail into the 5th column and counted a 4-week cycle's missing 5th column as an observed zero.
 * Day-of-cycle is stable across cycles (rent on the 1st is always ~day 9) and conserves the total.
 */

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

function itemDate(t) {
  return t.DateObj ?? parseTransactionDate(t.Date);
}

/** Midnight on the Monday of the week containing `date`. */
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  d.setDate(d.getDate() - dow);
  return d;
}

/** 0 = Mon … 6 = Sun. */
export function mondayIndexOfDay(date) {
  return (date.getDay() + 6) % 7;
}

/** How many Mon–Sun weeks `date` sits after the cycle-start's week (0 = cycle-start's own week). */
export function mondayWeekIndex(date, cycleStart) {
  if (!date || !cycleStart) return null;
  return Math.round((mondayOf(date) - mondayOf(cycleStart)) / WEEK_MS);
}

/** 1-based day of the cycle a date falls on. */
function dayOfCycle(date, start) {
  return Math.round((mondayOf(date) - mondayOf(start)) / DAY_MS) + mondayIndexOfDay(date)
    - mondayIndexOfDay(start) + 1;
}

/**
 * The day-of-cycle span each Monday-week column covers, e.g. for a cycle starting Thu 23 Jul:
 * [{lo:1,hi:4}, {lo:5,hi:11}, …]. Prior cycles are bucketed against these spans.
 */
export function weekDayRanges(cycleStart, cycleEnd) {
  if (!cycleStart || !cycleEnd) return [{ lo: 1, hi: 7 }];
  const length = Math.round((cycleEnd - cycleStart) / DAY_MS) + 1;
  const lead = 7 - mondayIndexOfDay(cycleStart); // days from the start to the coming Sunday
  const ranges = [];
  let lo = 1;
  while (lo <= length) {
    const hi = Math.min(length, ranges.length === 0 ? lead : lo + 6);
    ranges.push({ lo, hi });
    lo = hi + 1;
  }
  return ranges.length ? ranges : [{ lo: 1, hi: length }];
}

function recencyWeights(count) {
  return Array.from({ length: count }, (_, i) => AVG_RECENCY_DECAY ** i);
}

/**
 * Recency-weighted average spend per week column, across prior cycles.
 * Only cycles in which the category was actually present contribute to the level; see
 * `expected.js` for the presence factor applied on top.
 */
export function buildWeeklyAvg(items, priorMonths, starts, dayRanges) {
  const weekCount = dayRanges.length;
  const byMonth = new Map();
  items.forEach((t) => {
    const m = t['Pay Month'];
    if (!starts[m]) return;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(t);
  });

  const perCycle = priorMonths.map((m) => {
    const start = starts[m];
    const wk = new Array(weekCount).fill(0);
    (byMonth.get(m) ?? []).forEach((t) => {
      const d = itemDate(t);
      if (!d) return;
      const day = dayOfCycle(d, start);
      let idx = dayRanges.findIndex((r) => day >= r.lo && day <= r.hi);
      // A longer prior cycle overflows the last column; a pre-boundary date falls into the first.
      if (idx === -1) idx = day < 1 ? 0 : weekCount - 1;
      wk[idx] += t.AmountNum;
    });
    return wk;
  });

  const weights = recencyWeights(perCycle.length);
  const weekAvg = new Array(weekCount).fill(0);
  for (let w = 0; w < weekCount; w++) {
    let sum = 0;
    let total = 0;
    [...perCycle].reverse().forEach((wk, i) => {
      sum += wk[w] * weights[i];
      total += weights[i];
    });
    weekAvg[w] = total ? sum / total : 0;
  }
  return weekAvg;
}

/**
 * Cumulative share of a week's spend landed by the end of each weekday (index 0 = Mon).
 * Built once per flow — a per-category weekday profile would be noise at ~25 observations.
 * Falls back to a flat curve when there isn't enough mass to say anything.
 */
export function buildWeekdayCurve(items, priorMonths) {
  const months = new Set(priorMonths);
  const mass = new Array(7).fill(0);
  let total = 0;
  items.forEach((t) => {
    if (!months.has(t['Pay Month'])) return;
    const d = itemDate(t);
    if (!d) return;
    const m = Math.abs(t.AmountNum);
    mass[mondayIndexOfDay(d)] += m;
    total += m;
  });

  if (total < WEEKDAY_CURVE_MIN_MASS) {
    return Array.from({ length: 7 }, (_, i) => (i + 1) / 7);
  }
  const cumulative = [];
  let running = 0;
  for (let i = 0; i < 7; i += 1) {
    running += mass[i] / total;
    cumulative.push(Math.min(1, running));
  }
  cumulative[6] = 1;
  return cumulative;
}

/**
 * Does this category arrive as a handful of discrete events (a debit order) or as a stream of
 * small purchases? Median transactions per cycle in the cycles where it appeared at all.
 */
export function isDiscreteCadence(items, priorMonths) {
  const months = new Set(priorMonths);
  const counts = new Map();
  items.forEach((t) => {
    const m = t['Pay Month'];
    if (!months.has(m)) return;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  });
  if (counts.size === 0) return true; // no history — treat as an event, don't prorate it away
  const sorted = [...counts.values()].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  return median <= DISCRETE_MAX_TXN_PER_CYCLE;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * What's still to come in the current week.
 *
 * All arithmetic is in magnitudes against a fixed `sign` for the row, so a refund can never be
 * mistaken for "already over budget" — the old `Math.abs(actual) >= Math.abs(avg)` test returned 0
 * remaining whenever a large opposite-signed entry landed.
 *
 * `elapsedShare` is measured at today (how much of the week is calendar-gone) while `observedShare`
 * is measured at the last date the data covers. They differ when the export is stale, and using
 * today for both would compare spend-so-far against a window the data doesn't reach — biasing the
 * pace ratio down and under-projecting.
 */
function currentWeekRemaining({ actual, avg, sign, curve, asOf, dataThrough, weekStart, discrete }) {
  const E = Math.max(0, avg * sign);
  const A = Math.max(0, actual * sign);
  if (E <= 0) return 0;

  // A bill keeps its full expectation until the money actually lands.
  if (discrete) return Math.max(0, E - A) * sign;

  const elapsedShare = asOf >= weekStart ? curve[Math.min(6, mondayIndexOfDay(asOf))] : 0;
  const observedShare =
    dataThrough && dataThrough >= weekStart ? curve[Math.min(6, mondayIndexOfDay(dataThrough))] : 0;

  const base = E * (1 - elapsedShare);
  const expectedByNow = E * observedShare;
  // Under-running so far suggests you'll keep under-running — but only half-weight it, because a
  // single quiet start to a week isn't proof, and PACE_BLEND keeps a floor under the estimate.
  const pace = expectedByNow > 0 ? clamp(A / expectedByNow, 0, 1) : 1;
  return base * (PACE_BLEND * pace + (1 - PACE_BLEND)) * sign;
}

/**
 * Remaining spend per week column under the envelope model. Weeks before the current one are 0
 * (locked at actuals); the current week is time-aware; future weeks carry their averages.
 * Indexed 0..weekCount-1; the sum is the total remaining for the cycle.
 */
export function weeklyRemainingByWeek(
  items,
  currentMonth,
  starts,
  currentWeek,
  weekAvg,
  { sign = -1, weekdayCurve, asOf, dataThrough, dayRanges, discrete = false } = {},
) {
  const start = starts[currentMonth];
  const ranges = dayRanges ?? [];

  let currentWeekActual = 0;
  items.forEach((t) => {
    if (t['Pay Month'] !== currentMonth) return;
    const d = itemDate(t);
    if (!d || !start) return;
    const day = dayOfCycle(d, start);
    const range = ranges[currentWeek];
    if (range ? day >= range.lo && day <= range.hi : mondayWeekIndex(d, start) === currentWeek) {
      currentWeekActual += t.AmountNum;
    }
  });

  const weekStart =
    start && ranges[currentWeek]
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + ranges[currentWeek].lo - 1)
      : start;

  return weekAvg.map((avg, w) => {
    if (w < currentWeek) return 0; // elapsed — locked at actuals
    if (w === currentWeek) {
      return currentWeekRemaining({
        actual: currentWeekActual,
        avg,
        sign,
        curve: weekdayCurve ?? Array.from({ length: 7 }, (_, i) => (i + 1) / 7),
        asOf,
        dataThrough,
        weekStart,
        discrete,
      });
    }
    return avg; // future week — full expected
  });
}
