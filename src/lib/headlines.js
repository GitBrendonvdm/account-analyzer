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
 *
 * Nothing here computes. Every figure is read off a builder that owns it — the debt budget, the
 * plans, the vitals, the recurring engine, the savings finder — so a headline can never disagree
 * with the view it points at. That is also why every input past the first seven is optional: the
 * builders land in the app one at a time, and a caller that has only the old seven still gets the
 * old headlines. A missing builder means a missing headline, never a thrown one.
 *
 * Two sources were retired on purpose. `summary.missedPayments` judged "overdue" by amount
 * consistency and called the vehicle loan late every month; the recurring engine's `overdue` list
 * knows the day a line usually lands. And the "n merchants bill you every cycle" line invited the
 * reader to imagine cancelling a bond; the finder's `found` counts only what could be cancelled.
 */

const R = (n) => formatCurrencyAbs(n);
const TOP = 5;
const STRATEGY_LABEL = {
  minimum: 'Minimum',
  avalanche: 'Avalanche',
  snowball: 'Snowball',
  lifetime: 'Lifetime',
  shortTerm: 'Short-term',
  custom: 'Custom',
};
/** Steps whose `from`/`to` are rates; an instalment recast carries instalment amounts instead. */
const RATE_STEP_KINDS = new Set(['rateStep', 'termDrift']);

const finite = (x, fallback = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Mar 2050" — the month a plan clears or a rate moved. */
function monthYear(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : null;
}

/** Rates are nominal fractions (0.0933); a caller that hands over a percentage is forgiven. */
function asRate(r) {
  const x = finite(r);
  return Math.abs(x) > 1 ? x / 100 : x;
}
const pctOf = (rate) => `${(asRate(rate) * 100).toFixed(2)}%`;

/** Rough count of cycles until a growing balance meets its limit. */
function cyclesToLimit(available, growthPerCycle) {
  if (!(growthPerCycle > 0) || !(available > 0)) return null;
  return Math.floor(available / growthPerCycle);
}

/** Rate steps arrive as the flat list App builds; a per-account nesting is flattened, junk dropped. */
function rateStepsOf(rateSteps) {
  const flat = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'object') flat.push(x);
  };
  walk(rateSteps);
  return flat.filter(
    (s) => RATE_STEP_KINDS.has(s.kind) && toDate(s.date) && Number.isFinite(s.from) && Number.isFinite(s.to),
  );
}

/** The account a step belongs to: the explicit field, else the first segment of its id. */
function accountIdOfStep(step) {
  if (step.accountId) return String(step.accountId);
  // Account ids are `bank|mask`, so the id is parsed from the end: the last two segments are the
  // date and the kind.
  const parts = String(step.id ?? '').split('|');
  return (parts.length > 2 ? parts.slice(0, -2).join('|') : parts[0]) || null;
}

