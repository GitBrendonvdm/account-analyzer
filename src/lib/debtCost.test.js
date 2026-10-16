import { describe, expect, it } from 'vitest';
import { debtCostPerCycle, monthlyInterest } from './debtCost';

describe('monthlyInterest', () => {
  it('prefers what accrued, then a card’s finance charge, then the balance at the rate', () => {
    expect(monthlyInterest({ accruedThisCycle: 500, balanceOwed: 100000, rateNominal: 0.1 })).toBe(500);
    expect(monthlyInterest({ type: 'Credit Card', financeChargeMonthly: 300, balanceOwed: 10000, rateNominal: 0.2 })).toBe(300);
    expect(monthlyInterest({ balanceOwed: 120000, rateNominal: 0.1 })).toBe(1000);
    expect(monthlyInterest({})).toBe(0);
  });
});

describe('debtCostPerCycle', () => {
  it('adds interest and fees across the debts, and counts the balance of those that have one', () => {
    const out = debtCostPerCycle([
      { balanceOwed: 120000, rateNominal: 0.1, feeMonthly: 69 },
      { type: 'Credit Card', financeChargeMonthly: 300, balanceOwed: 10000 },
      { rateNominal: 0.13 },
    ]);
    expect(out).toEqual({ interest: 1300, fees: 69, total: 1369, owed: 130000, unknown: 1 });
  });

  it('is zero for nothing', () => {
    expect(debtCostPerCycle(undefined)).toEqual({ interest: 0, fees: 0, total: 0, owed: 0, unknown: 0 });
  });
});
