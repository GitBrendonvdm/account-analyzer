import { parseMonthKey, parseTransactionDate } from '../utils/date';

/**
 * Pay-cycle boundaries, derived from the export's own `Pay Month` column.
 *
 * The budgeting tool that produces the CSV already decides which cycle every transaction belongs
 * to. Re-deriving that boundary from a hardcoded payday rule guarantees drift: this file used to
 * assume "the 25th, rolled forward to Monday", which put the 2026-08 cycle at 27 Jul – 25 Aug while
 * the data itself bucketed it 23 Jul – 22 Aug. That misalignment invented a trailing week column
 * sitting entirely outside the pay month and clamped the first few days of real spend into a hidden
 * "week 0".
 *
 * So we read the boundary off the data instead:
 *   - `boundaryDom`      — the day-of-month cycles start on (the mode of observed first dates)
 *   - `startMonthOffset` — whether that day sits in the previous calendar month (-1, a 23rd→22nd
 *                          pay cycle) or the same one (0, a calendar-month budget)
 *
 * Both are inferred, so a different bank/tool with different conventions works without a code
 * change. Snapping to the mode rather than using each cycle's raw first transaction keeps cycle
 * lengths and week offsets consistent — an idle 23rd and 24th shouldn't shorten a cycle.
 *
 * Everything here buckets on the RAW `Pay Month`, never `getPayMonth`: `enrichWithEffectivePayMonths`
 * shifts staggered salary into a later pay-month while keeping its original early date, which would
 * drag a cycle start back by weeks.
 */

const DAY_MS = 86400000;

function daysBetween(from, to) {
  return Math.round((to - from) / DAY_MS);
}

function atMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** `dom` of the given month, clamped to the month's length (a 31st boundary in February). */
function dayOfMonth(year, monthIndex, dom) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(dom, lastDay));
}

function mode(values, fallback) {
  if (!values.length) return fallback;
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** First and last transaction date observed for each raw pay-month. */
function observedRanges(transactions, months) {
  const known = new Set(months);
  const ranges = {};
  transactions.forEach((t) => {
    const m = t['Pay Month'];
    if (!known.has(m)) return;
    const d = parseTransactionDate(t.Date);
    if (!d || Number.isNaN(d.getTime())) return;
    const day = atMidnight(d);
    const range = ranges[m];
    if (!range) {
      ranges[m] = { min: day, max: day };
      return;
    }
    if (day < range.min) range.min = day;
    if (day > range.max) range.max = day;
  });
  return ranges;
}

/**
 * Build the cycle calendar for a set of raw pay-month keys.
 *
 * @param transactions all rows (raw `Pay Month` is read off each)
 * @param months       raw pay-month keys, ascending
 * @param asOf         "now" — decides which cycle is still in progress
 * @returns {{
 *   starts: Record<string, Date>, ends: Record<string, Date>, lengths: Record<string, number>,
 *   boundaryDom: number, startMonthOffset: number,
 *   isProjected: Record<string, boolean>, isPartial: Record<string, boolean>,
 *   dataThrough: Date|null, currentMonth: string|null,
 * }}
 */
export function buildCycleCalendar(transactions, months, asOf = new Date()) {
  const empty = {
    starts: {},
    ends: {},
    lengths: {},
    boundaryDom: 1,
    startMonthOffset: 0,
    isProjected: {},
    isPartial: {},
    dataThrough: null,
    currentMonth: null,
  };
  if (!transactions?.length || !months?.length) return empty;

  const ranges = observedRanges(transactions, months);
  const present = months.filter((m) => ranges[m]);
  if (!present.length) return empty;

  // The earliest month in an export is almost always a partial cycle (the download started
  // mid-cycle), so its first transaction date says nothing about where cycles begin.
  const boundarySample = present.slice(1);
  const sample = boundarySample.length ? boundarySample : present;
  const boundaryDom = mode(
    sample.map((m) => ranges[m].min.getDate()),
    1,
  );
  const startMonthOffset = mode(
    sample.map((m) => {
      const { year, monthIndex } = parseMonthKey(m);
      const min = ranges[m].min;
      return (min.getFullYear() - year) * 12 + (min.getMonth() - monthIndex);
    }),
    0,
  );

  const startFor = (monthKey) => {
    const { year, monthIndex } = parseMonthKey(monthKey);
    return dayOfMonth(year, monthIndex + startMonthOffset, boundaryDom);
  };

  const dataThrough = present.reduce(
    (latest, m) => (latest && latest > ranges[m].max ? latest : ranges[m].max),
    null,
  );
  const currentMonth = present[present.length - 1];

  const starts = {};
  const ends = {};
  const lengths = {};
  const isProjected = {};
  const isPartial = {};

  present.forEach((m, i) => {
    const snapped = startFor(m);
    const observed = ranges[m].min;
    // A partial first cycle genuinely starts where its data starts.
    const first = i === 0 && observed > snapped;
    starts[m] = first ? observed : snapped;
    isPartial[m] = first;
  });

  present.forEach((m, i) => {
    const next = present[i + 1];
    // Cycles must tile: each ends the day before the next begins, so no date falls between them.
    const end = next ? addDays(starts[next], -1) : addDays(startFor(nextMonthKey(m)), -1);
    ends[m] = end;
    lengths[m] = daysBetween(starts[m], end) + 1;
    // The final cycle's end is inferred from the boundary rule, not observed, until it closes.
    isProjected[m] = !next && end > atMidnight(asOf);
  });

  return {
    starts,
    ends,
    lengths,
    boundaryDom,
    startMonthOffset,
    isProjected,
    isPartial,
    dataThrough,
    currentMonth,
  };
}

function nextMonthKey(monthKey) {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const d = new Date(year, monthIndex + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** How many days into the cycle `asOf` is — 1 on the first day, clamped to the cycle length. */
export function cycleDay(asOf, start, length) {
  if (!start) return length;
  return Math.max(1, Math.min(length, daysBetween(start, atMidnight(asOf)) + 1));
}