export function buildHeadlines({
  summary,
  processed,
  positions = [],
  netWorth = null,
  costOfDebt = null,
  headroom = [],
  habits = null,
  vitals = null,
  direction = null,
  plans = null,
  debtBudget = null,
  rateSteps = null,
  upcoming = null,
  subscriptions = null,
  finder = null,
  drift = null,
} = {}) {
  if (!summary || !processed) return [];
  const out = [];
  const pos = Array.isArray(positions) ? positions : [];
  const room = Array.isArray(headroom) ? headroom : [];
  const cycles = processed.months?.length ?? 0;
  const netAvg = finite(processed.netAvg);

  // ---- 1. The gap, and what's covering it -------------------------------------------------
  const liabilities = pos.filter((p) => p.isLiability);
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

  // ---- 2. What the gap costs, from the debt budget ---------------------------------------
  if (debtBudget && debtBudget.deficitPerCycle > 0 && debtBudget.deficitCost12 > 0) {
    const rate = debtBudget.absorberRate != null ? ` at ${pctOf(debtBudget.absorberRate)}` : '';
    out.push({
      id: 'deficit-cost',
      tone: 'critical',
      weight: finite(debtBudget.deficitCost12),
      text: `Running ${R(debtBudget.deficitPerCycle)} a cycle short costs about ${R(debtBudget.deficitCost12)} in card interest over the next year.`,
      detail: debtBudget.absorberLabel
        ? `The gap lands on the ${debtBudget.absorberLabel}${rate}; the plans assume no extra payments until it closes.`
        : `No card balance is typed, so this assumes the gap lands on a card${rate} — type a card balance and rate to replace it.`,
    });
  }

  // ---- 3. What the debt costs -------------------------------------------------------------
  if (costOfDebt && costOfDebt.perCycle > 100) {
    const worst = costOfDebt.accounts?.[0];
    const share = worst && costOfDebt.total > 0 ? Math.round((worst.total / costOfDebt.total) * 100) : 0;
    out.push({
      id: 'cost-of-debt',
      tone: 'critical',
      weight: finite(costOfDebt.perYear),
      text: `Interest and fees cost ${R(costOfDebt.perCycle)} a cycle — ${R(costOfDebt.perYear)} a year.`,
      detail: worst
        ? `${share}% of it is the ${worst.short || worst.account}, at ${R(worst.perCycle)} a cycle. This sits outside the spending table on purpose: it's already inside the instalments, so counting it there would bill it twice.`
        : 'This sits outside the spending table on purpose — it is already inside the instalments.',
    });
  }

  // ---- 4. The best plan, when there is a debt to plan around ------------------------------
  const bestName = plans?.best?.byInterest;
  const bestRow = bestName ? (plans.table ?? []).find((r) => r.strategy === bestName) : null;
  const bestPlan = bestName ? plans[bestName] : null;
  const hasDebt = bestPlan?.order ? bestPlan.order.length > 0 : Boolean(bestRow?.debtFreeDate);
  const saved = finite(bestRow?.interestSavedVsMinimum);
  if (bestRow && bestName !== 'minimum' && hasDebt && !bestPlan?.reachedCap && monthYear(bestRow.debtFreeDate) && saved > 0) {
    const minimum = (plans.table ?? []).find((r) => r.strategy === 'minimum');
    const sooner = finite(bestRow.monthsSavedVsMinimum);
    out.push({
      id: 'debt-plan',
      tone: 'good',
      weight: saved,
      text: `${STRATEGY_LABEL[bestName] ?? bestName} clears everything by ${monthYear(bestRow.debtFreeDate)}, ${R(saved)} less interest than paying only the minimums.`,
      detail:
        `${sooner > 0 ? `${plural(sooner, 'month')} sooner` : 'The same date'}${minimum && monthYear(minimum.debtFreeDate) ? ` than the minimum-only path (${monthYear(minimum.debtFreeDate)})` : ''}` +
        `; ${R(bestRow.totalInterest)} of interest in total.`,
    });
  }

  // ---- 5. A rate that moved ----------------------------------------------------------------
  const steps = rateStepsOf(rateSteps).sort((a, b) => toDate(b.date) - toDate(a.date));
  if (steps.length) {
    const step = steps[0];
    const accountId = accountIdOfStep(step);
    const position = pos.find((p) => (p.accountId ?? p.id) === accountId) ?? null;
    const label = step.label ?? position?.label ?? plans?.minimum?.labels?.[accountId] ?? 'loan';
    const balance = Math.abs(
      finite(step.balance, finite(position?.balance, finite(plans?.minimum?.schedule?.[0]?.byDebt?.[accountId]?.open))),
    );
    const term = Number.isFinite(step.remainingMonths)
      ? step.remainingMonths
      : plans?.minimum?.perDebt?.[accountId]?.clearedMonth ?? null;
    const termClause = Number.isFinite(term) ? `; at the unchanged instalment the term is now ${Math.round(term)} months.` : '.';
    out.push({
      id: 'rate-step',
      tone: 'neutral',
      weight: Math.abs(asRate(step.to) - asRate(step.from)) * balance,
      text: `Your ${label} rate moved to ${pctOf(step.to)} in ${monthYear(step.date)}${termClause}`,
      detail: `Was ${pctOf(step.from)}. Read off the account's own interest postings, not the bank's letter.`,
    });
  }

  // ---- 6. The vitals: debt service and runway ----------------------------------------------
  const dsr = vitals?.vitals?.debtServiceRatio;
  if (dsr && Number.isFinite(dsr.value) && (dsr.tone === 'bad' || dsr.tone === 'warn')) {
    const n = Math.max(1, vitals.window?.short?.length ?? 1);
    const c = dsr.components ?? {};
    const instalments = finite(c.instalments) / n;
    const cardCost = finite(c.cardCost) / n;
    const cardMinimum = finite(c.cardMinimum) / n;
    const service = instalments + cardCost + cardMinimum;
    const income = dsr.value > 0 ? service / dsr.value : 0;
    const pct = Math.round(dsr.value * 100);
    out.push({
      id: 'dsr',
      tone: dsr.tone === 'bad' ? 'critical' : 'warning',
      weight: (instalments + cardCost) * 12,
      text:
        service > 0 && income > 0
          ? `Debt service takes ${pct}% of income — ${R(service)} of ${R(income)} a cycle goes to instalments and card interest.`
          : `Debt service takes ${pct}% of income.`,
      detail:
        `Pooled over the last ${plural(n, 'cycle')}: ${R(instalments)} in instalments, ${R(cardCost)} in card interest` +
        `${cardMinimum > 0 ? `, ${R(cardMinimum)} in card minimums` : ''} a cycle.` +
        `${dsr.direction === 'worsening' ? ' Worse than the 12-cycle figure.' : dsr.direction === 'improving' ? ' Better than the 12-cycle figure.' : ''}`,
    });
  }

  const runway = vitals?.vitals?.liquidityRunway;
  if (runway && Number.isFinite(runway.value) && runway.tone !== 'good') {
    const crisis = runway.value < 1;
    const n = runway.value.toFixed(1);
    const partial = runway.knownCount != null && runway.totalCount != null && runway.knownCount < runway.totalCount;
    out.push({
      id: 'runway',
      tone: crisis ? 'critical' : 'warning',
      weight: finite(runway.medianSpend) * 12,
      text: crisis
        ? `Your cash covers ${n} cycles of spending; one late salary is a crisis.`
        : `Your cash covers ${n} ${n === '1.0' ? 'cycle' : 'cycles'} of spending.`,
      detail: `${R(runway.liquidAssets)} in Bank and Savings against a median ${R(runway.medianSpend)} a cycle${partial ? ` (${runway.knownCount} of ${runway.totalCount} balances known)` : ''}.`,
    });
  }

  // ---- 7. Which way it is going ------------------------------------------------------------
  const dir = direction?.summary;
  if (dir?.widening && Number.isFinite(dir.netShort) && Number.isFinite(dir.netLong)) {
    const signed = (x) => (x < 0 ? `−${R(x)}` : `+${R(x)}`);
    const prior = Number.isFinite(dir.netPrior) ? `, and ${R(dir.netPrior)} the year before` : '';
    out.push({
      id: 'direction',
      tone: 'warning',
      weight: Math.abs(dir.netShort - dir.netLong) * 12,
      text:
        dir.netShort < 0
          ? `The gap is widening: ${R(dir.netShort)} a cycle over the last 3 cycles against ${R(dir.netLong)} over the last 12${prior}.`
          : `The surplus is shrinking: ${R(dir.netShort)} a cycle over the last 3 cycles against ${R(dir.netLong)} over the last 12${prior}.`,
      detail: `Net per cycle: ${signed(dir.netShort)} over 3, ${signed(dir.netLong)} over 12${Number.isFinite(dir.netPrior) ? `, ${signed(dir.netPrior)} the 12 before` : ''}. Income is the median, so one windfall cannot move it.`,
    });
  }

  // ---- 8. Payments that usually landed by now -----------------------------------------------
  const overdue = Array.isArray(upcoming?.overdue) ? upcoming.overdue.filter(Boolean) : [];
  if (overdue.length) {
    const n = overdue.length;
    const labels = overdue.map((l) => l.label).filter(Boolean);
    out.push({
      id: 'overdue',
      tone: 'warning',
      weight: overdue.reduce((s, l) => s + Math.abs(finite(l.amount, finite(l.perCycle))), 0),
      text: `${plural(n, 'payment')} usually landed by now and ${n === 1 ? "hasn't" : "haven't"}${labels.length ? `: ${labels.join(', ')}` : ''}.`,
      detail: 'Judged on lines that repeat at a steady day of the cycle, measured against the data rather than the calendar.',
    });
  }

  // ---- 9. A charge that is new ---------------------------------------------------------------
  const fresh = (Array.isArray(subscriptions?.newLines) ? subscriptions.newLines : []).filter((l) => l?.headline);
  if (fresh.length) {
    const total = fresh.reduce((s, l) => s + finite(l.perCycle), 0);
    const since = subscriptions.newSince?.label ? ` since ${subscriptions.newSince.label}` : '';
    const labels = fresh.map((l) => l.label).filter(Boolean);
    out.push({
      id: 'new-charge',
      tone: 'warning',
      weight: total * 12,
      text:
        fresh.length === 1
          ? `New${since}: ${labels[0] ?? 'a charge'} — ${fresh[0].wording ?? 'new regular charge'}, ${R(fresh[0].perCycle)} a cycle.`
          : `${fresh.length} new charges${since}: ${labels.join(', ')} — together ${R(total)} a cycle.`,
      detail: `${R(total * 12)} a year if ${fresh.length === 1 ? 'it stays' : 'they all stay'}. A charge this new is the one most worth a second look.`,
    });
  }

  // ---- 10. What could be cancelled --------------------------------------------------------------
  if (finder && finite(finder.found) > 0) {
    const cover = Number.isFinite(finder.cover) ? ` — ${Math.round(finder.cover * 100)}% of the gap` : '';
    const behavioural = finite(finder.behaviouralPotential);
    out.push({
      id: 'found',
      tone: 'good',
      weight: finder.found * 12,
      text: `${R(finder.found)} a cycle of cancellable spend found${cover}.`,
      detail: `${R(finite(finder.foundPerYear, finder.found * 12))} a year, counting only cancellable items at high or medium confidence${behavioural > 0 ? `; ${R(behavioural)} more a cycle if the trips and drift change` : ''}.`,
    });
  }

  // ---- 11. What moved most -----------------------------------------------------------------------
  if (drift) {
    const moved = Array.isArray(drift.flagged) ? drift.flagged[0] : null;
    if (moved && Math.abs(finite(moved.delta)) > 0) {
      const down = moved.direction === 'down' || moved.delta < 0;
      out.push({
        id: 'category-move',
        tone: down ? 'good' : 'warning',
        weight: Math.abs(moved.delta) * 6,
        text: `${moved.category ?? 'A category'} is ${down ? 'down' : 'up'} ${R(moved.delta)} a cycle against its usual ${R(moved.baselineMedian)}.`,
        detail: moved.sentence ?? `${R(moved.baselineMedian)} a cycle usually, ${R(moved.recentMedian)} over the last ${plural(drift.recent?.length ?? 3, 'cycle')}.`,
      });
    }
  } else if (habits?.movers?.length) {
    const up = habits.movers[0];
    if (up && Math.abs(finite(up.delta)) > 500) {
      out.push({
        id: 'category-move',
        tone: up.delta > 0 ? 'warning' : 'good',
        weight: Math.abs(up.delta) * 6,
        text: `${up.category} is ${up.delta > 0 ? 'up' : 'down'} ${R(up.delta)} a cycle against the first half of the window.`,
        detail: `${R(up.early)} a cycle then, ${R(up.late)} now.`,
      });
    }
  }

  // ---- 12. Where the cards are heading -----------------------------------------------------
  const pressing = room.find((h) => h.used > 0.5);
  if (pressing && worstCard) {
    const growth = cycles > 0 ? Math.abs(worstCard.windowChange) / cycles : 0;
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

  // ---- 13. Net worth, if it can be valued ---------------------------------------------------
  if (netWorth?.knownCount > 0) {
    const change = finite(netWorth.change);
    const net = finite(netWorth.net);
    const missing = Array.isArray(netWorth.missing) ? netWorth.missing : [];
    out.push({
      id: 'net-worth',
      tone: change >= 0 ? 'good' : 'warning',
      weight: Math.abs(change),
      text: `Net worth is ${net < 0 ? `−${R(net)}` : R(net)}, ${change >= 0 ? 'up' : 'down'} ${R(change)} over ${cycles} cycles.`,
      detail: netWorth.complete
        ? `${R(netWorth.assets)} held against ${R(netWorth.debt)} owed.`
        : `Counting ${netWorth.knownCount} of ${netWorth.totalCount} accounts — no balance yet for ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`,
    });
  }

  // ---- 14. Conditions that invalidate everything above ---------------------------------------
  const stale =
    summary.staleLevel === 'alarm'
      ? {
          id: 'stale',
          tone: 'critical',
          weight: Infinity,
          text: `The data is ${finite(summary.staleDays)} days old — everything below is missing that much spend.`,
          detail: 'Import a fresh export before trusting the current cycle.',
        }
      : null;

  // A weight that is not a number would make the sort undefined; it ranks last instead.
  const ranked = out
    .map((h) => ({ ...h, weight: finite(h.weight) }))
    .sort((a, b) => b.weight - a.weight);
  return (stale ? [stale, ...ranked] : ranked).slice(0, TOP);
}
