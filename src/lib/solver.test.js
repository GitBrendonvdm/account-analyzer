import { afterEach, describe, expect, it, vi } from 'vitest';
import * as debtPlan from './debtPlan';
import { realTermsDebts } from './debtFixtures';
import { solveDateForExtra, solveExtraForDate, solveExtraForGoal } from './solver';

const FROM = new Date(2026, 7, 22);
const NEXT_PAY = new Date(2026, 7, 23);
const monthsOut = (n) => new Date(2026, 7 + n, 22);
const loan = () => ({ id: 'l', label: 'Loan', type: 'Loan', balance: 100000, rateNominal: 0.12, instalment: 2000 });
const base = { fromDate: FROM, currentMonth: '2026-08', nextPayDate: NEXT_PAY };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('solver', () => {
  it('solveDateForExtra matches the closed-form term', () => {
    const { cycles, clearedDate, plan } = solveDateForExtra([loan()], { extraPerMonth: 0, ...base });
    expect(Math.abs(cycles - 69.7)).toBeLessThanOrEqual(1);
    expect(clearedDate).toEqual(plan.schedule[cycles - 1].date);
    expect(plan.perDebt.l.clearedMonth).toBe(cycles);
  });

  it('solveExtraForDate finds the extra that clears in 36 cycles, to ten rand', () => {
    const solution = solveExtraForDate([loan()], { targetDate: monthsOut(36), ...base });
    // The extra lands at the start of each period, before interest, so it is worth (1 + r_m)
    // of an end-of-period annuity payment: (annuity − instalment)/(1 + r_m).
    const closed = (debtPlan.annuity(100000, 0.01, 36) - 2000) / 1.01;
    expect(Math.abs(solution.extraPerCycle - closed)).toBeLessThanOrEqual(10);
    expect(Math.abs(solution.extraPerCycle - 1321.4)).toBeLessThanOrEqual(25);
    expect(solution.target.cycles).toBe(36);
    expect(solution.infeasible).toBe(false);
    expect(solution.clearedOrder[0]).toMatchObject({ id: 'l', clearedCycle: 36 });
    expect(solution.unreachable).toEqual([]);
    expect(solution.interestSaved).toBeGreaterThan(0);
    expect(solution.baselineCleared[0].clearedCycle).toBeGreaterThan(36);
    expect(solution.totalPerCycle).toBe(solution.extraPerCycle);
    expect(solution.feasible).toBeNull();
  });

  it('affordability and the deficit floor are reported beside the answer', () => {
    const solution = solveExtraForDate([loan()], {
      targetDate: monthsOut(36),
      ...base,
      breakEvenExtra: 500,
      flexibleAvailable: 1500,
      incomePerCycle: 50000,
    });
    expect(solution.totalPerCycle).toBeCloseTo(solution.extraPerCycle + 500, 6);
    expect(solution.feasible).toBe(false);
    expect(solution.shortfall).toBeCloseTo(solution.totalPerCycle - 1500, 6);
    expect(solution.asShareOfIncome).toBeCloseTo(solution.totalPerCycle / 50000, 6);
    expect(solution.assumptions.some((a) => /stops the deficit/.test(a))).toBe(true);
  });

  it('avalanche clears the dearer loan first', () => {
    const debts = [
      { id: 'cheap', label: 'Cheap', type: 'Loan', balance: 50000, rateNominal: 0.09, instalment: 1500 },
      { id: 'dear', label: 'Dear', type: 'Loan', balance: 50000, rateNominal: 0.17, instalment: 1500 },
    ];
    const solution = solveExtraForDate(debts, { targetDate: monthsOut(24), ...base });
    expect(solution.clearedOrder.map((c) => c.id)).toEqual(['dear', 'cheap']);
    expect(solution.clearedOrder[1].clearedCycle).toBeLessThanOrEqual(24);
  });

  it('an inflow the size of the extra leaves the card flat', () => {
    const card = { id: 'c', label: 'Card', type: 'Credit Card', balance: 50000, rateNominal: 0.2075, minimumPct: 1, plannedPayment: 864.58 };
    const { plan, cycles } = solveDateForExtra([card], { extraPerMonth: 10000, inflows: { c: 10000 }, ...base });
    for (let k = 0; k < 12; k += 1) expect(Math.abs(plan.schedule[k].byDebt.c.close - 50000)).toBeLessThan(1);
    expect(cycles).toBeNull();
  });

  it('a one-cycle target with the deficit still landing is infeasible', () => {
    const debts = realTermsDebts();
    const solution = solveExtraForDate(debts, { targetDate: monthsOut(1), inflows: { 'nedbank|4714': 17000 }, ...base });
    expect(solution.infeasible).toBe(true);
    expect(solution.extraPerCycle).toBeNull();
    expect(solution.feasible).toBe(false);
    expect(solution.unreachable.length).toBeGreaterThan(0);
    const noCycles = solveExtraForDate(debts, { targetDate: new Date(2026, 8, 1), ...base });
    expect(noCycles.target.cycles).toBe(0);
    expect(noCycles.infeasible).toBe(true);
  });

  it('bisects in at most 41 evaluations and is monotone in the target date', () => {
    const spy = vi.spyOn(debtPlan, 'simulatePlan');
    const debts = realTermsDebts();
    const near = solveExtraForDate(debts, { targetDate: monthsOut(60), ...base });
    const calls = spy.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(41);
    expect(near.evaluations).toBe(calls);
    const far = solveExtraForDate(debts, { targetDate: monthsOut(120), ...base });
    expect(far.extraPerCycle).toBeLessThanOrEqual(near.extraPerCycle);
    expect(near.extraPerCycle).toBeGreaterThan(0);
    const scoped = solveExtraForDate(debts, { targetDate: monthsOut(12), scope: 'fnb|4081', ...base });
    expect(scoped.extraPerCycle).toBeGreaterThan(0);
    expect(scoped.plan.perDebt['fnb|4081'].clearedMonth).toBeLessThanOrEqual(12);
  });

  it('solveExtraForGoal nets the running surplus and adds the break-even', () => {
    const goal = solveExtraForGoal({ target: 120000, saved: 20000, targetDate: monthsOut(10), fromDate: FROM, surplusPerCycle: 2000, breakEvenExtra: 500 });
    expect(goal.target.cycles).toBe(10);
    expect(goal.extraPerCycle).toBe(8000);
    expect(goal.totalPerCycle).toBe(8500);
    expect(goal.plan).toBeNull();
    expect(goal.infeasible).toBe(false);
    const done = solveExtraForGoal({ target: 1000, saved: 5000, targetDate: monthsOut(3), fromDate: FROM });
    expect(done.extraPerCycle).toBe(0);
    const now = solveExtraForGoal({ target: 1000, saved: 0, targetDate: FROM, fromDate: FROM });
    expect(now.infeasible).toBe(true);
  });
});
