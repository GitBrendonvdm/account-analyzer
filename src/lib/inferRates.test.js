import { describe, expect, it } from 'vitest';
import { buildAccountRecord } from '../db/accountIdentity';
import { parseTransactionDate } from '../utils/date';
import { cardFixture, loanFixture } from './debtFixtures';
import { buildFullTransfers } from './flows';
import {
  annuity,
  buildLiabilityTerms,
  cardCost,
  classifyLiabilityRows,
  extraToClearWithin,
  feeAdjustedRate,
  groupPostings,
  inferRateByDayCount,
  inferRateByRegression,
  rateSteps,
  remainingTerm,
  toDebt,
} from './inferRates';
import { loadRealExport } from '../test/realData';

const ASOF = new Date(2027, 0, 22);

function termsOf(fixture, { accountOverrides = {}, primeRate = null, asOf = ASOF } = {}) {
  const rows = fixture.rows;
  const names = [...new Set(rows.map((t) => t.Account))];
  const accounts = names.map((n) => ({ ...buildAccountRecord([n]), ...(n === fixture.account ? accountOverrides : {}) }));
  const transfers = buildFullTransfers(rows, { accounts });
  return buildLiabilityTerms(rows, accounts, { asOf, primeRate, transfers });
}

describe('inferRates on the synthetic loan', () => {
  it('reads balance, rate, instalment, fees and term off a self-anchored loan', () => {
    const fx = loanFixture();
    const [t] = termsOf(fx);
    expect(t.balanceSource).toBe('ledger');
    expect(t.balanceOwed).toBeCloseTo(fx.balances.at(-1).after, 2);
    expect(Math.abs(t.rateNominal - 0.12)).toBeLessThan(0.002);
    expect(t.rateVariable).toBe(false);
    expect(t.rateSpread).toBeLessThan(0.001);
    expect(t.instalment).toBe(2224.44);
    expect(t.instalmentSource).toBe('paired');
    expect(t.payingAccountId).toBe('test|2222');
    expect(t.payingCategory).toBe('Personal Loan');
    expect(t.instalmentDay).toBe(5);
    expect(t.feeMonthly).toBe(69);
    expect(t.initiationFee).toBe(0);
    expect(Math.abs(t.remainingMonths - fx.truthRemaining)).toBeLessThanOrEqual(1);
    expect(t.postings).toBe(24);
    expect(t.confidence).toBe('high');
    expect(t.kind).toBe('personal');
    expect(t.rateSource).toBe('inferred');
    expect(t.assumptions.some((a) => /ACT\/365/.test(a))).toBe(true);
    expect(t.totalTermMonths).toBeGreaterThan(t.remainingMonths);
    expect(t.nextPostingDate.getDate()).toBe(5);
  });

  it('uses the actual day count, so February does not read as a lower rate', () => {
    const fx = loanFixture();
    const [t] = termsOf(fx);
    const march = t.rateHistory.find((h) => h.date.getFullYear() === 2025 && h.date.getMonth() === 2);
    const february = t.rateHistory.find((h) => h.date.getFullYear() === 2025 && h.date.getMonth() === 1);
    expect(march.days).toBe(28);
    expect(Math.abs(march.rate - february.rate)).toBeLessThan(0.001);
  });

  it('fits a mid-life export by regression and implies its balance', () => {
    const fx = loanFixture({ disbursementRow: false, fromPosting: 3 });
    const [t] = termsOf(fx);
    expect(t.rateSource).toBe('regression');
    expect(t.regression.r2).toBeGreaterThanOrEqual(0.999);
    expect(Math.abs(t.rateNominal - 0.12)).toBeLessThan(0.003);
    expect(t.balanceSource).toBe('regression');
    const truth = fx.balances.at(-1).after;
    expect(Math.abs(t.balanceOwed - truth) / truth).toBeLessThan(0.01);
    expect(t.confidence).toBe('medium');
    expect(t.rateHistory.length).toBeGreaterThan(0);
  });

  it('rejects the regression when the rate moved, and reads the steps when anchored', () => {
    const rateChanges = [
      { atPosting: 8, rateNominal: 0.115, instalment: 2190 },
      { atPosting: 16, rateNominal: 0.125, instalment: 2260 },
    ];
    const [unanchored] = termsOf(loanFixture({ disbursementRow: false, rateChanges }));
    expect(unanchored.regression.accepted).toBe(false);
    expect(unanchored.rateSource).toBe('default');
    expect(unanchored.balanceOwed).toBeNull();
    expect(unanchored.confidence).toBe('low');
    expect(toDebt(unanchored)).toBeNull();

    const [anchored] = termsOf(loanFixture({ disbursementRow: true, rateChanges }));
    expect(anchored.instalment).toBe(2260);
    expect(anchored.instalmentChanged).toBe(true);
    expect(anchored.instalmentHistory).toHaveLength(3);
    expect(anchored.rateVariable).toBe(true);
    const steps = rateSteps(anchored);
    expect(steps.filter((s) => s.kind === 'rateStep')).toHaveLength(2);
    expect(steps[0].from).toBeCloseTo(0.12, 3);
    expect(steps[0].to).toBeCloseTo(0.115, 3);
    expect(steps[1].to).toBeCloseTo(0.125, 3);
  });

  it('a typed rate wins, is labelled, and warns when it disagrees with the inferred one', () => {
    const [t] = termsOf(loanFixture(), { accountOverrides: { interestRate: 14 } });
    expect(t.rateSource).toBe('user');
    expect(t.rateNominal).toBeCloseTo(0.14, 6);
    expect(t.rateInferred).toBeCloseTo(0.12, 2);
    expect(t.warnings.some((w) => /Typed rate differs/.test(w))).toBe(true);
    const [typedTerm] = termsOf(loanFixture(), { accountOverrides: { termMonths: 30, feesMonthly: 80 } });
    expect(typedTerm.remainingMonths).toBe(30);
    expect(typedTerm.termSource).toBe('user');
    expect(typedTerm.feeMonthly).toBe(80);
    expect(typedTerm.feeSource).toBe('user');
  });

  it('reports a margin and an NCA warning only when prime is given', () => {
    const [without] = termsOf(loanFixture());
    expect(without.margin).toBeNull();
    const [withPrime] = termsOf(loanFixture(), { primeRate: 10.5 });
    expect(withPrime.margin).toBeCloseTo(0.12 - 0.105, 3);
    const [capped] = termsOf(loanFixture(), { primeRate: 10.5, accountOverrides: { interestRate: 32 } });
    expect(capped.warnings.some((w) => /NCA cap/.test(w))).toBe(true);
  });

  it('an external liability with no rows yields terms from the record alone', () => {
    const fx = loanFixture();
    const external = {
      ...buildAccountRecord(['Other Bank Loan *9999']),
      external: true,
      source: 'statement',
      currentBalance: -50000,
      balanceAsOf: '2026-12-31',
      interestRate: 11,
    };
    const names = [...new Set(fx.rows.map((t) => t.Account))];
    const accounts = [...names.map((n) => buildAccountRecord([n])), external];
    const terms = buildLiabilityTerms(fx.rows, accounts, { asOf: ASOF, transfers: buildFullTransfers(fx.rows, { accounts }) });
    const ext = terms.find((t) => t.accountId === 'other bank|9999');
    expect(ext.postings).toBe(0);
    expect(ext.balanceOwed).toBe(50000);
    expect(ext.balanceSource).toBe('statement');
    expect(ext.rateSource).toBe('user');
    expect(ext.external).toBe(true);
    expect(ext.instalment).toBeNull();
    // Sorted by balance owed: the fixture loan (≈ 69k) before the external 50k.
    expect(terms[0].accountId).toBe(fx.accountId);
  });
});

