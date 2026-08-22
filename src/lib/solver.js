import { SOLVER_MAX_ITER, SOLVER_TOLERANCE } from '../constants';
import { simulatePlan } from './debtPlan';

/**
 * "What would it take" — the extra per cycle that clears a debt, or all of them, by a date.
 *
 * There is no closed form once a cascade, a card minimum and a deficit landing on that card are
 * in play, and there does not need to be one: the plan engine answers "is this extra enough" for
 * any extra, and that answer is monotone — more money never makes a debt clear later — so the
 * smallest sufficient extra is found by bisection between zero and the sum of the balances, to
 * ten rand, in at most forty evaluations. The engine is the same one the Debt view draws, so the
 * figure the solver gives is the figure the chart would show.
 *
 * The solver is deficit-aware by construction rather than by adjustment: the caller passes the
 * same `inflows` the budget lands on the absorber card, so the first rands of "extra" are really
 * the rands that stop the balance growing. `breakEvenExtra` is reported beside the answer so the
 * sentence can say "R17 000 to stop the bleed, and R4 300 on top of that to be clear by 2030".
 */


/** Whole calendar months from `from` to `to` (floor); 0 when `to` is not later. */
function wholeMonthsBetween(from, to) {
  if (!from || !to) return 0;
  let n = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) n -= 1;
  return Math.max(0, n);
}

/** Cycle in which the last debt of `scope` clears; Infinity when any of them never does. */
function lastClearedCycle(plan, scope) {
  const ids = scope === 'all' ? plan.order : [scope];
  let last = 0;
  for (const id of ids) {
    const cleared = plan.perDebt[id]?.clearedMonth;
    if (cleared == null) return Infinity;
    last = Math.max(last, cleared);
  }
  return last;
}

function clearedOrderOf(plan) {
  return plan.order
    .filter((id) => plan.perDebt[id]?.clearedMonth != null)
    .sort((a, b) => plan.perDebt[a].clearedMonth - plan.perDebt[b].clearedMonth)
    .map((id) => ({
      id,
      label: plan.labels[id],
      clearedCycle: plan.perDebt[id].clearedMonth,
      clearedDate: plan.perDebt[id].clearedDate,
      interestPaid: plan.perDebt[id].interest,
    }));
}

function unreachableOf(plan, scope, targetCycles) {
  const ids = scope === 'all' ? plan.order : [scope];
  const at = plan.schedule[Math.min(targetCycles, plan.schedule.length) - 1];
  return ids
    .filter((id) => (plan.perDebt[id]?.clearedMonth ?? Infinity) > targetCycles)
    .map((id) => ({ id, label: plan.labels[id], balanceAtTarget: at?.byDebt[id]?.close ?? null }));
}

function affordability(totalPerCycle, flexibleAvailable, incomePerCycle) {
  return {
    feasible: flexibleAvailable == null ? null : totalPerCycle <= flexibleAvailable,
    flexibleAvailable,
    shortfall: flexibleAvailable == null ? 0 : Math.max(0, totalPerCycle - flexibleAvailable),
    asShareOfIncome: incomePerCycle ? totalPerCycle / incomePerCycle : null,
  };
}

/**
 * Smallest extra per cycle so that every debt in `scope` clears by `targetDate`. Bisection over
 * simulatePlan (cascade on); monotone in the extra.
 *
 * @param debts    Debt[]
 * @param options  targetDate, fromDate: Date; currentMonth, nextPayDate; strategy = 'avalanche';
 *                 inflows = {} (the deficit on the absorber); breakEvenExtra = 0; scope = 'all'|accountId;
 *                 flexibleAvailable = null; incomePerCycle = null
 * @returns {{
 *   target: { date: Date, cycles: number }, scope, strategy, breakEvenExtra,
 *   extraPerCycle: number|null, totalPerCycle: number|null, asShareOfIncome: number|null,
 *   clearedOrder: [{ id, label, clearedCycle, clearedDate, interestPaid }],
 *   unreachable: [{ id, label, balanceAtTarget }],
 *   interestSaved: number, baselineCleared: [{ id, clearedCycle }],
 *   feasible: boolean|null, flexibleAvailable, shortfall, infeasible: boolean,
 *   plan: PlanResult, evaluations: number, assumptions: string[],
 * }}
 */
