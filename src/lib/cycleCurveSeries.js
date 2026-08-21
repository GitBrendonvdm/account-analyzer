import { parseTransactionDate } from '../utils/date';
import { parseAccount } from './accounts';

/**
 * Cumulative spend across the current cycle, against a typical one.
 *
 * The chart that leads the Today screen answers a question the table never could at a glance: not
 * "what did I spend on" but "am I ahead or behind, and by how much". Two lines do that —
 *
 *   actual    what has been spent so far this cycle, day by day, up to the data's last date
 *   typical   the same curve averaged over the prior cycles in the window
 *
 * Both are cumulative, because the shape of accumulation is what shows pace. A daily bar chart of a
 * front-loaded cycle looks like noise; the cumulative curve makes "steeper than usual" obvious.
 *
 * The forecast tail continues the actual line to the cycle end using the pipeline's own weekly
 * envelope, so the dashed section agrees with every other forecast figure in the app rather than
 * being a second, prettier guess.
 */

const DAY_MS = 86400000;

function dayIndex(date, start) {
  if (!date || !start) return null;
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b - a) / DAY_MS);
}

function spendByDay(rows, start, length, transferIds) {
  const out = new Array(length).fill(0);
  rows.forEach((t) => {
    if (t.AmountNum >= 0 || transferIds?.has(t.id)) return;
    const i = dayIndex(t.DateObj ?? parseTransactionDate(t.Date), start);
    if (i == null || i < 0 || i >= length) return;
    out[i] += Math.abs(t.AmountNum);
  });
  return out;
}

function cumulative(daily) {
  let run = 0;
  return daily.map((v) => (run += v));
}

export function buildCycleCurve(data, selectedAccounts, processed) {
  if (!data?.length || !processed?.currentCycleStart || !processed?.currentCycleEnd) return null;
  const { currentCycleStart, currentCycleEnd, currentMonth, months, cycleStarts, transferIds } = processed;

  const length = Math.max(1, Math.round((currentCycleEnd - currentCycleStart) / DAY_MS) + 1);
  const selected = new Set(selectedAccounts);
  // Loans are excluded here whatever the chips say. A loan account records no spending of its own —
  // only the instalment arriving and the charges the lender raises against it, all of which are
  // already inside the instalment leaving the bank. Letting a chip put them back would double the
  // curve against a table that never counts them.
  const scoped = data.filter(
    (t) => selected.has(t.Account) && parseAccount(t.Account).type !== 'Loan',
  );

  const actualDaily = spendByDay(
    scoped.filter((t) => t['Pay Month'] === currentMonth),
    currentCycleStart,
    length,
    transferIds,
  );
  const actual = cumulative(actualDaily);

  // Prior cycles, each mapped onto the same day-of-cycle axis and then averaged.
  const prior = months.slice(0, -1).filter((m) => cycleStarts[m]);
  const typicalDaily = new Array(length).fill(0);
  prior.forEach((m) => {
    const daily = spendByDay(
      scoped.filter((t) => t['Pay Month'] === m),
      cycleStarts[m],
      length,
      transferIds,
    );
    daily.forEach((v, i) => (typicalDaily[i] += v));
  });
  if (prior.length > 0) typicalDaily.forEach((_, i) => (typicalDaily[i] /= prior.length));
  const typical = cumulative(typicalDaily);

  // Only draw the actual line as far as the data reaches — beyond that it would be a flat line
  // masquerading as a quiet spell.
  const throughDay = processed.dataThrough
    ? Math.min(length - 1, Math.max(0, dayIndex(processed.dataThrough, currentCycleStart)))
    : length - 1;

  // The dashed tail lands exactly on the pipeline's own projected close for the cycle.
  const spentSoFar = actual[throughDay] ?? 0;
  const projectedEnd = spentSoFar + Math.abs(processed.expenseRemaining ?? 0);

  const points = [];
  for (let i = 0; i < length; i += 1) {
    const date = new Date(
      currentCycleStart.getFullYear(),
      currentCycleStart.getMonth(),
      currentCycleStart.getDate() + i,
    );
    const past = i <= throughDay;
    points.push({
      day: i,
      date,
      actual: past ? actual[i] : null,
      // Straight-line the remaining days between today's total and the projected close; the
      // envelope model gives the endpoint, not a per-day shape, so pretending to one would be
      // inventing detail.
      forecast: past
        ? i === throughDay
          ? actual[i]
          : null
        : spentSoFar +
          ((projectedEnd - spentSoFar) * (i - throughDay)) / Math.max(1, length - 1 - throughDay),
      typical: typical[i],
    });
  }

  const typicalToDate = typical[throughDay] ?? 0;
  return {
    points,
    length,
    throughDay,
    spentSoFar,
    projectedEnd,
    typicalTotal: typical[length - 1] ?? 0,
    typicalToDate,
    // Above 1 means spending faster than the usual curve by this point in the cycle.
    pace: typicalToDate > 0 ? spentSoFar / typicalToDate : null,
    priorCycles: prior.length,
  };
}
