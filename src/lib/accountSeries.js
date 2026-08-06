import { parseTransactionDate } from '../utils/date';
import { compareAccountTypes, parseAccount } from './accounts';

/**
 * Per-account movement over time.
 *
 * The export carries no balance column, so this is NOT a balance — it is the cumulative sum of an
 * account's transactions from zero at the first date in the file. The shape and the direction are
 * real; the level is not, and the UI must say so.
 *
 * Two deliberate differences from the net-total chart:
 *
 *  - Transfers are INCLUDED. `netTransactions` strips them because moving money between your own
 *    accounts isn't income or spend. But from a single account's point of view a transfer is a
 *    real movement of that account's money, and excluding it would draw a line that never happened.
 *  - The anchor is the first date in the whole dataset, not the visible window. Anchoring to the
 *    window would make every curve jump each time the month slider moved.
 */

function parse(t) {
  return t.DateObj ?? parseTransactionDate(t.Date);
}

export function buildAccountMovementSeries(data, selectedAccounts, { from, to } = {}) {
  if (!data?.length) return { accounts: [], anchorDate: null };

  const selected = new Set(selectedAccounts);
  const rows = data
    .filter((t) => selected.has(t.Account))
    .map((t) => ({ account: t.Account, date: parse(t), amount: t.AmountNum }))
    .filter((t) => t.date && !Number.isNaN(t.date.getTime()))
    .sort((a, b) => a.date - b.date);

  if (!rows.length) return { accounts: [], anchorDate: null };

  const anchorDate = rows[0].date;
  const start = from ?? anchorDate;
  const end = to ?? rows[rows.length - 1].date;

  const byAccount = new Map();
  rows.forEach((r) => {
    if (!byAccount.has(r.account)) {
      byAccount.set(r.account, { running: 0, baseline: null, points: [] });
    }
    const entry = byAccount.get(r.account);
    const before = entry.running;
    entry.running += r.amount;
    // Only keep points inside the window, but keep accumulating outside it so the curve enters the
    // window at the right height. The baseline is where it entered.
    if (r.date >= start && r.date <= end) {
      if (entry.baseline === null) entry.baseline = before;
      entry.points.push({ t: r.date.getTime(), value: entry.running, date: r.date });
    }
  });

  const accounts = [...byAccount.entries()]
    .map(([account, entry]) => {
      const points = entry.points;
      const values = points.map((p) => p.value);
      const last = points[points.length - 1];
      const baseline = entry.baseline ?? 0;
      return {
        account,
        points,
        baseline,
        // Movement across the visible window, not since the beginning of the file.
        change: points.length ? last.value - baseline : 0,
        endValue: points.length ? last.value : 0,
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 0,
        lastActivity: last?.date ?? null,
        count: points.length,
      };
    })
    // Biggest movers first — the flat ones are rarely what you opened the page for.
    .sort((a, b) => Math.abs(b.max - b.min) - Math.abs(a.max - a.min));

  return { accounts, anchorDate, start, end };
}

/**
 * Where each account stands at the end of every pay cycle, and how much it moved to get there.
 *
 * The level is arbitrary — with no opening balance the running total starts at zero on the first
 * date in the file — but the month-to-month DELTAS are exact, and they're the thing worth reading.
 * That matters because a rising net worth can hide the opposite trend on the cards: loans amortise
 * down every month regardless, so they drag the total up while card debt is quietly growing.
 *
 * Direction is uniform once you're looking at a position: higher is better. A card going more
 * negative is more debt; a loan going less negative is debt repaid; a bank going up is more cash.
 */
