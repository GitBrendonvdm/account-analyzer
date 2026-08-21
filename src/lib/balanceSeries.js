import { CYCLE_TONES } from '../constants';
import { parseTransactionDate } from '../utils/date';
import { accountIdOf, parseAccount } from './accounts';

/**
 * Where the money stood, one series per pay cycle, on a day-of-cycle axis.
 *
 * Every account is summed into a single line — cash, savings and cards together — because the
 * question this answers is "how much is there", and splitting it into bands answers a different
 * one. Overlaying the cycles then shows whether this month is tracking above or below the last two
 * at the same point, which a single continuous line across three months cannot show.
 *
 * Loans are excluded and not optional: a bond amortises on a schedule that has nothing to do with
 * the month you are having, and its size would flatten everything else against the axis.
 *
 * WHERE THE LEVEL COMES FROM. The export has no balance column, so a position is a cumulative sum
 * anchored at zero on the first row in the file — the shape is exact, the level is not. When an
 * account has a balance entered against it, its series is offset so the last point matches and it
 * becomes a true balance. `anchored` reports which of the two you are looking at, so the chart can
 * say so rather than implying a precision it does not have.
 */

const DAY_MS = 86400000;

const INCLUDED = new Set(['Bank', 'Savings', 'Credit Card', 'Other']);

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function cycleLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
}

export function buildBalanceBands(data, selectedAccounts, accounts, processed, { cycles = 3 } = {}) {
  if (!data?.length || !processed?.months?.length || !processed.currentCycleStart) return null;
  const { months, cycleStarts, currentMonth, currentCycleStart, currentCycleEnd } = processed;

  const length = Math.max(1, Math.round((currentCycleEnd - currentCycleStart) / DAY_MS) + 1);
  const selected = new Set(selectedAccounts ?? []);
  const balanceById = new Map((accounts ?? []).map((a) => [a.id, a.currentBalance]));

  const rows = data
    .filter((t) => {
      const type = parseAccount(t.Account).type;
      if (type === 'Loan' || !INCLUDED.has(type)) return false;
      return !selectedAccounts || selected.has(t.Account);
    })
    .map((t) => ({
      account: t.Account,
      date: t.DateObj ?? parseTransactionDate(t.Date),
      amount: t.AmountNum,
    }))
    .filter((r) => r.date)
    .sort((a, b) => a.date - b.date);

  if (rows.length === 0) return null;

  // Accumulate from the first row in the file so each cycle's line enters at the right height.
  const running = new Map();
  rows.forEach((r) => running.set(r.account, (running.get(r.account) ?? 0) + r.amount));

  // The offset that turns positions into balances, where a balance has been given.
  const present = [...new Set(rows.map((r) => r.account))];
  const offsets = new Map();
  let anchored = 0;
  present.forEach((account) => {
    const known = balanceById.get(accountIdOf(account));
    if (known == null || !Number.isFinite(known)) return;
    anchored += 1;
    offsets.set(account, known - (running.get(account) ?? 0));
  });
  const totalOffset = present.reduce((s, a) => s + (offsets.get(a) ?? 0), 0);

  /**
   * A closing total for EVERY day the file covers, carried forward across quiet days.
   *
   * A sparse map of transaction days can only answer "what was the position on a day something
   * happened". The opening balance of a cycle is the position on the day BEFORE it starts, which is
   * usually a quiet day — and reading the opening off the cycle's own first day instead means the
   * first day's activity is already inside it. On a boundary that lands on payday, that silently
   * excluded a R78 000 salary from the movement.
   */
  const dayKey = (d) => Math.round(midnight(d) / DAY_MS);
  const firstDay = dayKey(rows[0].date);
  const lastDay = dayKey(rows[rows.length - 1].date);
  const dailyTotal = new Array(lastDay - firstDay + 1);
  {
    let total = 0;
    let cursor = 0;
    for (let i = 0; i <= lastDay - firstDay; i += 1) {
      while (cursor < rows.length && dayKey(rows[cursor].date) === firstDay + i) {
        total += rows[cursor].amount;
        cursor += 1;
      }
      dailyTotal[i] = total + totalOffset;
    }
  }
  /** The position at the close of a given day; before the file starts, nothing had happened yet. */
  const totalAt = (date) => {
    const i = dayKey(date) - firstDay;
    if (i < 0) return totalOffset;
    return dailyTotal[Math.min(i, dailyTotal.length - 1)];
  };

  const window = months.slice(-cycles).filter((m) => cycleStarts[m]);
  if (window.length === 0) return null;

  const through = processed.dataThrough ?? currentCycleEnd;

  /**
   * Each cycle's OWN length, in days.
   *
   * The x-axis is 31 days because that is the current cycle, but cycles are 28-31 days depending on
   * where the boundary falls. Running every series to the full axis pushed a 30-day cycle one day
   * past its own end — onto the 23rd, which is payday — so July's line absorbed August's salary and
   * closed R78 000 too high. Anything past a cycle's own end is null and simply is not drawn.
   */
  const lengthOf = (month) => {
    const start = cycleStarts[month];
    const i = months.indexOf(month);
    const nextStart = i >= 0 && i < months.length - 1 ? cycleStarts[months[i + 1]] : null;
    const end = nextStart
      ? new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() - 1)
      : currentCycleEnd;
    return Math.max(1, Math.round((end - start) / DAY_MS) + 1);
  };

  const seriesFor = (month) => {
    const start = cycleStarts[month];
    const ownLength = lengthOf(month);
    const points = [];
    for (let i = 0; i < length; i += 1) {
      // Past this cycle's own end there is no cycle left to draw.
      if (i >= ownLength) {
        points.push(null);
        continue;
      }
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      // Past the data's last date there is nothing to draw — a flat line would read as a quiet
      // spell rather than as an absence.
      if (month === currentMonth && d > through) {
        points.push(null);
        continue;
      }
      points.push(totalAt(d));
    }
    return points;
  };

  const series = [...window].reverse().map((month, i) => {
    const points = seriesFor(month);
    const known = points.filter((v) => v != null);
    const isCurrent = month === currentMonth;
    const start = cycleStarts[month];
    // The day before the cycle opened — so the first day's movement counts as movement.
    const opening = totalAt(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1));
    return {
      id: month,
      month,
      label: isCurrent ? 'This cycle' : cycleLabel(month),
      colour: CYCLE_TONES[i % CYCLE_TONES.length],
      depth: i,
      isCurrent,
      points,
      total: known.length ? known[known.length - 1] : opening,
      opening,
    };
  });

  const values = series.flatMap((s) => s.points.filter((v) => v != null));
  if (values.length === 0) return null;

  const current = series.find((s) => s.isCurrent);
  const previous = series.find((s) => !s.isCurrent);

  return {
    series,
    length,
    // Fit the data rather than forcing zero into the scale — with every balance negative, a zero
    // ceiling throws away half the frame and flattens the differences worth seeing. The overlay
    // draws a zero line only when zero actually falls inside the range.
    max: Math.max(...values),
    min: Math.min(...values),
    cycles: window.length,
    anchored: present.length > 0 && anchored === present.length,
    anchoredCount: anchored,
    accountCount: present.length,
    net: current?.total ?? 0,
    change: (current?.total ?? 0) - (current?.opening ?? 0),
    againstPrevious: previous ? (current?.total ?? 0) - previous.total : null,
  };
}
