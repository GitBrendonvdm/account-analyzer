import { spendRows } from './flows';
import { groupByMerchant } from './merchants';
import { mondayIndexOfDay } from './weeklyEnvelope';
import { parseTransactionDate } from '../utils/date';

/**
 * Spending habits — the part of the data the app could always see and never described.
 *
 * Four questions, all answerable from rows that were already loaded:
 *
 *   Who do I pay?          top merchants by amount and by how often
 *   What bills me monthly? merchants present in nearly every cycle, and what they cost a year
 *   What's changing?       category spend in the second half of the window against the first
 *   When do I spend?       the weekday shape of a typical cycle
 *
 * Loan-account rows and transfers are excluded throughout, for the same reason the main table
 * excludes them: they aren't spending, they're the same money moving or the same cost counted
 * twice. The spend filter itself lives in `flows.js` so that "spend" means the same rows here as
 * everywhere else; given the full-file transfer set it also drops a repayment whose other leg
 * fell outside the visible window, which the window-scoped `processed.transferIds` cannot see.
 */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** A merchant billing in this share of cycles is a standing commitment, not a habit. */
const RECURRING_RATIO = 0.8;

function cycleTotals(items, months) {
  const byMonth = new Map();
  items.forEach((t) => {
    byMonth.set(t['Pay Month'], (byMonth.get(t['Pay Month']) ?? 0) + Math.abs(t.AmountNum));
  });
  return months.map((m) => byMonth.get(m) ?? 0);
}

/**
 * @param data              every row
 * @param selectedAccounts  raw account names to keep
 * @param processed         processTransactionData(...) — supplies the window and, failing a full
 *                          transfer set, its own window-scoped transferIds
 * @param options           transfers: buildFullTransfers(data) (wiring); optional until then
 */
export function buildHabits(data, selectedAccounts, processed, { transfers = null } = {}) {
  if (!data?.length || !processed?.months?.length) return null;
  const { months, transferIds } = processed;
  const rows = transfers
    ? spendRows(data, { transfers, selectedAccounts, months })
    : spendRows(data, { selectedAccounts, months }).filter((t) => !transferIds?.has(t.id));
  if (rows.length === 0) return null;

  const cycles = months.length;
  const totalSpend = rows.reduce((s, t) => s + Math.abs(t.AmountNum), 0);

  // ---- merchants ---------------------------------------------------------------------------
  const grouped = groupByMerchant(rows);
  const merchants = [...grouped.values()]
    .map((m) => {
      const total = m.items.reduce((s, t) => s + Math.abs(t.AmountNum), 0);
      const present = new Set(m.items.map((t) => t['Pay Month']));
      const perCycleTotals = cycleTotals(m.items, months);
      const categories = [...new Set(m.items.map((t) => t.Category))];
      const last = m.items
        .map((t) => t.DateObj ?? parseTransactionDate(t.Date))
        .filter(Boolean)
        .sort((a, b) => b - a)[0];
      return {
        ...m,
        total,
        perCycle: total / cycles,
        count: m.items.length,
        countPerCycle: m.items.length / cycles,
        cyclesPresent: present.size,
        presence: present.size / cycles,
        perCycleTotals,
        category: categories[0] ?? 'Uncategorised',
        categories,
        lastSeen: last ?? null,
        share: totalSpend > 0 ? total / totalSpend : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  // ---- standing commitments ----------------------------------------------------------------
  // Present in nearly every cycle. Amount consistency is reported but not required: a variable
  // utility bill is still a commitment, and a card charging a different amount monthly is still a
  // subscription you'd have to cancel.
  //
  // The bond, the car and the personal loan qualify on the same test as Netflix does, which is
  // true but useless as one number — "R63 352 a cycle in subscriptions" invites you to imagine
  // cancelling a bond. So the total is broken down by the export's own Spending Group, and the
  // instalments are separated from the things you could actually stop paying.
  const recurring = merchants
    .filter((m) => m.presence >= RECURRING_RATIO && m.cyclesPresent >= 3)
    .sort((a, b) => b.perCycle - a.perCycle);

  const groupOf = (m) => m.items[0]?.['Spending Group'] || 'Other';
  const byGroup = new Map();
  recurring.forEach((m) => {
    const g = groupOf(m);
    byGroup.set(g, (byGroup.get(g) ?? 0) + m.perCycle);
  });

  // An allowlist, not a denylist. Excluding only debt and insurance left groceries and the
  // pharmacy in a bucket headed "could be cancelled", which is not a suggestion anyone should
  // take. These two groups are where optional services actually live.
  const OPTIONAL_GROUPS = new Set(['Recurring', 'Communications']);
  const discretionary = recurring.filter((m) => OPTIONAL_GROUPS.has(groupOf(m)));

  const subscriptions = {
    items: recurring,
    count: recurring.length,
    total: recurring.reduce((s, m) => s + m.perCycle, 0),
    share: totalSpend > 0 ? recurring.reduce((s, m) => s + m.total, 0) / totalSpend : 0,
    byGroup: [...byGroup.entries()]
      .map(([group, perCycle]) => ({ group, perCycle }))
      .sort((a, b) => b.perCycle - a.perCycle),
    // What's actually cancellable — everything that isn't an instalment or a policy.
    cancellable: discretionary,
    cancellableTotal: discretionary.reduce((s, m) => s + m.perCycle, 0),
  };

  // ---- what's changing ---------------------------------------------------------------------
  const half = Math.floor(cycles / 2);
  const earlyMonths = new Set(months.slice(0, half));
  const lateMonths = new Set(months.slice(half));
  const byCategory = new Map();
  rows.forEach((t) => {
    if (!byCategory.has(t.Category)) byCategory.set(t.Category, { early: 0, late: 0, total: 0 });
    const e = byCategory.get(t.Category);
    const v = Math.abs(t.AmountNum);
    e.total += v;
    if (earlyMonths.has(t['Pay Month'])) e.early += v;
    if (lateMonths.has(t['Pay Month'])) e.late += v;
  });
  const movers = [...byCategory.entries()]
    .map(([category, v]) => {
      const early = v.early / Math.max(1, half);
      const late = v.late / Math.max(1, cycles - half);
      return { category, early, late, delta: late - early, total: v.total, perCycle: v.total / cycles };
    })
    .filter((m) => Math.abs(m.delta) > 100)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // ---- rhythm ------------------------------------------------------------------------------
  const weekday = DAY_NAMES.map((day) => ({ day, amount: 0, count: 0 }));
  rows.forEach((t) => {
    const d = t.DateObj ?? parseTransactionDate(t.Date);
    if (!d) return;
    const slot = weekday[mondayIndexOfDay(d)];
    slot.amount += Math.abs(t.AmountNum);
    slot.count += 1;
  });
  weekday.forEach((w) => { w.perCycle = w.amount / cycles; });
  const busiest = [...weekday].sort((a, b) => b.amount - a.amount)[0];
  const quietest = [...weekday].sort((a, b) => a.amount - b.amount)[0];

  return {
    merchants,
    topMerchants: merchants.slice(0, 20),
    byFrequency: [...merchants].sort((a, b) => b.count - a.count).slice(0, 20),
    subscriptions,
    movers,
    weekday,
    busiest,
    quietest,
    totalSpend,
    perCycleSpend: totalSpend / cycles,
    cycles,
    months,
  };
}
