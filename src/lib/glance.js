import { accountIdOf, parseAccount } from './accounts';

/**
 * The two answers the front page is for.
 *
 *   Is my net worth going up or down, month by month?          → `netWorthTrend`
 *   Do my everyday accounts spend more than they take in?      → `everydayAccounts`, `everydayFlow`
 *
 * Everything else the app knows is a reason behind one of those two, and lives a click further in.
 *
 * "Everyday" means the accounts money moves through: a cheque or current account and the card
 * that is actually used. Not loans (their instalments show up as money out of the cheque account),
 * and not an account that is only a place to keep money. It is found, not configured: of the bank
 * accounts, savings accounts and cards, the ones with a good share of the busiest one's recent
 * activity — which is what separates the account the salary lands in from an emergency fund that
 * sees a few transactions a month, whatever either is called.
 *
 * An account closed recently still counts. A household that swaps its card for another does not stop
 * spending the day the old one closes, and measuring only the new accounts would read their short
 * history as the whole story. What closed long ago has no recent activity and falls away by itself.
 */

const DAY_MS = 86400000;
const RECENT_DAYS = 180;
// A card taken up last month has little history yet and is already the one in use, so busy lately counts
// as much as busy over the half year.
const LATELY_DAYS = 45;
const BUSY_SHARE = 0.25;
const EVEN_SHARE = 0.02;
const EVERYDAY_TYPES = new Set(['Bank', 'Savings', 'Credit Card']);

const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const typeOf = (account) => account?.typeOverride ?? account?.type ?? parseAccount(account?.rawName).type;
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The bank accounts and cards that the household actually uses, or used until lately.
 *
 * @param accounts the account records
 * @param data     every row (`Date` as YYYY-MM-DD, `Account` as the export wrote it)
 * @returns the records, in the order given
 */
export function everydayAccounts(accounts, data) {
  if (!accounts?.length || !data?.length) return [];
  const newest = data.reduce((max, t) => (t.Date > max ? t.Date : max), '');
  if (!newest) return [];
  const through = dayNumber(newest);
  const windows = [RECENT_DAYS, LATELY_DAYS].map((days) => ({ since: through - days, counts: new Map() }));
  data.forEach((t) => {
    const day = dayNumber(t.Date);
    const id = accountIdOf(t.Account);
    windows.forEach((w) => {
      if (day >= w.since) w.counts.set(id, (w.counts.get(id) ?? 0) + 1);
    });
  });

  const candidates = accounts.filter((a) => !a.hidden && !a.external && EVERYDAY_TYPES.has(typeOf(a)));
  const busiest = windows.map((w) => Math.max(0, ...candidates.map((a) => w.counts.get(a.id) ?? 0)));
  if (!busiest[0]) return [];
  return candidates.filter((a) => windows.some((w, i) => busiest[i] > 0 && (w.counts.get(a.id) ?? 0) >= busiest[i] * BUSY_SHARE));
}

/**
 * What came in and what went out of those accounts, cycle by cycle, and the verdict.
 *
 * Read off a `processTransactionData` result for just those accounts, so transfers between them (a
 * card payment out of the cheque account) are already left out and only real income and real
 * spending are counted. The current cycle is unfinished, so it is returned (muted in the chart) but
 * never counted towards the typical figures; those are the median of the finished cycles, so one
 * odd month — a refinance, a bonus — does not decide the answer.
 *
 * @returns {{ rows: {month, income, spend, net, partial}[],
 *             typical: {income, spend, net}|null,
 *             verdict: 'short'|'ahead'|'even'|null,
 *             cycles: number, shortCycles: number }|null}
 */
export function everydayFlow(processed, { cycles = 6 } = {}) {
  const totals = processed?.totalsByMonth;
  if (!processed?.months?.length || !totals) return null;
  const rows = processed.months.slice(-cycles).map((month) => {
    const income = totals.Income?.[month] ?? 0;
    const spend = -(totals.Expense?.[month] ?? 0);
    return { month, income, spend, net: income - spend, partial: month === processed.currentMonth };
  });
  const done = rows.filter((r) => !r.partial);
  if (!done.length) return { rows, typical: null, verdict: null, cycles: 0, shortCycles: 0 };

  const typical = {
    income: median(done.map((r) => r.income)),
    spend: median(done.map((r) => r.spend)),
    net: median(done.map((r) => r.net)),
  };
  const slack = Math.max(1, typical.income) * EVEN_SHARE;
  const verdict = typical.net < -slack ? 'short' : typical.net > slack ? 'ahead' : 'even';
  return { rows, typical, verdict, cycles: done.length, shortCycles: done.filter((r) => r.net < 0).length };
}

/**
 * Net worth, and how it moved each month.
 *
 * `summary` is `summariseNetWorth`'s result. Each row is the change over one cycle; the last is the
 * cycle in progress, so it says how far it has moved so far rather than a full month's change.
 *
 * @returns {{ now, sinceLast, rows: {month, net, change, partial}[], up, of, complete, missing, estimated }|null}
 */
export function netWorthTrend(summary, { currentMonth = null, cycles = 6 } = {}) {
  const by = summary?.byMonth;
  if (!summary?.knownCount || !by || by.length < 2) return null;
  const rows = by
    .map((p, i) => (i === 0 ? null : { month: p.month, net: p.net, change: p.net - by[i - 1].net, partial: p.month === (currentMonth ?? by[by.length - 1].month) }))
    .filter(Boolean)
    .slice(-cycles);
  const done = rows.filter((r) => !r.partial);
  const last = rows[rows.length - 1];
  return {
    now: summary.net,
    sinceLast: last.change,
    rows,
    up: done.filter((r) => r.change > 0).length,
    of: done.length,
    complete: Boolean(summary.complete),
    missing: summary.missing ?? [],
    estimated: summary.estimated ?? [],
  };
}