export function solveExtraForDate(debts, options = {}) {
  const {
    targetDate,
    fromDate,
    currentMonth = null,
    nextPayDate = null,
    strategy = 'avalanche',
    inflows = {},
    breakEvenExtra = 0,
    scope = 'all',
    flexibleAvailable = null,
    incomePerCycle = null,
  } = options;
  const targetCycles = wholeMonthsBetween(fromDate, targetDate);
  let evaluations = 0;
  const run = (extra) => {
    evaluations += 1;
    return simulatePlan(debts, { strategy, extraPerMonth: extra, inflows, cascade: true, currentMonth, nextPayDate });
  };
  const enough = (plan) => lastClearedCycle(plan, scope) <= targetCycles;

  const baseline = run(0);
  let extraPerCycle = 0;
  let plan = baseline;
  let infeasible = false;

  if (!enough(baseline)) {
    let lo = 0;
    let hi = baseline.order.reduce((s, id) => s + (debts.find((d) => d.id === id)?.balance ?? 0), 0);
    let hiPlan = run(hi);
    if (!enough(hiPlan)) {
      infeasible = true;
      extraPerCycle = null;
      plan = hiPlan;
    } else {
      while (hi - lo > SOLVER_TOLERANCE && evaluations < SOLVER_MAX_ITER + 1) {
        const mid = (lo + hi) / 2;
        const candidate = run(mid);
        if (enough(candidate)) {
          hi = mid;
          hiPlan = candidate;
        } else {
          lo = mid;
        }
      }
      extraPerCycle = hi;
      plan = hiPlan;
    }
  }

  const totalPerCycle = extraPerCycle == null ? null : extraPerCycle + breakEvenExtra;
  const money = affordability(totalPerCycle ?? Infinity, flexibleAvailable, incomePerCycle);
  const assumptions = [
    ...plan.assumptions,
    `Target counted as ${targetCycles} whole pay cycles from ${fromDate ? fromDate.toISOString().slice(0, 10) : 'today'}`,
  ];
  if (breakEvenExtra > 0) assumptions.push(`The first R${Math.round(breakEvenExtra)} a cycle only stops the deficit`);

  return {
    target: { date: targetDate ?? null, cycles: targetCycles },
    scope,
    strategy,
    breakEvenExtra,
    extraPerCycle,
    totalPerCycle,
    asShareOfIncome: totalPerCycle == null ? null : money.asShareOfIncome,
    clearedOrder: clearedOrderOf(plan),
    unreachable: unreachableOf(plan, scope, targetCycles),
    interestSaved: baseline.totalInterest - plan.totalInterest,
    baselineCleared: baseline.order.map((id) => ({ id, clearedCycle: baseline.perDebt[id]?.clearedMonth ?? null })),
    feasible: totalPerCycle == null ? false : money.feasible,
    flexibleAvailable,
    shortfall: totalPerCycle == null ? null : money.shortfall,
    infeasible,
    plan,
    evaluations,
    assumptions,
  };
}

/**
 * Inverse: when does `scope` clear with `extraPerMonth` on top of the instalments?
 *
 * @returns {{ clearedDate: Date|null, cycles: number|null, plan: PlanResult }}
 */
export function solveDateForExtra(debts, { extraPerMonth = 0, currentMonth = null, nextPayDate = null, strategy = 'avalanche', inflows = {}, scope = 'all' } = {}) {
  const plan = simulatePlan(debts, { strategy, extraPerMonth, inflows, cascade: true, currentMonth, nextPayDate });
  const cycles = lastClearedCycle(plan, scope);
  if (!Number.isFinite(cycles) || cycles === 0) return { clearedDate: null, cycles: null, plan };
  return { clearedDate: plan.schedule[cycles - 1]?.date ?? null, cycles, plan };
}

/**
 * A savings goal: the extra per cycle to reach `target` from `saved` by `targetDate`, net of the
 * surplus already running: max(0, (target − saved)/cycles − max(0, surplusPerCycle)) + breakEvenExtra.
 *
 * @returns the same Solution shape as solveExtraForDate with `plan: null`, `scope: 'goal'`
 */
export function solveExtraForGoal({ target, saved = 0, targetDate, fromDate, surplusPerCycle = 0, breakEvenExtra = 0, flexibleAvailable = null, incomePerCycle = null } = {}) {
  const cycles = wholeMonthsBetween(fromDate, targetDate);
  const gap = Math.max(0, (target ?? 0) - (saved ?? 0));
  const infeasible = gap > 0 && cycles === 0;
  const extraPerCycle = infeasible ? null : Math.max(0, gap / Math.max(1, cycles) - Math.max(0, surplusPerCycle ?? 0));
  const totalPerCycle = extraPerCycle == null ? null : extraPerCycle + breakEvenExtra;
  const money = affordability(totalPerCycle ?? Infinity, flexibleAvailable, incomePerCycle);
  return {
    target: { date: targetDate ?? null, cycles },
    scope: 'goal',
    strategy: null,
    breakEvenExtra,
    extraPerCycle,
    totalPerCycle,
    asShareOfIncome: totalPerCycle == null ? null : money.asShareOfIncome,
    clearedOrder: [],
    unreachable: [],
    interestSaved: 0,
    baselineCleared: [],
    feasible: totalPerCycle == null ? false : money.feasible,
    flexibleAvailable,
    shortfall: totalPerCycle == null ? null : money.shortfall,
    infeasible,
    plan: null,
    evaluations: 0,
    assumptions: [
      `${cycles} whole pay cycles to the target date`,
      surplusPerCycle > 0 ? `R${Math.round(surplusPerCycle)} a cycle of existing surplus counted toward the goal` : 'No existing surplus counted',
    ],
  };
}
