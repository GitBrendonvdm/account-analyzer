import { UPCOMING_DAYS } from '../constants';
import { parseTransactionDate } from '../utils/date';
import { stepForward } from './cadence';
import { cycleDay } from './cycleCurve';
import { lastCompleteMonth, spendRows } from './flows';

/**
 * The next thirty days of bills, read off the recurring engine.
 *
 * Nothing here decides what recurs — recurring.js did that, and every figure on this calendar is
 * one of its lines stepped forward from the last time it charged. That is the point of having one
 * engine: the same R22 855 instalment that the subscriptions audit leaves out and the cost-of-debt
 * panel counts is the same line that lands here on the 25th, at the same confidence.
 *
 * Two windows are in play and they are not the same. The data ends at `dataThrough`; today is
 * `asOf`. Everything between the two has already happened but cannot be seen, so the calendar
 * starts the day after the data ends and the items in that gap are marked "not yet in the data"
 * (`unobservable`) rather than "overdue" — a stale export must not read as a missed payment. The
 * window then runs `days` past today, which across a payday can hold two of a monthly charge.
 *
 * The payday row is the expected salary, from the income profile, attached to the first day of
 * the next cycle; other income with a known next date gets a row of its own. Totals count only
 * lines the engine is confident about; the low-confidence remainder is reported beside them so it
 * is neither hidden nor mistaken for a commitment.
 */

const DAY_MS = 86400000;
const COUNTED_LEVELS = new Set(['high', 'medium']);
const WEEKLY_LIKE = new Set(['weekly', 'fortnightly']);
const PAYDAY_INCOME_PRESENCE = 0.6;
/** A salary expected within the first few days of the cycle belongs on the payday row. */
const PAYDAY_WINDOW_DAYS = 4;
const MAX_STEPS = 400;

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const dayKey = (d) => midnight(d).getTime();
const toDay = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : parseTransactionDate(String(v));
  return d && !Number.isNaN(d.getTime()) ? midnight(d) : null;
};