describe('inferRates on a card', () => {
  it('keeps the refund out of credits, reads the repayment habit and a rate floor', () => {
    const fx = cardFixture();
    const rows = fx.rows;
    const accounts = [...new Set(rows.map((t) => t.Account))].map((n) => buildAccountRecord([n]));
    const transfers = buildFullTransfers(rows, { accounts });
    const card = accounts.find((a) => a.id === fx.accountId);
    const classes = classifyLiabilityRows(rows.filter((t) => t.Account === fx.account), { isCard: true, transfers });
    expect(classes.refunds).toHaveLength(1);
    expect(classes.refunds[0].AmountNum).toBe(1036);
    expect(classes.credits).toHaveLength(6);
    expect(classes.interest).toHaveLength(3);
    expect(classes.fees.length).toBe(12);

    const [plain] = buildLiabilityTerms(rows, accounts, { asOf: new Date(2026, 7, 30), transfers });
    expect(plain.kind).toBe('card');
    expect(plain.instalment).toBeNull();
    expect(plain.typicalRepayment).toBe(5000);
    expect(plain.repaymentDay).toBe(26);
    expect(plain.balanceOwed).toBeNull();
    expect(plain.payInFull).toBe(false);
    expect(plain.feeMonthly).toBe(189);

    const [typed] = buildLiabilityTerms(rows, [{ ...card, currentBalance: -50000, balanceAsOf: '2026-08-30' }], {
      asOf: new Date(2026, 7, 30),
      transfers,
    });
    expect(typed.balanceOwed).toBeCloseTo(50000, 6);
    expect(typed.balanceSource).toBe('user');
    expect(Math.abs(typed.rateLowerBound - 0.2075)).toBeLessThan(0.002);
    expect(typed.confidence).toBe('low');
    expect(typed.minimumPct).toBe(5);
    expect(typed.assumptions.some((a) => /default/.test(a))).toBe(true);
    const cost = cardCost(typed);
    expect(cost.minimumNow).toBeCloseTo(2500, 6);
    expect(cost.finance12).toBeCloseTo(3 * 864.58, 2);
    expect(cost.ppi12).toBeCloseTo(720, 2);
    const debt = toDebt(typed);
    expect(debt.balance).toBeCloseTo(50000, 6);
    expect(debt.plannedPayment).toBe(5000);
    expect(debt.minimumPct).toBe(5);
    expect(debt.instalment).toBeNull();
  });
});

