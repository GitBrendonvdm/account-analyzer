import { describe, expect, it } from 'vitest';
import { realTermsDebts } from './debtFixtures';
import {
  addCycles,
  amortise,
  annuity,
  buildDebtBudget,
  cascadeTimeline,
  comparePlans,
  HORIZON_CAP,
  lumpWhatIf,
  marginalValue,
  monthlyFromEffective,
  monthlyRate,
  payoffOrder,
  rateSensitivity,
  remainingTerm,
  simulatePlan,
} from './debtPlan';

const CARD = 'nedbank|4714';
const PERSONAL = 'fnb|1143';
const FNB_BOND = 'fnb|6996';
const VEHICLE = 'fnb|4081';
const NED_BOND = 'nedbank|2801';

describe('amortise', () => {
  it('hand-check: 10 000 at 12% with 1 000 a month', () => {
    const a = amortise({ balance: 10000, rateNominal: 0.12, instalment: 1000, feeMonthly: 0 });
    expect(a.schedule[0].interest).toBeCloseTo(100, 2);
    expect(a.schedule[0].close).toBeCloseTo(9100, 2);
    expect(a.schedule[1].interest).toBeCloseTo(91, 2);
    expect(a.schedule[1].close).toBeCloseTo(8191, 2);
    expect(a.schedule[9].close).toBeCloseTo(584.01, 2);
    expect(a.schedule[10].interest).toBeCloseTo(5.84, 2);
    expect(a.schedule[10].payment).toBeCloseTo(589.85, 2);
    expect(a.schedule[10].close).toBe(0);
    expect(a.months).toBe(11);
    expect(Math.abs(a.totalInterest - 589.85)).toBeLessThan(0.05);
    expect(a.totalPaid).toBeCloseTo(10589.85, 1);
    expect(a.cleared).toBe(true);
    expect(a.neverClears).toBe(false);
    expect(remainingTerm(10000, 0.12, 1000, 0)).toBeCloseTo(10.59, 2);
  });

  it('with a R69 fee the same loan takes 12 months and pays 828 in fees', () => {
    const a = amortise({ balance: 10000, rateNominal: 0.12, instalment: 1000, feeMonthly: 69 });
    expect(a.schedule[0].principal).toBeCloseTo(831, 2);
    expect(a.schedule[0].close).toBeCloseTo(9169, 2);
    expect(a.months).toBe(12);
    expect(a.totalFees).toBeCloseTo(828, 2);
  });

  it('never-clears terminates at the cap and says what would clear it; zero rate amortises linearly', () => {
    const t0 = performance.now();
    const a = amortise({ balance: 100000, rateNominal: 0.12, instalment: 900 });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(a.neverClears).toBe(true);
    expect(a.minimumToClear).toBe(1001);
    expect(Math.abs(a.schedule[11].close - 101268.25)).toBeLessThan(0.05);
    expect(a.months).toBe(HORIZON_CAP);
    expect(a.cleared).toBe(false);
    const z = amortise({ balance: 1200, rateNominal: 0, instalment: 100 });
    expect(z.months).toBe(12);
    expect(z.totalInterest).toBe(0);
  });
});

