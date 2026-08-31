import { describe, expect, it } from 'vitest';
import { buildCategoryPlan } from './budgets';

/**
 * `buildCategoryPlan` is the one figure the Targets table exists to produce: what a typed set of
 * category targets — typical spend standing in where none is set — leaves over once income is
 * accounted for. These tests pin the arithmetic and its edges directly, at the shape
 * `buildBudgetProgress` actually returns (`rows`/`withTargets`), rather than only through a
 * component fixture.
 */

const row = (category, projected, target = null) => ({ category, projected, target });

describe('buildCategoryPlan', () => {
  it('resolves every category to its target, or its projected spend where none is set, and subtracts from income', () => {
    const budgets = {
      rows: [row('Groceries', 7800, 6500), row('Transport', 2900), row('Insurance', 1450)],
      withTargets: [{ category: 'Groceries' }],
    };
    const out = buildCategoryPlan(budgets, 75000);
    // 6500 (typed) + 2900 + 1450 (both projected, no target) = 10850
    expect(out.planned).toBe(10850);
    expect(out.leftover).toBe(75000 - 10850);
    expect(out.income).toBe(75000);
    expect(out.targetedCount).toBe(1);
    expect(out.totalCount).toBe(3);
  });

  it('goes negative — short, not floored at zero — when the targets outspend income', () => {
    const budgets = {
      rows: [row('Bond', 20000, 20000), row('Groceries', 9000, 9000)],
      withTargets: [{ category: 'Bond' }, { category: 'Groceries' }],
    };
    const out = buildCategoryPlan(budgets, 25000);
    expect(out.leftover).toBe(-4000);
  });

  it('is null without budgets or without a usable income figure', () => {
    expect(buildCategoryPlan(null, 75000)).toBeNull();
    expect(buildCategoryPlan({ rows: [], withTargets: [] }, null)).toBeNull();
    expect(buildCategoryPlan({ rows: [], withTargets: [] }, undefined)).toBeNull();
    expect(buildCategoryPlan({ rows: [], withTargets: [] }, NaN)).toBeNull();
  });

  it('is zero planned with no categories at all — leftover is the whole income', () => {
    const out = buildCategoryPlan({ rows: [], withTargets: [] }, 40000);
    expect(out.planned).toBe(0);
    expect(out.leftover).toBe(40000);
  });
});
