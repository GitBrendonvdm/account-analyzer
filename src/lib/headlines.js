import { formatCurrencyAbs } from '../utils/format';

/**
 * The app's voice.
 *
 * Everything below was already computable — the deficit, what funds it, what the debt costs, which
 * category moved. The app printed all of it as cells and left the reading entirely to the person.
 * That's a fine spreadsheet and a poor tool: the single most important fact on the screen looked
 * exactly like the twentieth most important.
 *
 * So this turns four or five of those numbers into sentences, ranked by how much money they're
 * about. Every headline carries the figure it came from, because a claim without its arithmetic is
 * just an opinion.
 */

const R = (n) => formatCurrencyAbs(n);

/** Rough count of cycles until a growing balance meets its limit. */
function cyclesToLimit(available, growthPerCycle) {
  if (!(growthPerCycle > 0) || !(available > 0)) return null;
  return Math.floor(available / growthPerCycle);
}

export function buildHeadlines({
  summary,
  processed,
  positions = [],
  netWorth = null,
  costOfDebt = null,
  headroom = [],
  habits = null,
}) {
  if (!summary || !processed) return [];
  const out = [];
  const cycles = processed.months.length;
  const netAvg = processed.netAvg ?? 0;

  // ---- 1. The gap, and what's covering it -------------------------------------------------
  const liabilities = positions.filter((p) => p.isLiability);
  const worsened = liabilities
    .filter((p) => p.windowChange < 0)
    .sort((a, b) => a.windowChange - b.windowChange);
  const worstCard = worsened.find((p) => p.type === 'Credit Card');

  if (netAvg < -500) {
    const funded = worstCard
      ? ` It's being carried by the ${worstCard.label ?? worstCard.account}, which took on ${R(worstCard.windowChange)} more debt over ${cycles} cycles.`
      : '';
    out.push({
      id: 'deficit',
      tone: 'critical',
      weight: Math.abs(netAvg) * 12,
      text: `You spend about ${R(netAvg)} more than you earn in a typical cycle.${funded}`,
      detail: `${R(processed.incomeAvg)} in, ${R(processed.expenseAvg)} out, averaged over ${cycles} cycles with outlier cycles capped.`,
    });
  } else if (netAvg > 500) {
    out.push({
      id: 'surplus',
      tone: 'good',
      weight: netAvg * 12,
      text: `You keep about ${R(netAvg)} in a typical cycle.`,
      detail: `${R(processed.incomeAvg)} in, ${R(processed.expenseAvg)} out, averaged over ${cycles} cycles.`,
    });
  }

  // ---- 2. What the debt costs -------------------------------------------------------------
  if (costOfDebt && costOfDebt.perCycle > 100) {
    const worst = costOfDebt.accounts[0];
    const share = worst ? Math.round((worst.total / costOfDebt.total) * 100) : 0;
    out.push({
      id: 'cost-of-debt',
      tone: 'critical',
      weight: costOfDebt.perYear,
      text: `Interest and fees cost ${R(costOfDebt.perCycle)} a cycle — ${R(costOfDebt.perYear)} a year.`,
      detail: worst
        ? `${share}% of it is the ${worst.short || worst.account}, at ${R(worst.perCycle)} a cycle. This sits outside the spending table on purpose: it's already inside the instalments, so counting it there would bill it twice.`
        : 'This sits outside the spending table on purpose — it is already inside the instalments.',
    });
  }

  // ---- 3. Where the cards are heading -----------------------------------------------------
  const pressing = headroom.find((h) => h.used > 0.5);
  if (pressing && worstCard) {
    const growth = Math.abs(worstCard.windowChange) / cycles;
    const left = cyclesToLimit(pressing.available, growth);
    out.push({
      id: 'card-limit',
      tone: left != null && left <= 6 ? 'critical' : 'warning',
      weight: Math.abs(worstCard.windowChange),
      text:
        left != null
          ? `The ${pressing.account} is ${Math.round(pressing.used * 100)}% used, with ${R(pressing.available)} left — ${left === 0 ? 'less than one cycle' : `about ${left} cycle${left === 1 ? '' : 's'}`} at the current rate.`
          : `The ${pressing.account} is ${Math.round(pressing.used * 100)}% used, with ${R(pressing.available)} left.`,
      detail: `Growing ${R(growth)} a cycle across the visible window.`,
    });
  } else if (worsened.length > 0 && !worstCard) {
    const w = worsened[0];
    out.push({
      id: 'debt-growing',
      tone: 'warning',
      weight: Math.abs(w.windowChange),
      text: `Debt on the ${w.label ?? w.account} grew ${R(w.windowChange)} over ${cycles} cycles.`,
      detail: 'Higher is better on a position: a card going more negative is more owed.',
    });
  }

  // ---- 4. Net worth, if it can be valued ---------------------------------------------------
  if (netWorth?.knownCount > 0) {
    const dir = netWorth.change >= 0 ? 'up' : 'down';
    out.push({
      id: 'net-worth',
      tone: netWorth.change >= 0 ? 'good' : 'warning',
      weight: Math.abs(netWorth.change),
      text: `Net worth is ${netWorth.net < 0 ? `−${R(netWorth.net)}` : R(netWorth.net)}, ${dir} ${R(netWorth.change)} over ${cycles} cycles.`,
      detail: netWorth.complete
        ? `${R(netWorth.assets)} held against ${R(netWorth.debt)} owed.`
        : `Counting ${netWorth.knownCount} of ${netWorth.totalCount} accounts — no balance yet for ${netWorth.missing.slice(0, 3).join(', ')}${netWorth.missing.length > 3 ? ` and ${netWorth.missing.length - 3} more` : ''}.`,
    });
  }

  // ---- 5. What moved most ------------------------------------------------------------------
  if (habits?.movers?.length) {
    const up = habits.movers[0];
    if (up && Math.abs(up.delta) > 500) {
      out.push({
        id: 'category-move',
        tone: up.delta > 0 ? 'warning' : 'good',
        weight: Math.abs(up.delta) * 6,
        text: `${up.category} is ${up.delta > 0 ? 'up' : 'down'} ${R(up.delta)} a cycle against the first half of the window.`,
        detail: `${R(up.early)} a cycle then, ${R(up.late)} now.`,
      });
    }
  }

  // ---- 6. Standing commitments -------------------------------------------------------------
  if (habits?.subscriptions?.total > 1000) {
    out.push({
      id: 'subscriptions',
      tone: 'neutral',
      weight: habits.subscriptions.total * 6,
      text: `${habits.subscriptions.count} merchants bill you every cycle, together ${R(habits.subscriptions.total)} — ${R(habits.subscriptions.total * 12)} a year.`,
      detail: 'Standing orders, debit orders and subscriptions that landed in nearly every cycle.',
    });
  }

  // ---- 7. Conditions that invalidate everything above ---------------------------------------
  if (summary.staleLevel === 'alarm') {
    out.unshift({
      id: 'stale',
      tone: 'critical',
      weight: Infinity,
      text: `The data is ${summary.staleDays} days old — everything below is missing that much spend.`,
      detail: 'Import a fresh export before trusting the current cycle.',
    });
  }

  if (summary.missedPayments.length > 0) {
    out.push({
      id: 'overdue',
      tone: 'warning',
      weight: summary.missedPayments.reduce((s, m) => s + Math.abs(m.expected), 0),
      text: `${summary.missedPayments.length} regular payment${summary.missedPayments.length === 1 ? '' : 's'} usually landed by now and hasn't: ${summary.missedPayments.map((m) => m.name).join(', ')}.`,
      detail: 'Judged on payments that repeat at a consistent amount, measured against the data rather than the calendar.',
    });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 5);
}