describe('simulatePlan', () => {
  const two = () => [
    { id: 'a', label: 'A', type: 'Loan', balance: 1000, rateNominal: 0.12, instalment: 500 },
    { id: 'b', label: 'B', type: 'Loan', balance: 10000, rateNominal: 0.12, instalment: 300 },
  ];

  it('cascades a cleared instalment onto the next debt, the same period for the unused part', () => {
    const plan = simulatePlan(two(), { strategy: 'custom', order: ['a', 'b'], cascade: true });
    expect(plan.schedule[0].byDebt.a.close).toBeCloseTo(510, 2);
    expect(plan.schedule[1].byDebt.a.close).toBeCloseTo(15.1, 2);
    expect(plan.schedule[2].byDebt.a.payment).toBeCloseTo(15.25, 2);
    expect(plan.schedule[2].byDebt.a.cleared).toBe(true);
    expect(plan.schedule[2].byDebt.b.extra).toBeCloseTo(484.75, 2);
    expect(plan.schedule[2].byDebt.b.close).toBeCloseTo(8904.38, 2);
    expect(plan.schedule[3].byDebt.b.extra).toBeCloseTo(500, 6);
    expect(plan.events).toContainEqual(expect.objectContaining({ type: 'cleared', id: 'a', month: 3 }));
    expect(plan.events).toContainEqual(expect.objectContaining({ type: 'rolled', from: 'a', to: 'b', amount: 500 }));
    expect(plan.freedTimeline[0]).toMatchObject({ month: 3, freed: 500, id: 'a', rolledTo: 'b' });
    expect(plan.perDebt.a.clearedMonth).toBe(3);
    expect(plan.months).toBeGreaterThan(3);
    expect(plan.reachedCap).toBe(false);
  });

  it('without the cascade nothing rolls, and the relief timeline shows the freed instalment', () => {
    const plan = simulatePlan(two(), { strategy: 'custom', order: ['a', 'b'], cascade: false });
    expect(plan.schedule.every((p) => p.byDebt.b.extra === 0)).toBe(true);
    const timeline = cascadeTimeline(plan);
    expect(timeline.reliefByMonth[4]).toBe(500);
    expect(timeline.reliefByMonth[2]).toBe(0);
    expect(timeline.steps[0]).toMatchObject({ id: 'a', month: 3, label: 'A', freed: 500 });
    expect(timeline.finalRelief).toBe(800);
    expect(timeline.committedByMonth[1]).toBeCloseTo(800, 6);
    const cascading = cascadeTimeline(simulatePlan(two(), { strategy: 'custom', order: ['a', 'b'], cascade: true }));
    expect(cascading.reliefByMonth[4]).toBe(0);
    expect(cascading.reliefByMonth[cascading.reliefByMonth.length - 1]).toBe(800);
  });

  it('minimum is the control: extra, lumps and cascade are ignored', () => {
    const plan = simulatePlan(two(), { strategy: 'minimum', extraPerMonth: 1000, lumps: [{ month: 1, amount: 5000, targetId: null }] });
    expect(plan.cascade).toBe(false);
    expect(plan.totalExtra).toBe(0);
    expect(plan.order).toEqual(['a', 'b']);
  });

  it('orders the real-terms fixture as the spec says', () => {
    const debts = realTermsDebts();
    expect(payoffOrder(debts, 'avalanche')).toEqual([CARD, PERSONAL, FNB_BOND, VEHICLE, NED_BOND]);
    expect(payoffOrder(debts, 'snowball')).toEqual([VEHICLE, CARD, PERSONAL, FNB_BOND, NED_BOND]);
    expect(payoffOrder(debts, 'lifetime')).toEqual([CARD, PERSONAL, VEHICLE, FNB_BOND, NED_BOND]);
    const feeAdjusted = (d) => d.rateNominal + (12 * d.feeMonthly) / d.balance;
    const byId = Object.fromEntries(debts.map((d) => [d.id, d]));
    expect(feeAdjusted(byId[CARD])).toBeCloseTo(0.2555, 3);
    expect(feeAdjusted(byId[PERSONAL])).toBeCloseTo(0.2194, 3);
    expect(feeAdjusted(byId[VEHICLE])).toBeCloseTo(0.106, 3);
    expect(feeAdjusted(byId[FNB_BOND])).toBeCloseTo(0.097, 3);
    expect(feeAdjusted(byId[NED_BOND])).toBeCloseTo(0.0936, 3);
    expect(payoffOrder(debts, 'shortTerm')).toEqual(payoffOrder(debts, 'avalanche'));
    expect(payoffOrder(debts, 'custom', { order: [NED_BOND, 'unknown'] })).toEqual([NED_BOND, CARD, PERSONAL, FNB_BOND, VEHICLE]);
  });

  it('marginal value of R1 000: lump and monthly, against the closed forms', () => {
    const debts = realTermsDebts();
    const rows = marginalValue(debts, { strategy: 'avalanche', cascade: true, extraPerMonth: 0 });
    const bond = rows.find((r) => r.id === NED_BOND);
    const personal = rows.find((r) => r.id === PERSONAL);
    const rBond = 0.0933 / 12;
    const rPersonal = 0.172 / 12;
    expect(Math.abs(bond.lump12 - 1000 * ((1 + rBond) ** 12 - 1))).toBeLessThan(2);
    expect(Math.abs(bond.lump12 - 97.4)).toBeLessThan(2);
    expect(Math.abs(personal.lump12 - 1000 * ((1 + rPersonal) ** 12 - 1))).toBeLessThan(2);
    expect(Math.abs(personal.lump12 - 186.2)).toBeLessThan(2);
    const monthlyClosed = (r) => 1000 * Array.from({ length: 12 }, (_, j) => (1 + r) ** (j + 1) - 1).reduce((s, x) => s + x, 0);
    expect(Math.abs(bond.monthly12 - monthlyClosed(rBond))).toBeLessThan(3);
    expect(Math.abs(personal.monthly12 - monthlyClosed(rPersonal))).toBeLessThan(3);
    expect([0, 1]).toContain(bond.monthsSavedLump);
    expect(rows.map((r) => r.rank12)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.find((r) => r.id === VEHICLE).rankSnowball).toBe(1);
    // Over a whole life the bond only runs its 358 months without a cascade feeding it.
    const alone = marginalValue(debts, { strategy: 'avalanche', cascade: false, extraPerMonth: 0 }).find((r) => r.id === NED_BOND);
    expect(Math.abs(alone.lumpLife - 15000) / 15000).toBeLessThan(0.03);
  });

  it('a lump larger than its target overflows down the order the same period', () => {
    const debts = realTermsDebts();
    const plan = simulatePlan(debts, {
      strategy: 'custom',
      order: [VEHICLE, PERSONAL],
      lumps: [{ month: 1, amount: 200000, targetId: VEHICLE }],
    });
    const first = plan.schedule[0];
    expect(first.byDebt[VEHICLE].cleared).toBe(true);
    expect(first.byDebt[VEHICLE].interest).toBe(0);
    expect(first.byDebt[PERSONAL].extra).toBeCloseTo(131190.67, 2);
    expect(Math.abs(first.byDebt[PERSONAL].close - 35947.56)).toBeLessThan(1);
    const whatIf = lumpWhatIf(debts, { amount: 200000, strategy: 'custom', order: [VEHICLE, PERSONAL] });
    expect(whatIf.rows.find((r) => r.id === VEHICLE).overflowTo).toBe(PERSONAL);
    expect(whatIf.rows).toHaveLength(debts.length + 1);
    expect(whatIf.rows.at(-1).id).toBeNull();
    expect(whatIf.bestLife).not.toBeNull();
  });

  it('never-clears under a rate shift terminates, with and without the cascade', () => {
    const debts = realTermsDebts();
    let t0 = performance.now();
    const held = simulatePlan(debts, { strategy: 'minimum', rateShiftBp: 100, recast: false });
    expect(performance.now() - t0).toBeLessThan(100);
    expect(held.neverClears.map((n) => n.id)).toEqual([NED_BOND]);
    expect(held.reachedCap).toBe(true);
    [CARD, PERSONAL, FNB_BOND, VEHICLE].forEach((id) => expect(held.perDebt[id].clearedMonth).not.toBeNull());
    t0 = performance.now();
    const cascading = simulatePlan(debts, { strategy: 'avalanche', rateShiftBp: 100 });
    expect(performance.now() - t0).toBeLessThan(100);
    expect(cascading.neverClears.map((n) => n.id)).toEqual([NED_BOND]);
    expect(cascading.reachedCap).toBe(false);

    const rows = rateSensitivity(debts, { strategy: 'avalanche' });
    const recast50 = rows.find((r) => r.bp === 50 && r.recast);
    expect(Math.abs(recast50.instalmentDelta[NED_BOND] - 1000)).toBeLessThan(50);
    expect(recast50.neverClears).toEqual([]);
    expect(recast50.instalmentDelta[PERSONAL]).toBe(0); // fixed rate: no shift
    const held100 = rows.find((r) => r.bp === 100 && !r.recast);
    expect(held100.neverClears).toEqual([NED_BOND]);
    expect(rows).toHaveLength(14);
  });

  it('cards pay a percentage minimum, never less than the floor', () => {
    const card = { id: 'c', label: 'C', type: 'Credit Card', balance: 50000, rateNominal: 0.2075, minimumPct: 5 };
    const plan = simulatePlan([card], { strategy: 'minimum' });
    expect(plan.schedule[0].byDebt.c.interest).toBeCloseTo(864.58, 2);
    expect(plan.schedule[0].byDebt.c.payment).toBeCloseTo(2500, 6);
    expect(plan.schedule[0].byDebt.c.close).toBeCloseTo(48364.58, 2);
    expect(plan.reachedCap).toBe(false);
    expect(plan.neverClears).toEqual([]);
    const thin = simulatePlan([{ ...card, minimumPct: 1.5 }], { strategy: 'minimum' });
    expect(thin.neverClears.map((n) => n.id)).toEqual(['c']);
    const planned = simulatePlan([{ ...card, plannedPayment: 100 }], { strategy: 'minimum' });
    expect(planned.schedule[0].byDebt.c.payment).toBeCloseTo(2500, 6);
  });

  it('maps periods onto pay cycles', () => {
    const plan = simulatePlan(realTermsDebts(), { strategy: 'avalanche', currentMonth: '2026-08', nextPayDate: new Date(2026, 7, 23) });
    expect(plan.schedule[0].payMonth).toBe('2026-09');
    expect(plan.schedule[0].date).toEqual(new Date(2026, 7, 23));
    expect(plan.schedule[5].payMonth).toBe('2027-02');
    expect(plan.schedule[5].date).toEqual(new Date(2027, 0, 23));
    expect(addCycles(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 28));
    expect(monthlyRate(0.12)).toBeCloseTo(0.01, 9);
    expect(monthlyFromEffective((1 + 0.01) ** 12 - 1)).toBeCloseTo(0.01, 9);
    expect(annuity(100000, 0.01, 36)).toBeCloseTo(3321.43, 1);
  });

  it('excludes debts without a balance or an instalment, and handles an empty plan', () => {
    const plan = simulatePlan(
      [
        { id: 'x', label: 'X', type: 'Credit Card', balance: null, rateNominal: 0.2075, source: { rate: 'default' } },
        { id: 'y', label: 'Y', type: 'Loan', balance: 1000, rateNominal: 0.1, instalment: null },
      ],
      { strategy: 'avalanche' },
    );
    expect(plan.months).toBe(0);
    expect(plan.schedule).toEqual([]);
    expect(plan.excluded.map((e) => e.id)).toEqual(['x', 'y']);
    expect(plan.excluded[0]).toMatchObject({ reason: 'no balance', missing: expect.arrayContaining(['balance', 'rate', 'limit']) });
    expect(plan.excluded[1]).toMatchObject({ reason: 'no instalment' });
  });

  it('a card limit, a balloon and an extra schedule shorter than the horizon', () => {
    const card = { id: 'c', label: 'C', type: 'Credit Card', balance: 50000, rateNominal: 0.2075, minimumPct: 5, creditLimit: 60000, plannedPayment: 1000 };
    const plan = simulatePlan([card], { strategy: 'minimum', inflows: { c: 10000 } });
    const limit = plan.events.find((e) => e.type === 'limit');
    expect(limit).toMatchObject({ id: 'c', amount: 60000 });
    expect(limit.month).toBeLessThanOrEqual(3);
    expect(plan.assumptions.some((a) => /Deficit of R10 000/.test(a))).toBe(true);

    const balloon = { id: 'v', label: 'V', type: 'Loan', balance: 50000, rateNominal: 0.1, instalment: 2000, balloon: 20000, termMonths: 6 };
    const withBalloon = simulatePlan([balloon], { strategy: 'minimum' });
    const event = withBalloon.events.find((e) => e.type === 'balloon');
    expect(event).toMatchObject({ id: 'v', month: 6, amount: 20000 });
    expect(withBalloon.schedule[5].byDebt.v.payment).toBeCloseTo(22000, 6);

    const ramp = simulatePlan([{ id: 'l', label: 'L', type: 'Loan', balance: 10000, rateNominal: 0.12, instalment: 500 }], {
      strategy: 'custom',
      order: ['l'],
      extraPerMonth: [100, 200],
    });
    expect(ramp.schedule[0].byDebt.l.extra).toBe(100);
    expect(ramp.schedule[1].byDebt.l.extra).toBe(200);
    expect(ramp.schedule[2].byDebt.l.extra).toBe(200);
  });
});

