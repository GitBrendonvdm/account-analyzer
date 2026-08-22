import {
  CADENCE_ANNUAL_MIN_OBSERVATIONS,
  CADENCE_MIN_OBSERVATIONS,
  CADENCE_RULES,
} from '../constants';
import { mad, median, mode } from './stats';

/**
 * How often does this thing happen?
 *
 * The export has no notion of a subscription, a salary or a debit order — only rows with dates.
 * Everything the app wants to say about recurrence ("monthly, on the 1st", "weekly", "charged
 * twice, about a month apart") comes from the gaps between a line's dates, and this is the one
 * place those gaps are read. The classifier is deliberately coarse: six named cadences plus
 * irregular, decided by the MEDIAN gap and its median absolute deviation. A monthly charge that
 * skipped one cycle has a single ~62-day gap among 31s; the median stays 31, the MAD stays near 0,
 * and the line stays monthly — a mean and a standard deviation would have called it irregular.
 *
 * Dates are compared at midnight in calendar days, so a charge at 23:00 and one at 01:00 two
 * nights later are 2 days apart, and daylight-saving shifts cannot produce a 30.96-day gap.
 */

const DAY_MS = 86400000;

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from, to) => Math.round((to - from) / DAY_MS);

/** Distinct dates, ascending, normalised to midnight. */
function distinctDays(dates) {
  const seen = new Map();
  (dates ?? []).forEach((d) => {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return;
    const day = midnight(d);
    seen.set(day.getTime(), day);
  });
  return [...seen.values()].sort((a, b) => a - b);
}

function gapsOf(days) {
  const gaps = [];
  for (let i = 1; i < days.length; i += 1) gaps.push(daysBetween(days[i - 1], days[i]));
  return gaps;
}

/**
 * @param {Date[]} dates  any order; same-day duplicates are collapsed first
 * @returns {{ cadence:'weekly'|'fortnightly'|'monthly'|'bimonthly'|'quarterly'|'annual'|'irregular'|'insufficient',
 *             medianGap:number|null, gapMad:number|null, observations:number, perYear:52|26|12|6|4|1|null }}
 *
 * `insufficient` still carries `medianGap` when there are two dates, so a caller can recognise
 * "two charges about a month apart" without re-deriving the gap.
 */
export function classifyCadence(dates) {
  const days = distinctDays(dates);
  const observations = days.length;
  const gaps = gapsOf(days);
  const g = gaps.length ? median(gaps) : null;
  const s = gaps.length ? mad(gaps) : null;
  const result = (cadence, perYear) => ({ cadence, medianGap: g, gapMad: s, observations, perYear });

  if (observations < CADENCE_ANNUAL_MIN_OBSERVATIONS) return result('insufficient', null);

  const annual = CADENCE_RULES.find((r) => r.cadence === 'annual');
  if (annual && gaps.every((gap) => gap >= annual.lo && gap <= annual.hi)) {
    return result('annual', annual.perYear);
  }

  if (observations < CADENCE_MIN_OBSERVATIONS) return result('insufficient', null);

  for (const rule of CADENCE_RULES) {
    if (rule.cadence === 'annual') continue;
    if (g >= rule.lo && g <= rule.hi && (rule.mad == null || s <= rule.mad)) {
      return result(rule.cadence, rule.perYear);
    }
  }
  return result('irregular', null);
}

/** Mode of day-of-month over the last `lastN` dates (ties → smallest); null for no dates. */
export function dayOfMonthMode(dates, lastN = 6) {
  const days = distinctDays(dates);
  if (!days.length) return null;
  return mode(days.slice(-lastN).map((d) => d.getDate()));
}

const MONTHS_PER_PERIOD = { monthly: 1, bimonthly: 2, quarterly: 3, annual: 12 };
const DAYS_PER_PERIOD = { weekly: 7, fortnightly: 14 };

/** `dom` inside the month `monthIndex` months after `from`'s month, clamped to that month's length. */
function monthsLater(from, months, dom) {
  const year = from.getFullYear();
  const monthIndex = from.getMonth() + months;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(dom, lastDay));
}

/**
 * Next expected date after the latest of `dates`. monthly / bimonthly / quarterly / annual: last
 * + 1 / 2 / 3 / 12 calendar months, then the day snapped to `dayOfMonth` (default
 * dayOfMonthMode(dates)) and clamped to the month length — 31 Jan → 28 Feb. weekly / fortnightly:
 * last + 7 / 14 days. irregular / insufficient / no dates → null. A Saturday stays a Saturday;
 * weekend shifts are the recurring engine's job, because only it knows how a line behaves.
 */
export function nextExpected(dates, cadence, { dayOfMonth } = {}) {
  const days = distinctDays(dates);
  if (!days.length) return null;
  const last = days[days.length - 1];
  if (DAYS_PER_PERIOD[cadence]) {
    return new Date(last.getFullYear(), last.getMonth(), last.getDate() + DAYS_PER_PERIOD[cadence]);
  }
  const months = MONTHS_PER_PERIOD[cadence];
  if (!months) return null;
  const dom = dayOfMonth ?? dayOfMonthMode(days) ?? last.getDate();
  return monthsLater(last, months, dom);
}

/** Step one period of `cadence` forward from `date`, snapping monthly-and-slower to `dayOfMonth`. */
export function stepForward(date, cadence, { dayOfMonth } = {}) {
  return nextExpected([date], cadence, { dayOfMonth: dayOfMonth ?? date.getDate() });
}
