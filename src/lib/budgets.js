/**
 * Category targets, judged mid-cycle.
 *
 * A target compared against spend-so-far is useless on day 3 and obvious on day 30. What makes it
 * usable is comparing the target against where the cycle is actually HEADING, which the app already
 * computes: spend so far plus the weekly-envelope forecast for the rest of the cycle.
 *
 *   projected = spent so far + still expected
 *   status    = projected against target, not spent against target
 *
 * So a category can be at 40% of its target on day 10 and still read as "heading over", which is
 * the only version of the number you can act on.
 */

import { flattenCategories } from './categoryRows';

const OVER = 1.02;
const TIGHT = 0.9;

export function statusOf(projected, target) {
  if (!target) return 'none';
  const ratio = projected / target;
  if (ratio > OVER) return 'over';
  if (ratio > TIGHT) return 'tight';
  return 'under';
}

/**
 * @param processed pipeline output
 * @param targets   [{ category, amount }] — amounts are positive magnitudes
 */
export function buildBudgetProgress(processed, targets) {
  if (!processed) return null;
  const byCategory = new Map((targets ?? []).map((t) => [t.category, Math.abs(t.amount)]));
  const categories = flattenCategories(processed);
  const current = processed.currentMonth;

  const rows = categories
    .map((c) => {
      const spent = Math.abs(c.totalsByMonth?.[current] ?? 0);
      const remaining = Math.abs(c.expected ?? 0);
      const projected = spent + remaining;
      const target = byCategory.get(c.name) ?? null;
      return {
        category: c.name,
        typical: Math.abs(c.avg ?? 0),
        spent,
        remaining,
        projected,
        target,
        isBill: !!c.isBill,
        over: target ? projected - target : 0,
        ratio: target ? projected / target : null,
        status: statusOf(projected, target),
      };
    })
    .sort((a, b) => b.projected - a.projected);

  const withTargets = rows.filter((r) => r.target != null);
  const totalTarget = withTargets.reduce((s, r) => s + r.target, 0);
  const totalProjected = withTargets.reduce((s, r) => s + r.projected, 0);

  return {
    rows,
    withTargets,
    untargeted: rows.filter((r) => r.target == null && r.typical > 200),
    totalTarget,
    totalProjected,
    totalSpent: withTargets.reduce((s, r) => s + r.spent, 0),
    overBy: totalProjected - totalTarget,
    breaching: withTargets.filter((r) => r.status === 'over').sort((a, b) => b.over - a.over),
    status: statusOf(totalProjected, totalTarget),
  };
}

/** A sensible starting target for a category the user hasn't set one for yet. */
export function suggestTarget(typical) {
  if (!(typical > 0)) return 0;
  // Round to something a person would actually type.
  const step = typical >= 5000 ? 500 : typical >= 1000 ? 100 : 50;
  return Math.round(typical / step) * step;
}

/**
 * What the targets leave over once income is accounted for — the number the whole Targets table
 * exists to produce. A target on its own only says whether one category is on pace; it doesn't say
 * what a typed set of them, followed for the cycle, actually buys. This resolves every category to
 * what it's set to cost — the typed target where there is one, what the category is projected to
 * cost this cycle where there isn't — and subtracts the lot from income, so the answer is one figure:
 * what's left at cycle end, for paying debt down faster or for saving.
 *
 * @param budgets  buildBudgetProgress output
 * @param income   the cycle's income, projected to its end (summary.income.projected)
 */
export function buildCategoryPlan(budgets, income) {
  if (!budgets || !Number.isFinite(income)) return null;
  const planned = budgets.rows.reduce((s, r) => s + (r.target ?? r.projected), 0);
  return {
    income,
    planned,
    leftover: income - planned,
    targetedCount: budgets.withTargets.length,
    totalCount: budgets.rows.length,
  };
}
