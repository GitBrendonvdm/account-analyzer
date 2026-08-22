import { describe, expect, it } from 'vitest';
import { bestQuickWin, compareScenarios, payoffScenario } from './scenario';
import { realTermsDebts } from './debtFixtures';
import { annuity } from './inferRates';
import { monthlyRate } from './debtPlan';

const BASE = { strategy: 'avalanche', extraPerMonth: 0, inflows: {}, cascade: true, currentMonth: '2026-08', nextPayDate: new Date(2026, 7, 23) };

describe('payoffScenario', () => {
  const debts = realTermsDebts();
  const vehicle = debts.find((d) => d.kind === 'vehicle');

  it('finds the extra that clears the vehicle in three cycles, close to the annuity guess', () => {
    const s = payoffScenario(debts, { targetId: vehicle.id, months: 3, base: BASE });
    expect(s).not.toBeNull();
    expect(s.scenario.clearedMonth).toBeLessThanOrEqual(3);
    const guess = annuity(vehicle.balance, monthlyRate(vehicle.rateNominal), 3) + (vehicle.feeMonthly ?? 0) - vehicle.instalment;
    // The engine lands extras before the cycle's interest, so the exact figure sits a fraction
    // under the closed form; within 3% (and never above it by more than the R10 rounding).
    expect(Math.abs(s.extraNeeded - guess) / guess).toBeLessThan(0.03);
    expect(s.extraNeeded).toBeLessThanOrEqual(guess + 10);
    expect(s.totalExtra).toBe(s.extraNeeded * 3);
  });

  it('frees the instalment from the clearing month and counts it within a year', () => {
    const s = payoffScenario(debts, { targetId: vehicle.id, months: 3, base: BASE });
    expect(s.freed.perCycle).toBe(vehicle.instalment);
    expect(s.freed.fromMonth).toBe(s.scenario.clearedMonth);
    expect(s.freed.within12).toBeCloseTo(vehicle.instalment * (12 - s.scenario.clearedMonth), 6);
  });

  it('never makes anything later: every other debt clears no later than in the base plan', () => {
    const s = payoffScenario(debts, { targetId: vehicle.id, months: 3, base: BASE });
    s.cascade.forEach((c) => {
      if (c.baseMonth != null && c.scenarioMonth != null) expect(c.scenarioMonth).toBeLessThanOrEqual(c.baseMonth);
    });
    expect(s.everything.interestSaved).toBeGreaterThanOrEqual(0);
    expect(s.everything.monthsSooner).toBeGreaterThanOrEqual(0);
  });

  it('reports a debt already clearing in time as on track with nothing extra', () => {
    const soon = { ...vehicle, id: 'soon', label: 'Soon', balance: 2000, instalment: 1500 };
    const s = payoffScenario([soon, ...debts], { targetId: 'soon', months: 6, base: BASE });
    expect(s.alreadyOnTrack).toBe(true);
    expect(s.extraNeeded).toBe(0);
    expect(s.sentence).toMatch(/under the current plan/);
  });

  it('keeping the same total going clears everything no later than stopping', () => {
    const stop = payoffScenario(debts, { targetId: vehicle.id, months: 3, base: BASE, keepPaying: false });
    const keep = payoffScenario(debts, { targetId: vehicle.id, months: 3, base: BASE, keepPaying: true });
    expect(keep.everything.scenarioMonths).toBeLessThanOrEqual(stop.everything.scenarioMonths);
  });

  it('puts debt service before and after into shares of income', () => {
    const s = payoffScenario(debts, { targetId: vehicle.id, months: 3, base: BASE, incomePerCycle: 100000, instalmentsPerCycle: 40000 });
    expect(s.debtService.before).toBeCloseTo(0.4, 6);
    expect(s.debtService.after).toBeCloseTo((40000 - vehicle.instalment) / 100000, 6);
  });

  it('ranks the cheapest-to-clear debt first and picks it as the quick win', () => {
    const ranked = compareScenarios(debts, { months: 3, base: BASE });
    expect(ranked.length).toBe(debts.length);
    for (let i = 1; i < ranked.length; i += 1) expect(ranked[i].extraNeeded).toBeGreaterThanOrEqual(ranked[i - 1].extraNeeded);
    const win = bestQuickWin(debts, BASE, { months: 3 });
    expect(win.targetId).toBe(ranked[0].targetId);
    expect(win.sentence).toMatch(/a cycle/);
  });
});
