import { describe, expect, it } from 'vitest';
import { amountDispersion, isMissedThisCycle } from './missedPayments';

// Cycles start on the 23rd, so day 1 of '2026-08' is Thu 23 Jul 2026.
const STARTS = {
  '2026-03': new Date(2026, 1, 23),
  '2026-04': new Date(2026, 2, 23),
  '2026-05': new Date(2026, 3, 23),
  '2026-06': new Date(2026, 4, 23),
  '2026-07': new Date(2026, 5, 23),
  '2026-08': new Date(2026, 6, 23),
};
const PRIOR = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const CURRENT = '2026-08';

function tx(payMonth, date, amount) {
  return { 'Pay Month': payMonth, Date: date, AmountNum: amount };
}

/** A debit order on the 27th of every month at the same amount. */
function bill(amounts = [-4991, -4991, -4991, -4991, -4991]) {
  return PRIOR.map((m, i) => {
    const start = STARTS[m];
    const d = new Date(start.getFullYear(), start.getMonth(), 27);
    return tx(m, d.toISOString().slice(0, 10), amounts[i]);
  });
}

describe('amountDispersion', () => {
  it('is zero when every cycle charged the same', () => {
    expect(amountDispersion([-4991, -4991, -4991])).toBe(0);
  });

  it('ignores sign, so income and expense are measured alike', () => {
    expect(amountDispersion([4991, -4991, 4991])).toBe(0);
  });

  it('shrugs off a single doubled instalment', () => {
    // 5140 / 5140 / 10420 / 5340 / 5140 — one month paid twice, still plainly a bill.
    expect(amountDispersion([-5140, -5140, -10420, -5340, -5140])).toBeLessThan(0.25);
  });

  it('is large for discretionary spend that merely recurs', () => {
    // Clothing: R100 one month, R4 202 the next.
    expect(amountDispersion([-2006, -1227, -100, -4202])).toBeGreaterThan(0.25);
  });

  it('reports Infinity rather than perfect regularity for an all-zero series', () => {
    expect(amountDispersion([0, 0, 0])).toBe(Infinity);
  });
});

describe('isMissedThisCycle', () => {
  it('flags a regular bill once its usual week has passed', () => {
    // Day 27 of the cycle: well past the week the instalment normally lands in.
    expect(isMissedThisCycle(bill(), PRIOR, CURRENT, STARTS, 27)).toBe(true);
  });

  it('does not flag it before its usual week has passed', () => {
    expect(isMissedThisCycle(bill(), PRIOR, CURRENT, STARTS, 3)).toBe(false);
  });

  it('does not flag it once the payment has landed', () => {
    const items = [...bill(), tx(CURRENT, '2026-07-27', -4991)];
    expect(isMissedThisCycle(items, PRIOR, CURRENT, STARTS, 27)).toBe(false);
  });

  it('ignores a category that recurs at wildly different amounts', () => {
    // Present in every cycle, but this is Clothing, not a debit order.
    const items = bill([-2006, -1227, -100, -4202, -1500]);
    expect(isMissedThisCycle(items, PRIOR, CURRENT, STARTS, 27)).toBe(false);
  });

  it('ignores a category that skips cycles, however consistent the amount', () => {
    const items = bill().slice(0, 3); // 3 of 5 prior cycles — below the occurrence floor
    expect(isMissedThisCycle(items, PRIOR, CURRENT, STARTS, 27)).toBe(false);
  });

  it('measures lateness against observed data, not the wall clock', () => {
    // Today may be day 27, but if the export only reaches day 3 nothing can be called overdue.
    expect(isMissedThisCycle(bill(), PRIOR, CURRENT, STARTS, 3)).toBe(false);
  });

  it('needs history before it will call anything late', () => {
    expect(isMissedThisCycle(bill(), [], CURRENT, STARTS, 27)).toBe(false);
  });
});
