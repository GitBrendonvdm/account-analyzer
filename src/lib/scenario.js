import { simulatePlan, monthlyRate } from './debtPlan';
import { annuity } from './inferRates';

/**
 * "If I pay off the car in the next three months, what do I get?"
 *
 * Every other debt tool here answers a question about money — a rand of extra, a lump, a rate
 * shift. This one answers a question about a DECISION: pick a debt and a horizon, and it says what
 * that decision costs a cycle, what it frees and from when, how the freed instalment rolls onto
 * the next debt and pulls its payoff forward, where everything ends up, and what it does to the
 * share of income going to debt. It runs the same engine as the rest of the Debt view, so the
 * figures agree with the plan on screen: the baseline is the plan as currently set, and the
 * scenario is that plan with the chosen debt moved to the front and exactly enough extra, for
 * exactly that many cycles, to clear it in time.
 *
 * "Exactly enough" is found by bisection over the engine rather than by the annuity formula,
 * because the plan may already be sending extra, lumps or a deficit inflow to that debt and the
 * formula cannot see any of it. The annuity is the first guess.
 */

export const SCENARIO_HORIZONS = [3, 6, 12, 24];
const TOLERANCE = 10;
const MAX_ITER = 40;

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const fmtDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-ZA', MONTH_YEAR) : null);
const fmtRand = (n) => `R ${Math.round(Math.abs(n)).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The plain word for a liability — people say "the car", not "Loan *4081". */
export function kindWord(debt) {
  const k = debt?.kind;
  if (k === 'vehicle') return 'car';
  if (k === 'bond' || k === 'home') return 'bond';
  if (k === 'personal') return 'personal loan';
  if (k === 'card' || debt?.type === 'Credit Card') return 'card';
  return 'loan';
}
export const describeDebt = (debt) => `${debt.label} (${kindWord(debt)})`;

/** The engine's order with `targetId` moved to the front. */
function orderWithFirst(order, targetId, debts) {
  const base = order?.length ? order : debts.map((d) => d.id);
  return [targetId, ...base.filter((id) => id !== targetId)];
}

/** Extra per period: `boost` for the first `months` periods on top of the base extra, then base (or boost kept). */
function extraSchedule(baseExtra, boost, months, keepPaying, horizon) {
  const at = (i) => (Array.isArray(baseExtra) ? (baseExtra[Math.min(i, baseExtra.length - 1)] ?? 0) : Number(baseExtra) || 0);
  const out = [];
  for (let i = 0; i < horizon; i += 1) out.push(at(i) + (i < months || keepPaying ? boost : 0));
  return out;
}

function runWith(debts, base, targetId, boost, months, keepPaying) {
  const options = {
    ...base,
    strategy: 'custom',
    order: orderWithFirst(base.order, targetId, debts),
    cascade: true,
    extraPerMonth: extraSchedule(base.extraPerMonth ?? 0, boost, months, keepPaying, 600),
  };
  return simulatePlan(debts, options);
}

const clearedMonthOf = (plan, id) => plan?.perDebt?.[id]?.clearedMonth ?? null;

/**
 * @param debts   Debt[] (inferRates.toDebt)
 * @param options {
 *   targetId, months,
 *   base: the plan options on screen — { strategy, order?, extraPerMonth, inflows, cascade, lumps, currentMonth, nextPayDate },
 *   keepPaying: after the target clears, keep paying the same total onto the next debt (default false: the extra stops,
 *               the freed instalment still rolls),
 *   deficit: rand a cycle the household is short today (for the feasibility line), incomePerCycle, instalmentsPerCycle,
 * }
 */
export function payoffScenario(debts, { targetId, months, base = {}, keepPaying = false, deficit = 0, incomePerCycle = null, instalmentsPerCycle = null } = {}) {
  const target = (debts ?? []).find((d) => d.id === targetId);
  if (!target || !(months > 0) || !(target.balance > 0)) return null;

  const basePlan = simulatePlan(debts, { ...base });
  const baseCleared = clearedMonthOf(basePlan, targetId);
  const rM = monthlyRate(target.rateNominal ?? 0);
  const guess = Math.max(0, annuity(target.balance, rM, months) + (target.feeMonthly ?? 0) - (target.instalment ?? 0));

  // Already clearing in time under the current plan: nothing extra is needed.
  let boost = 0;
  const clearsInTime = (plan) => {
    const m = clearedMonthOf(plan, targetId);
    return m != null && m <= months;
  };
  if (!(baseCleared != null && baseCleared <= months)) {
    let lo = 0;
    let hi = Math.max(guess * 2, target.balance);
    if (!clearsInTime(runWith(debts, base, targetId, hi, months, keepPaying))) hi = target.balance * 2;
    for (let i = 0; i < MAX_ITER && hi - lo > TOLERANCE; i += 1) {
      const mid = (lo + hi) / 2;
      if (clearsInTime(runWith(debts, base, targetId, mid, months, keepPaying))) hi = mid;
      else lo = mid;
    }
    boost = Math.ceil(hi / 10) * 10;
  }
  const plan = runWith(debts, base, targetId, boost, months, keepPaying);

  const clearedMonth = clearedMonthOf(plan, targetId);
  const clearedDate = plan.perDebt?.[targetId]?.clearedDate ?? null;
  const instalment = target.instalment ?? 0;
  const freedWithin = (n) => (clearedMonth != null ? instalment * Math.max(0, n - clearedMonth) : 0);

  const cascade = debts
    .filter((d) => d.id !== targetId)
    .map((d) => {
      const b = clearedMonthOf(basePlan, d.id);
      const s = clearedMonthOf(plan, d.id);
      return {
        id: d.id,
        label: d.label,
        baseMonth: b,
        scenarioMonth: s,
        baseDate: basePlan.perDebt?.[d.id]?.clearedDate ?? null,
        scenarioDate: plan.perDebt?.[d.id]?.clearedDate ?? null,
        monthsSooner: b != null && s != null ? b - s : null,
      };
    })
    .sort((a, b) => (b.monthsSooner ?? -Infinity) - (a.monthsSooner ?? -Infinity));
  const rolledTo = plan.events?.find((e) => e.type === 'rolled' && e.from === targetId)?.to ?? null;
  const next = cascade.find((c) => c.id === rolledTo) ?? cascade.find((c) => (c.monthsSooner ?? 0) > 0) ?? null;

  const everything = {
    baseDate: basePlan.debtFreeDate ?? null,
    scenarioDate: plan.debtFreeDate ?? null,
    baseMonths: basePlan.months,
    scenarioMonths: plan.months,
    monthsSooner: basePlan.months != null && plan.months != null ? basePlan.months - plan.months : null,
    interestSaved: (basePlan.totalInterest ?? 0) - (plan.totalInterest ?? 0),
    reachedCap: !!plan.reachedCap,
  };

  const debtService =
    incomePerCycle > 0 && instalmentsPerCycle != null
      ? { before: instalmentsPerCycle / incomePerCycle, after: Math.max(0, instalmentsPerCycle - instalment) / incomePerCycle }
      : null;

  const assumptions = [...(plan.assumptions ?? [])];
  if (deficit > 0) assumptions.push(`You are ${fmtRand(deficit)} a cycle short today; the extra here is on top of closing that gap`);

  const sentence =
    boost > 0
      ? `Clearing the ${describeDebt(target)} in ${plural(months, 'cycle')} costs ${fmtRand(boost)} a cycle on top of its ${fmtRand(instalment)} instalment and frees ${fmtRand(instalment)} a cycle from ${fmtDate(clearedDate) ?? 'then'}.`
      : `The ${describeDebt(target)} clears by ${fmtDate(clearedDate) ?? 'then'} under the current plan — its ${fmtRand(instalment)} instalment is free from then.`;

  return {
    targetId,
    label: target.label,
    months,
    keepPaying,
    alreadyOnTrack: boost === 0,
    extraNeeded: boost,
    totalExtra: boost * months,
    instalment,
    base: { clearedMonth: baseCleared, clearedDate: basePlan.perDebt?.[targetId]?.clearedDate ?? null, interestOnTarget: basePlan.perDebt?.[targetId]?.interest ?? 0 },
    scenario: { clearedMonth, clearedDate, interestOnTarget: plan.perDebt?.[targetId]?.interest ?? 0 },
    interestSavedOnTarget: (basePlan.perDebt?.[targetId]?.interest ?? 0) - (plan.perDebt?.[targetId]?.interest ?? 0),
    freed: { perCycle: instalment, fromMonth: clearedMonth, fromDate: clearedDate, within12: freedWithin(12), within24: freedWithin(24) },
    next,
    cascade,
    everything,
    debtService,
    deficit,
    sentence,
    assumptions,
    plan,
    basePlan,
  };
}

/**
 * The same horizon on every debt, ranked: the cheapest to clear first, then the most freed within
 * a year. That is "greatest short-term effect" in the user's own terms — cash back in the month,
 * soonest, for the least found.
 */
export function compareScenarios(debts, { months, base, keepPaying = false, deficit = 0, incomePerCycle = null, instalmentsPerCycle = null } = {}) {
  return (debts ?? [])
    .map((d) => payoffScenario(debts, { targetId: d.id, months, base, keepPaying, deficit, incomePerCycle, instalmentsPerCycle }))
    .filter(Boolean)
    .sort((a, b) => a.extraNeeded - b.extraNeeded || b.freed.within12 - a.freed.within12);
}

/** The most achievable payoff within `months`: the headline's "quick win". */
export function bestQuickWin(debts, base, { months = 3, ...rest } = {}) {
  const ranked = compareScenarios(debts, { months, base, ...rest });
  return ranked.find((s) => s.freed.perCycle > 0) ?? ranked[0] ?? null;
}