describe('comparePlans and buildDebtBudget', () => {
  it('every strategy beats minimum, and the real-terms fixture is debt-free in the 2050s under minimum', () => {
    const debts = realTermsDebts();
    const plans = comparePlans(debts, { currentMonth: '2026-08', nextPayDate: new Date(2026, 7, 23) });
    expect(plans.table.map((r) => r.strategy)).toEqual(['minimum', 'avalanche', 'snowball', 'lifetime', 'shortTerm']);
    expect(plans.minimum.debtFreeDate.getFullYear()).toBeGreaterThanOrEqual(2055);
    expect(plans.minimum.debtFreeDate.getFullYear()).toBeLessThanOrEqual(2056);
    expect(plans.avalanche.months).toBeLessThan(plans.minimum.months);
    plans.table.forEach((r) => {
      expect(r.interestSavedVsMinimum).toBeGreaterThanOrEqual(0);
      expect(r.firstPayoffId).toBe(VEHICLE);
      expect(r.firstPayoffMonth).toBeGreaterThanOrEqual(14);
      expect(r.firstPayoffMonth).toBeLessThanOrEqual(18);
    });
    expect(plans.best.byInterest).not.toBe('minimum');
    expect(plans.best.byDate).not.toBe('minimum');
    const custom = comparePlans(debts, { order: [NED_BOND] });
    expect(custom.custom.order[0]).toBe(NED_BOND);
    expect(custom.table).toHaveLength(6);
  });

  it('budget: a deficit lands on the card and is priced; a planned saving frees extra', () => {
    const debts = realTermsDebts();
    const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
    const totals = { Income: {}, Expense: {} };
    months.forEach((m) => {
      totals.Income[m] = 80000;
      totals.Expense[m] = -97000;
    });
    const processed = { netAvg: -17000, months, currentMonth: '2026-08', totalsByMonth: totals, nextPayDate: new Date(2026, 7, 23) };
    const budget = buildDebtBudget(processed, { monthlySaving: 0, cuts: 0, debts, balanced: [] });
    expect(budget.deficitPerCycle).toBe(17000);
    expect(Math.abs(budget.deficitCost12 - 22928)).toBeLessThan(5);
    expect(budget.extraSchedule.every((x) => x === 0)).toBe(true);
    expect(budget.extraSchedule).toHaveLength(HORIZON_CAP);
    expect(budget.breakEvenExtra).toBe(17000);
    expect(budget.absorberId).toBe(CARD);
    expect(budget.absorberRate).toBe(0.2075);
    expect(budget.inflows).toEqual({ [CARD]: 17000 });
    expect(budget.limitMonth).not.toBeNull();
    expect(budget.message).toMatch(/R17 000 a cycle short/);
    expect(budget.surplus).toBe(-17000);

    const saving = buildDebtBudget(processed, { monthlySaving: 20000, debts, balanced: [] });
    expect(saving.extraSchedule[0]).toBe(3000);
    expect(saving.deficitPerCycle).toBe(0);
    expect(saving.inflows).toEqual({});
    expect(saving.message).toMatch(/R3 000 a cycle is available/);

    // The absorber follows the liability growing fastest on the balances, when that is known.
    const balanced = [{ accountId: 'fnb|2000', isLiability: true, typicalDelta: -9000 }];
    const other = { ...debts[0], id: 'fnb|2000', label: 'FNB card', balance: 10000 };
    const chosen = buildDebtBudget(processed, { debts: [...debts, other], balanced });
    expect(chosen.absorberId).toBe('fnb|2000');
    // And the pessimistic surplus wins: a six-cycle mean worse than netAvg lowers the figure.
    const worse = { ...processed, netAvg: -5000 };
    expect(buildDebtBudget(worse, { debts, balanced: [] }).surplus).toBe(-17000);
  });
});
