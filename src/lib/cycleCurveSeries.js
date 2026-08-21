import { CYCLE_TONES } from '../constants';
import { parseTransactionDate } from '../utils/date';
import { parseAccount } from './accounts';

/**
 * Cumulative spend, one series per pay cycle, all on a day-of-cycle axis.
 *
 * The comparison is the point. Plotted against calendar dates, three months make one long line and
 * the pattern is buried in its own history; plotted against day-of-cycle they overlay, and "steeper
 * than last month by day 8" becomes something you see rather than something you work out.
 *
 * Cumulative rather than daily, because the shape of accumulation is what shows pace — a daily bar
 * chart of front-loaded spending looks like noise.
 *
 * The current cycle's line stops where the data stops and continues as a dashed tail to the
 * pipeline's own projected close, so the forecast here agrees with every other forecast figure in
 * the app instead of being a second, prettier guess.
 *
 * Loans are excluded whatever the account chips say: a loan records no spending of its own, only
 * the instalment arriving and the charges raised against it, all of which sit inside the instalment
 * leaving the bank.
 */

const DAY_MS = 86400000;



function dayIndex(date, start) {
  if (!date || !start) return null;
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b - a) / DAY_MS);
}

function cumulativeSpend(rows, start, length, transferIds) {
  const daily = new Array(length).fill(0);
  rows.forEach((t) => {
    if (t.AmountNum >= 0 || transferIds?.has(t.id)) return;
    const i = dayIndex(t.DateObj ?? parseTransactionDate(t.Date), start);
    if (i == null || i < 0 || i >= length) return;
    daily[i] += Math.abs(t.AmountNum);
  });
  let run = 0;
  return daily.map((v) => (run += v));
}

function cycleLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
}

export function buildCycleCurve(data, selectedAccounts, processed, { cycles = 3 } = {}) {
  if (!data?.length || !processed?.currentCycleStart || !processed?.currentCycleEnd) return null;
  const { currentCycleStart, currentCycleEnd, currentMonth, months, cycleStarts, transferIds } =
    processed;

  // One axis length for every series, taken from the current cycle. Cycles vary by a day or two;
  // rescaling each to its own length would misalign the days the comparison depends on.
  const length = Math.max(1, Math.round((currentCycleEnd - currentCycleStart) / DAY_MS) + 1);

  const selected = new Set(selectedAccounts);
  const scoped = data.filter(
    (t) => selected.has(t.Account) && parseAccount(t.Account).type !== 'Loan',
  );

  const window = months.slice(-cycles).filter((m) => cycleStarts[m]);
  if (window.length === 0) return null;

  const throughDay = processed.dataThrough
    ? Math.min(length - 1, Math.max(0, dayIndex(processed.dataThrough, currentCycleStart)))
    : length - 1;

  // Newest first, so the current cycle is series[0] and legends read the way people scan.
  const series = [...window].reverse().map((month, i) => {
    const isCurrent = month === currentMonth;
    const running = cumulativeSpend(
      scoped.filter((t) => t['Pay Month'] === month),
      cycleStarts[month],
      length,
      transferIds,
    );

    if (!isCurrent) {
      return {
        id: month,
        month,
        label: cycleLabel(month),
        colour: CYCLE_TONES[i % CYCLE_TONES.length],
        isCurrent: false,
        points: running,
        total: running[length - 1] ?? 0,
      };
    }

    const spentSoFar = running[throughDay] ?? 0;
    const projectedEnd = spentSoFar + Math.abs(processed.expenseRemaining ?? 0);
    const points = running.map((v, d) => {
      if (d <= throughDay) return v;
      // The envelope model gives the endpoint, not a per-day shape — straight-lining the tail is
      // honest about that rather than inventing detail it does not have.
      return (
        spentSoFar +
        ((projectedEnd - spentSoFar) * (d - throughDay)) / Math.max(1, length - 1 - throughDay)
      );
    });

    return {
      id: month,
      month,
      label: 'This cycle',
      colour: CYCLE_TONES[0],
      isCurrent: true,
      points,
      throughDay,
      spentSoFar,
      total: projectedEnd,
    };
  });

  const max = Math.max(...series.flatMap((s) => s.points.filter((v) => v != null)), 1);

  // Pace against the same point in the previous cycle, which is the honest comparison mid-month.
  const current = series.find((s) => s.isCurrent);
  const previous = series.find((s) => !s.isCurrent);
  const priorToDate = previous?.points[throughDay] ?? 0;

  return {
    series,
    length,
    max,
    min: 0,
    throughDay,
    spentSoFar: current?.spentSoFar ?? 0,
    projectedEnd: current?.total ?? 0,
    pace: priorToDate > 0 ? (current?.spentSoFar ?? 0) / priorToDate : null,
    comparedWith: previous?.label ?? null,
    cycles: window.length,
  };
}
