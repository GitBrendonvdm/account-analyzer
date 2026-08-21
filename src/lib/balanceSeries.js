import { parseTransactionDate } from '../utils/date';
import { parseAccount } from './accounts';

/**
 * Daily balances across the recent cycles, grouped into three bands.
 *
 * The point of drawing it this way: cash and card debt belong on the same axis, on opposite sides
 * of zero. Anything above the line is money you have; anything below it is money you owe. A cycle
 * where the blue holds steady while the red deepens is spending that was financed rather than paid
 * for — and that is invisible if the two are charted apart, or netted into one line.
 *
 * Loans are excluded and not optional. A bond amortises on a schedule that has nothing to do with
 * the month you're having, and its size would flatten everything else against the axis.
 *
 * WHERE THE LEVEL COMES FROM. The export has no balance column, so a position is a cumulative sum
 * anchored at zero on the first row in the file — the shape is real, the level is not. When an
 * account has a balance entered against it the series is offset so the last point matches, and the
 * whole band becomes a true balance. `anchored` says which of the two you're looking at, so the
 * chart can be honest about it rather than implying precision it hasn't got.
 */

const DAY_MS = 86400000;

/** Cash, savings and debt — three bands, in draw order (debt last so it sits on top). */
const BANDS = [
  { id: 'bank', label: 'Cash', types: ['Bank'], colour: '#0a84ff' },
  { id: 'savings', label: 'Savings', types: ['Savings'], colour: '#63e6e2' },
  { id: 'card', label: 'Card debt', types: ['Credit Card'], colour: '#ff453a' },
];

function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function buildBalanceBands(data, selectedAccounts, accounts, processed, { cycles = 3 } = {}) {
  if (!data?.length || !processed?.months?.length) return null;

  const window = processed.months.slice(-cycles);
  const start = processed.cycleStarts[window[0]];
  const end = processed.dataThrough ?? processed.currentCycleEnd;
  if (!start || !end || end < start) return null;

  const selected = new Set(selectedAccounts ?? []);
  const balanceById = new Map((accounts ?? []).map((a) => [a.id, a.currentBalance]));

  // One running total per account, accumulated from the very first row so the curve enters the
  // window at the right height rather than restarting at zero.
  const rows = data
    .filter((t) => {
      const meta = parseAccount(t.Account);
      if (meta.type === 'Loan') return false;
      if (selectedAccounts && !selected.has(t.Account)) return false;
      return BANDS.some((b) => b.types.includes(meta.type));
    })
    .map((t) => ({
      account: t.Account,
      meta: parseAccount(t.Account),
      date: t.DateObj ?? parseTransactionDate(t.Date),
      amount: t.AmountNum,
    }))
    .filter((r) => r.date)
    .sort((a, b) => a.date - b.date);

  if (rows.length === 0) return null;

  const days = Math.round((midnight(end) - midnight(start)) / DAY_MS) + 1;
  if (days < 2) return null;

  const running = new Map();
  const perAccountDaily = new Map(); // account -> array of closing positions per day
  const accountMeta = new Map();

  let cursor = 0;
  for (let i = 0; i < days; i += 1) {
    const dayEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 23, 59, 59);
    while (cursor < rows.length && rows[cursor].date <= dayEnd) {
      const r = rows[cursor];
      running.set(r.account, (running.get(r.account) ?? 0) + r.amount);
      accountMeta.set(r.account, r.meta);
      cursor += 1;
    }
    running.forEach((value, account) => {
      if (!perAccountDaily.has(account)) perAccountDaily.set(account, new Array(days).fill(0));
      perAccountDaily.get(account)[i] = value;
    });
  }

  // Re-base each account onto its real balance where one has been entered.
  let anchored = 0;
  let total = 0;
  perAccountDaily.forEach((series, account) => {
    total += 1;
    const meta = accountMeta.get(account);
    const id = `${meta.bank.toLowerCase()}|${meta.mask.toLowerCase()}`;
    const known = balanceById.get(id);
    if (known == null || !Number.isFinite(known)) return;
    anchored += 1;
    const offset = known - series[series.length - 1];
    for (let i = 0; i < series.length; i += 1) series[i] += offset;
  });

  const points = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const point = { day: i, date };
    BANDS.forEach((band) => {
      let sum = 0;
      perAccountDaily.forEach((series, account) => {
        if (band.types.includes(accountMeta.get(account).type)) sum += series[i];
      });
      point[band.id] = sum;
    });
    point.net = BANDS.reduce((s, b) => s + point[b.id], 0);
    points.push(point);
  }

  const present = BANDS.filter((b) => points.some((p) => Math.abs(p[b.id]) > 0.5));
  const last = points[points.length - 1];
  const first = points[0];

  return {
    points,
    bands: present,
    days,
    cycles: window.length,
    start,
    end,
    // Fully anchored means every band is a real balance; partly or not at all means it's movement.
    anchored: total > 0 && anchored === total,
    anchoredCount: anchored,
    accountCount: total,
    net: last.net,
    netChange: last.net - first.net,
    changeByBand: Object.fromEntries(present.map((b) => [b.id, last[b.id] - first[b.id]])),
  };
}

export { BANDS };