export function buildAccountPositions(data, selectedAccounts, months) {
  if (!data?.length || !months?.length) return [];
  const selected = new Set(selectedAccounts);
  const visible = new Set(months);
  const lastMonth = months[months.length - 1];

  const rows = data
    .filter((t) => selected.has(t.Account))
    .map((t) => ({ account: t.Account, month: t['Pay Month'], amount: t.AmountNum, date: parse(t) }))
    .filter((t) => t.date)
    .sort((a, b) => a.date - b.date);

  const byAccount = new Map();
  rows.forEach((r) => {
    if (!byAccount.has(r.account)) byAccount.set(r.account, { running: 0, position: {}, moved: {} });
    const e = byAccount.get(r.account);
    e.running += r.amount;
    // Cycles before the window still accumulate, so the first visible position is truthful
    // relative to the ones after it.
    if (visible.has(r.month)) {
      e.position[r.month] = e.running;
      e.moved[r.month] = (e.moved[r.month] ?? 0) + r.amount;
    }
  });

  return [...byAccount.entries()]
    .map(([account, e]) => {
      // Carry the position forward across a cycle with no activity, so the line doesn't break.
      let carried = null;
      const positionByMonth = {};
      months.forEach((m) => {
        if (e.position[m] != null) carried = e.position[m];
        positionByMonth[m] = carried;
      });
      const meta = parseAccount(account);
      const deltas = months.map((m) => e.moved[m] ?? 0);
      // Where the account stood before the first visible cycle. Without this the Change column
      // wouldn't reconcile with the columns beside it: the first position shown already contains
      // that cycle's own movement.
      const firstShown = months.find((m) => e.position[m] != null);
      const openingPosition = firstShown == null ? 0 : e.position[firstShown] - (e.moved[firstShown] ?? 0);
      const priorDeltas = deltas.slice(0, -1).filter((_, i) => e.position[months[i]] != null);
      return {
        account,
        ...meta,
        openingPosition,
        positionByMonth,
        deltaByMonth: Object.fromEntries(months.map((m, i) => [m, deltas[i]])),
        currentDelta: e.moved[lastMonth] ?? 0,
        typicalDelta: priorDeltas.length
          ? priorDeltas.reduce((s, v) => s + v, 0) / priorDeltas.length
          : 0,
        // Net change across the whole visible window — the headline "better or worse" number.
        windowChange: months.reduce((s, m) => s + (e.moved[m] ?? 0), 0),
      };
    })
    .sort(
      (a, b) => compareAccountTypes(a.type, b.type) || a.bank.localeCompare(b.bank) || a.mask.localeCompare(b.mask),
    );
}

/**
 * One row per account for the Accounts table: what it did this cycle, what it typically does, and
 * when it last moved. Transfers are included for the same reason as above.
 */
export function buildAccountSummaries(data, selectedAccounts, months, currentMonth) {
  if (!data?.length) return [];
  const selected = new Set(selectedAccounts);
  const visible = new Set(months);
  const byAccount = new Map();

  data.forEach((t) => {
    if (!selected.has(t.Account)) return;
    const m = t['Pay Month'];
    if (!visible.has(m)) return;
    if (!byAccount.has(t.Account)) {
      byAccount.set(t.Account, {
        account: t.Account,
        netByMonth: {},
        cycleIn: 0,
        cycleOut: 0,
        count: 0,
        lastActivity: null,
      });
    }
    const e = byAccount.get(t.Account);
    e.netByMonth[m] = (e.netByMonth[m] ?? 0) + t.AmountNum;
    e.count += 1;
    if (m === currentMonth) {
      if (t.AmountNum >= 0) e.cycleIn += t.AmountNum;
      else e.cycleOut += t.AmountNum;
    }
    const d = parse(t);
    if (d && (!e.lastActivity || d > e.lastActivity)) e.lastActivity = d;
  });

  const prior = months.slice(0, -1);
  return [...byAccount.values()]
    .map((e) => {
      const priorNets = prior.map((m) => e.netByMonth[m] ?? 0);
      return {
        ...e,
        cycleNet: e.netByMonth[currentMonth] ?? 0,
        typicalNet: priorNets.length ? priorNets.reduce((s, v) => s + v, 0) / priorNets.length : 0,
        sparkline: months.map((m) => e.netByMonth[m] ?? 0),
      };
    })
    .sort((a, b) => Math.abs(b.cycleNet) - Math.abs(a.cycleNet));
}
