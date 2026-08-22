import { parseAccount } from './accounts';

/**
 * What carrying the debt costs.
 *
 * The main table deliberately can't show this. `processTransactionData` drops loan accounts from
 * the flows entirely, because the interest, service fee and insurance charged inside a loan are
 * already contained in the instalment leaving the bank — counting both would bill the same money
 * twice, and on this data that meant R21k a cycle on the bond alone.
 *
 * The arithmetic is right, but it has a cost of its own: the single largest thing happening to this
 * person's money — roughly R31 000 a cycle, R376 000 a year — appears nowhere in the app. So this
 * module reads the same rows as ANALYSIS rather than as spend. Nothing here feeds the flows, the
 * net total, or any forecast. It exists to answer "what is the debt costing me", which is a
 * different question from "what did I spend".
 */

export const COST_CATEGORIES = new Set(['Interest', 'Bank Charges']);

/**
 * Fee-like descriptions that aren't categorised as such by the export. Shared with the fees audit
 * and the rate inferrer, which is why the list reaches past what this panel needs: the per-
 * transaction fees, the card's budget finance charge and the loan's credit-life premium all cost
 * money the same way, and three modules keeping three lists would drift apart.
 */
export const COST_DESCRIPTION =
  /\b(finance charge|service fee|initiation fee|admin fee|account fee|monthly fee|insurance premium|protection ins|vat on fee|payment fee|electronic trf fee|declined auth fee|cpp insurance|budget finance charge)\b/i;

/** Money out that is a cost of carrying the account: interest, a fee, or cover sold inside the debt. */
export function isCost(t) {
  if (t.AmountNum >= 0) return false;
  return COST_CATEGORIES.has(t.Category) || COST_DESCRIPTION.test(t.Description ?? '');
}

/**
 * @param data   every row, loan accounts included — that's the point
 * @param months the visible pay-cycle window
 * @returns per-account cost, the total, and the per-cycle series
 */
export function buildCostOfDebt(data, selectedAccounts, months) {
  if (!data?.length || !months?.length) return null;
  const selected = new Set(selectedAccounts);
  const visible = new Set(months);
  const byAccount = new Map();
  const byMonth = Object.fromEntries(months.map((m) => [m, 0]));

  data.forEach((t) => {
    if (!selected.has(t.Account) || !visible.has(t['Pay Month']) || !isCost(t)) return;
    const cost = -t.AmountNum;
    if (!byAccount.has(t.Account)) {
      byAccount.set(t.Account, { account: t.Account, ...parseAccount(t.Account), total: 0, byMonth: {} });
    }
    const entry = byAccount.get(t.Account);
    entry.total += cost;
    entry.byMonth[t['Pay Month']] = (entry.byMonth[t['Pay Month']] ?? 0) + cost;
    byMonth[t['Pay Month']] += cost;
  });

  const cycles = months.length;
  const accounts = [...byAccount.values()]
    .map((a) => ({ ...a, perCycle: a.total / cycles }))
    .sort((a, b) => b.total - a.total);

  const total = accounts.reduce((s, a) => s + a.total, 0);
  const series = months.map((m) => ({ month: m, cost: byMonth[m] }));

  // Is it getting better or worse? Compare the first and second halves of the window.
  const half = Math.floor(cycles / 2);
  const early = series.slice(0, half).reduce((s, x) => s + x.cost, 0) / Math.max(1, half);
  const late = series.slice(half).reduce((s, x) => s + x.cost, 0) / Math.max(1, cycles - half);

  return {
    accounts,
    series,
    total,
    perCycle: total / cycles,
    perYear: (total / cycles) * 12,
    trend: late - early,
    cycles,
  };
}