function formatRand(n) {
  return `R${Math.round(Math.abs(n)).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
}

/** The Friday before a weekend date, or the Monday after, when the line is known to move. */
function applyWeekendShift(date, shift) {
  if (!date || !shift || !isWeekend(date)) return date;
  const saturday = date.getDay() === 6;
  if (shift === 'earlier') return addDays(date, saturday ? -1 : -2);
  return addDays(date, saturday ? 2 : 1);
}

/**
 * Every date a line is expected to charge in [from, to], stepping its cadence forward from the last
 * charge. Monthly-and-slower lines snap to the line's day-of-month at every step (so a 31st that
 * clamped to 28 Feb is back on the 31st in March) and are shifted off weekends the way the line
 * has moved before; weekly lines step by their gap.
 */
function occurrencesOf(line, from, to) {
  const last = toDay(line.lastSeen);
  if (!last || !line.cadence || !line.perYear) return [];
  const weeklyLike = WEEKLY_LIKE.has(line.cadence);
  const out = [];
  let cursor = last;
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const next = stepForward(cursor, line.cadence, weeklyLike ? {} : { dayOfMonth: line.dom ?? cursor.getDate() });
    if (!next || next <= cursor) break;
    cursor = next;
    // The shift can pull a date two days earlier, so only stop once even that could not land inside.
    if (daysBetween(to, next) > 2) break;
    const date = weeklyLike ? next : applyWeekendShift(next, line.weekendShift);
    if (date >= from && date <= to) out.push(date);
  }
  return out;
}

/**
 * @param lines    RecurringLine[] from buildRecurringLines (all levels; tentative lines are ignored)
 * @param options  calendar: buildCycleCalendar(...); asOf: Date; dataThrough: Date; days = 30;
 *                 incomeProfile: buildIncomeProfile(...) | null;
 *                 explained / data / transfers: optional, for `coverage` over the last complete cycle
 * @returns {Upcoming} — shape at the foot of this file
 */
export function buildUpcoming(lines, options = {}) {
  const { calendar, days = UPCOMING_DAYS, incomeProfile = null, explained = null, data = null, transfers = null } = options;
  const dataThrough = toDay(options.dataThrough ?? calendar?.dataThrough);
  const asOf = toDay(options.asOf) ?? dataThrough;
  const empty = {
    entries: [],
    dueBeforePayday: 0,
    dueAfterPayday: 0,
    lowConfidenceExtra: 0,
    overdue: [],
    landed: [],
    unobservable: [],
    coverage: null,
    horizon: { from: null, to: null, nextPayDate: null },
    assumptions: [],
  };
  if (!calendar?.starts || !dataThrough || !asOf) return empty;
  const currentMonth = calendar.currentMonth;
  const currentStart = currentMonth ? calendar.starts[currentMonth] : null;
  const currentEnd = currentMonth ? calendar.ends[currentMonth] : null;
  const cycleLength = currentMonth ? calendar.lengths[currentMonth] : null;
  const nextPayDate = currentEnd ? addDays(currentEnd, 1) : null;
  const from = addDays(dataThrough, 1);
  const to = addDays(asOf, days);

  const active = (lines ?? []).filter((line) => line.status === 'active' && !line.tentative);
  const byDate = new Map();
  const entryFor = (date) => {
    const key = dayKey(date);
    if (!byDate.has(key)) {
      const inCurrent = currentEnd ? date <= currentEnd : true;
      byDate.set(key, {
        date: midnight(date),
        cycleDay: inCurrent
          ? cycleDay(date, currentStart, cycleLength ?? 31)
          : nextPayDate
            ? daysBetween(nextPayDate, date) + 1
            : null,
        cycle: inCurrent ? 'current' : 'next',
        items: [],
        total: 0,
        lowTotal: 0,
        payday: false,
        income: 0,
      });
    }
    return byDate.get(key);
  };

  let mediumCount = 0;
  let mediumTotal = 0;
  active.forEach((line) => {
    occurrencesOf(line, from, to).forEach((date) => {
      const entry = entryFor(date);
      const inCurrent = entry.cycle === 'current';
      const item = {
        lineId: line.id,
        label: line.label,
        kind: line.kind,
        amount: line.amount,
        level: line.level,
        payingAccountId: line.payingAccountId ?? line.accountId,
        status: inCurrent ? (line.cycleStatus ?? 'due') : 'next',
      };
      entry.items.push(item);
      if (COUNTED_LEVELS.has(line.level)) {
        entry.total += line.amount;
        if (line.level === 'medium') {
          mediumCount += 1;
          mediumTotal += line.amount;
        }
      } else {
        entry.lowTotal += line.amount;
      }
    });
  });

  // Income: the salary on the payday row, anything else with a known next date on its own row.
  const sources = (incomeProfile?.sources ?? []).filter(
    (s) => s.presence >= PAYDAY_INCOME_PRESENCE && s.expectedAmount > 0,
  );
  const nextCycleDayOf = (d) => (nextPayDate ? daysBetween(nextPayDate, d) + 1 : null);
  const onPaydayRow = (s) => {
    if (!nextPayDate) return false;
    if (s.expectedNext) {
      const day = nextCycleDayOf(s.expectedNext);
      return day != null && day >= 1 && day <= (s.kind === 'salary' ? PAYDAY_WINDOW_DAYS : 1);
    }
    return s.kind === 'salary' && s.timing?.typicalCycleDay != null && s.timing.typicalCycleDay <= PAYDAY_WINDOW_DAYS;
  };
  let paydayIncome = 0;
  sources.forEach((s) => {
    if (onPaydayRow(s)) {
      paydayIncome += s.expectedAmount;
      return;
    }
    if (s.expectedNext && s.expectedNext >= from && s.expectedNext <= to) {
      entryFor(s.expectedNext).income += s.expectedAmount;
    }
  });
  // The payday row exists when there is income to put on it, or a bill already sits on that day;
  // an empty payday row on a calendar with no income profile would be a heading with nothing under it.
  if (nextPayDate && nextPayDate >= from && nextPayDate <= to && (paydayIncome > 0 || byDate.has(dayKey(nextPayDate)))) {
    const payday = entryFor(nextPayDate);
    payday.payday = true;
    payday.income += paydayIncome;
  }

  const entries = [...byDate.values()].sort((a, b) => a.date - b.date);
  entries.forEach((entry) => {
    // Overdue first, then the largest — what the reader needs to act on comes first.
    entry.items.sort((a, b) => (b.status === 'overdue') - (a.status === 'overdue') || b.amount - a.amount);
  });

  const before = entries.filter((e) => nextPayDate && e.date < nextPayDate);
  const after = entries.filter((e) => !nextPayDate || e.date >= nextPayDate);
  const dueBeforePayday = before.reduce((s, e) => s + e.total, 0);
  const dueAfterPayday = after.reduce((s, e) => s + e.total, 0);
  const lowConfidenceExtra = entries.reduce((s, e) => s + e.lowTotal, 0);

  const byStatus = (status) => active.filter((line) => line.cycleStatus === status);

  // How much of the last complete cycle's spend the engine explains — the honest measure of what
  // this calendar can and cannot see.
  let coverage = null;
  const lastCycle = lastCompleteMonth(calendar);
  if (explained && data && transfers && lastCycle) {
    const rows = spendRows(data, { transfers, months: [lastCycle] });
    const total = rows.reduce((s, t) => s + Math.abs(t.AmountNum), 0);
    const covered = rows.filter((t) => explained.has(t)).reduce((s, t) => s + Math.abs(t.AmountNum), 0);
    coverage = { explained: covered, total, share: total > 0 ? covered / total : 0, cycle: lastCycle };
  }

  const assumptions = [
    "Each line steps forward from its last charge at its usual day of the month; lines that move off weekends are shifted the way they have before.",
    'Totals count high- and medium-confidence lines only.',
  ];
  if (mediumCount) {
    assumptions.push(`${mediumCount} medium-confidence item${mediumCount === 1 ? '' : 's'} (${formatRand(mediumTotal)}) counted in the totals.`);
  }
  if (lowConfidenceExtra > 0) {
    assumptions.push(`${formatRand(lowConfidenceExtra)} of low-confidence charges is listed but not counted.`);
  }
  if (paydayIncome > 0) {
    assumptions.push(`Payday income is the expected salary landing within the first ${PAYDAY_WINDOW_DAYS} days of the cycle.`);
  }
  if (daysBetween(dataThrough, asOf) > 0) {
    assumptions.push(`The data ends ${daysBetween(dataThrough, asOf)} day${daysBetween(dataThrough, asOf) === 1 ? '' : 's'} before today; charges due in that gap are marked "not yet in the data".`);
  }
  if (coverage) {
    assumptions.push(`Recurring lines explained ${Math.round(coverage.share * 100)}% of last cycle's spend.`);
  }

  return {
    entries,
    dueBeforePayday,
    dueAfterPayday,
    lowConfidenceExtra,
    overdue: byStatus('overdue'),
    landed: byStatus('landed'),
    unobservable: byStatus('unobservable'),
    coverage,
    horizon: { from, to, nextPayDate },
    assumptions,
  };
}

/**
 * Upcoming = {
 *   entries: [{ date, cycleDay, cycle: 'current'|'next',
 *               items: [{ lineId, label, kind, amount, level, payingAccountId,
 *                         status: 'landed'|'due'|'overdue'|'unobservable'|'next' }],
 *               total, lowTotal, payday: boolean, income }],
 *   dueBeforePayday, dueAfterPayday, lowConfidenceExtra,
 *   overdue: RecurringLine[], landed: RecurringLine[], unobservable: RecurringLine[],
 *   coverage: { explained, total, share, cycle } | null,
 *   horizon: { from, to, nextPayDate }, assumptions: string[],
 * }
 */