describe('inferRates building blocks', () => {
  it('groupPostings collapses same-day rows and counts days between postings', () => {
    const rows = [
      { Date: '2026-01-27', Description: 'Interest', Category: 'Interest', AmountNum: -10 },
      { Date: '2026-01-27', Description: 'Interest', Category: 'Interest', AmountNum: -5 },
      { Date: '2026-02-27', Description: 'Interest', Category: 'Interest', AmountNum: -12 },
    ];
    const postings = groupPostings(rows);
    expect(postings).toHaveLength(2);
    expect(postings[0].interest).toBe(15);
    expect(postings[0].days).toBeNull();
    expect(postings[1].days).toBe(31);
  });

  it('inferRateByDayCount and inferRateByRegression agree on a constant-balance toy', () => {
    const postings = groupPostings([
      { Date: '2026-01-01', Category: 'Interest', AmountNum: -100 },
      { Date: '2026-02-01', Category: 'Interest', AmountNum: -(100000 * 0.12 * 31) / 365 },
      { Date: '2026-03-01', Category: 'Interest', AmountNum: -(100000 * 0.12 * 28) / 365 },
      { Date: '2026-04-01', Category: 'Interest', AmountNum: -(100000 * 0.12 * 31) / 365 },
    ]);
    const day = inferRateByDayCount(postings, () => ({ after: 100000, before: 100000 }));
    expect(day.rateNominal).toBeCloseTo(0.12, 6);
    expect(day.variable).toBe(false);
    expect(day.history).toHaveLength(3);
    const regression = inferRateByRegression(postings, [0, 0, 0, 0]);
    expect(regression.accepted).toBe(false); // fewer than REGRESSION_MIN_POSTINGS, and no slope to fit
    expect(inferRateByDayCount([], () => null).rateNominal).toBeNull();
  });

  it('remainingTerm, annuity, feeAdjustedRate and extraToClearWithin', () => {
    expect(remainingTerm(10000, 0.12, 1000, 0)).toBeCloseTo(10.59, 2);
    expect(remainingTerm(100000, 0.12, 900, 0)).toBe(Infinity);
    expect(remainingTerm(1200, 0, 100, 0)).toBe(12);
    expect(remainingTerm(0, 0.12, 100, 0)).toBe(0);
    expect(remainingTerm(-5, 0.12, 100, 0)).toBe(0);
    expect(annuity(100000, 0.01, 36)).toBeCloseTo(3321.43, 1);
    expect(annuity(1200, 0, 12)).toBe(100);
    expect(annuity(1200, 0.01, 0)).toBe(0);
    const terms = { balanceOwed: 171031, rateNominal: 0.172, feeMonthly: 676.04, instalment: 5139.85 };
    expect(feeAdjustedRate(terms)).toBeCloseTo(0.2194, 3);
    expect(feeAdjustedRate({ ...terms, balanceOwed: null })).toBeNull();
    expect(extraToClearWithin(terms, 12)).toBeCloseTo(annuity(171031, 0.172 / 12, 12) + 676.04 - 5139.85, 2);
    expect(extraToClearWithin({ ...terms, instalment: 1e9 }, 12)).toBe(0);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('inferRates on the real export', () => {
  // The body runs even when skipped; a missing export must not break collection.
  if (!real) return;
  it('infers the four loans as the spec reconciles them', () => {
    real.forEach((t) => {
      t.DateObj = parseTransactionDate(t.Date);
    });
    const accounts = [...new Set(real.map((t) => t.Account))].map((n) => buildAccountRecord([n]));
    const transfers = buildFullTransfers(real, { accounts });
    const terms = buildLiabilityTerms(real, accounts, { asOf: new Date(2026, 7, 22), transfers });
    const loans = terms.filter((t) => t.type === 'Loan');
    const cards = terms.filter((t) => t.type === 'Credit Card');
    expect(loans).toHaveLength(4);
    loans.forEach((t) => expect(t.postings).toBeGreaterThanOrEqual(7));
    expect(loans.filter((t) => t.balanceSource === 'ledger')).toHaveLength(3);
    loans.forEach((t) => expect(t.instalmentSource).toBe('paired'));

    const vehicle = loans.find((t) => t.kind === 'vehicle');
    expect(vehicle.balanceSource).toBe('regression');
    expect(vehicle.regression.r2).toBeGreaterThanOrEqual(0.99);
    expect(vehicle.rateNominal).toBeGreaterThanOrEqual(0.09);
    expect(vehicle.rateNominal).toBeLessThanOrEqual(0.1);
    expect(vehicle.instalment).toBe(4990.67);
    expect(vehicle.remainingMonths).toBeGreaterThanOrEqual(14);
    expect(vehicle.remainingMonths).toBeLessThanOrEqual(18);

    const bonds = loans.filter((t) => t.kind === 'bond');
    expect(bonds).toHaveLength(2);
    bonds.forEach((t) => {
      expect(t.rateNominal).toBeGreaterThanOrEqual(0.088);
      expect(t.rateNominal).toBeLessThanOrEqual(0.1);
      expect(t.rateVariable).toBe(true);
      expect(t.feeMonthly).toBe(69);
      expect(rateSteps(t).some((s) => s.kind === 'rateStep' && s.date.getFullYear() === 2026)).toBe(true);
    });
    const instalments = bonds.map((t) => t.instalment).sort((a, b) => b - a);
    expect(instalments).toEqual([22854.88, 6674.53]);
    const remaining = bonds.map((t) => t.remainingMonths).sort((a, b) => b - a);
    expect(remaining[0]).toBeGreaterThanOrEqual(300);
    expect(remaining[0]).toBeLessThanOrEqual(420);
    expect(Math.abs(remaining[1] - 166)).toBeLessThanOrEqual(4);

    const personal = loans.find((t) => t.kind === 'personal');
    expect(personal.rateNominal).toBeGreaterThanOrEqual(0.165);
    expect(personal.rateNominal).toBeLessThanOrEqual(0.175);
    expect(personal.rateVariable).toBe(false);
    expect(personal.instalment).toBe(5139.85);
    expect(personal.feeMonthly).toBeCloseTo(676.04, 2);
    expect(personal.remainingMonths).toBeGreaterThanOrEqual(50);
    expect(personal.remainingMonths).toBeLessThanOrEqual(56);

    // Cards carry no typed balance in the export, so they cannot enter a plan yet.
    expect(cards.length).toBeGreaterThanOrEqual(2);
    cards.forEach((t) => expect(toDebt(t)).toBeNull());
    expect(loans.every((t) => toDebt(t) !== null)).toBe(true);
  });
});
