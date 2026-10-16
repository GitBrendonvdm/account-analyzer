import { describe, expect, it } from 'vitest';
import { addInferredLoanRows, payeeSignature, payMonthRuleOf } from './loanProjection';
import { buildLiabilityTerms } from './inferRates';
import { accountRows, balanceAt } from './ledger';
import { settlementFor } from './closure';

/**
 * A bond simulated month by month the way the real one behaves — interest on the daily balance at
 * a fixed annual rate on the 25th, a monthly fee, an instalment on the 25th — so that the estimate can
 * be checked against what the loan REALLY did. The last months are hidden from the loan and left in
 * the cheque account (where the payments are), which is exactly the situation the feature is for.
 */

const LOAN = 'FNB Loan *6996';
const CHEQUE = 'FNB Bank *9986';
const RATE = 0.0951;
const FEE = 69;
const INSTALMENT = 6674.53;

const round2 = (n) => Math.round(n * 100) / 100;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dt = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const row = (Date, Description, Account, AmountNum, extra = {}) => ({
  Date,
  DateObj: dt(Date),
  Description,
  Account,
  AmountNum,
  Amount: String(AmountNum),
  Category: 'x',
  'Spending Group': 'x',
  'Pay Month': Date.slice(0, 7),
  Status: 'Completed',
  ...extra,
});

/** 12 months of postings on the 25th from `start`, returning the loan rows, the cheque rows and each month's owed balance. */
function simulate({ months = 12, start = [2025, 11], opening = 640000 } = {}) {
  const loan = [];
  const cheque = [];
  const owedAfter = [];
  let owed = opening;
  let [y, m] = start;
  let prev = dt(iso(y, m, 25));
  for (let k = 1; k <= months; k += 1) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const day = dt(iso(y, m, 25));
    const days = Math.round((day - prev) / 86400000);
    const interest = round2((owed * RATE * days) / 365);
    owed = owed + interest + FEE - INSTALMENT;
    const date = iso(y, m, 25);
    loan.push(row(date, 'Interest', LOAN, -interest, { Category: 'Interest' }));
    loan.push(row(date, 'Monthly Service Fee', LOAN, -FEE, { Category: 'Bank Charges' }));
    loan.push(row(date, 'Dc Debit Order', LOAN, INSTALMENT, { Category: 'Home Loan / Bond' }));
    cheque.push(row(date, `FNB HOME  3000021106996 26${String(m).padStart(2, '0')}25`, CHEQUE, -INSTALMENT, { Category: 'Home Loan / Bond' }));
    owedAfter.push({ date, owed: round2(owed) });
    prev = day;
  }
  return { loan, cheque, owedAfter };
}

const account = (extra = {}) => ({
  id: 'fnb|6996',
  bank: 'FNB',
  mask: '6996',
  rawName: LOAN,
  type: 'Loan',
  label: null,
  currentBalance: null,
  balanceAsOf: null,
  ...extra,
});
const cheque = { id: 'fnb|9986', bank: 'FNB', mask: '9986', rawName: CHEQUE, type: 'Bank', currentBalance: 1000, balanceAsOf: '2026-11-30' };

/** Hide the loan's last `hide` months from the loan, keep their payments in the cheque account. */
function scenario(hide) {
  const sim = simulate();
  const loanRows = sim.loan.slice(0, sim.loan.length - hide * 3);
  const lastReal = sim.owedAfter[sim.owedAfter.length - hide - 1];
  const rows = [...loanRows, ...sim.cheque].map((r, i) => ({ ...r, id: i }));
  return { sim, rows, lastReal, truth: sim.owedAfter.slice(sim.owedAfter.length - hide) };
}

const settlementRowOf = (s, date) => ({
  Date: date,
  DateObj: dt(date),
  Description: s.description,
  Account: LOAN,
  Category: s.category,
  'Spending Group': s.group,
  'Pay Month': s.payMonth,
  AmountNum: s.amount,
  Amount: String(s.amount),
  Status: 'Completed',
  Source: 'settlement',
});

describe('payeeSignature', () => {
  it('names the payee whatever the bank or the aggregator wrote around it', () => {
    expect(payeeSignature('FNB HOME  3000021106996 260925')).toBe('fnb home');
    expect(payeeSignature('Fnb Home * Xx0725 Fnb Home *6996')).toBe('fnb home');
    expect(payeeSignature('TOYOTA_FIN86133574081001260927')).toBe('toyota fin');
    expect(payeeSignature('Toyota_Fin *0727 Toyota_Fin *1001')).toBe('toyota fin');
    expect(payeeSignature('NEDBHL    80054555928   260925')).toBe('nedbhl');
    expect(payeeSignature('')).toBe('');
  });
});

describe('payMonthRuleOf', () => {
  it('finds the cycle boundary from the rows the export already keyed', () => {
    const rows = [];
    for (let d = 1; d <= 28; d += 1) {
      const date = `2026-07-${String(d).padStart(2, '0')}`;
      rows.push({ Date: date, 'Pay Month': d >= 23 ? '2026-08' : '2026-07' });
      const aug = `2026-08-${String(d).padStart(2, '0')}`;
      rows.push({ Date: aug, 'Pay Month': d >= 23 ? '2026-09' : '2026-08' });
    }
    const rule = payMonthRuleOf(rows);
    expect(rule('2026-10-22')).toBe('2026-10');
    expect(rule('2026-10-23')).toBe('2026-11');
    expect(rule('2026-12-25')).toBe('2027-01');
  });

  it('falls back to calendar months when the rows are keyed by calendar month', () => {
    const rule = payMonthRuleOf([{ Date: '2026-07-30', 'Pay Month': '2026-07' }, { Date: '2026-07-05', 'Pay Month': '2026-07' }]);
    expect(rule('2026-10-30')).toBe('2026-10');
  });
});

describe('addInferredLoanRows', () => {
  it('writes the months the loan was not uploaded for, to within a few rand of what it really did', () => {
    const { rows, lastReal, truth } = scenario(2);
    const acc = account({ currentBalance: -lastReal.owed, balanceAsOf: lastReal.date });
    const out = addInferredLoanRows(rows, [acc, cheque]);

    const inferred = out.rows.filter((r) => r.inferred);
    expect(inferred.length).toBe(6); // interest, fee, payment — twice
    expect(inferred.every((r) => r.Account === LOAN && r.Status === 'Inferred')).toBe(true);
    expect(inferred.map((r) => r.Description)).toEqual(
      expect.arrayContaining(['Interest (estimated)', 'Monthly service fee (estimated)', 'Instalment (matched from your payments)']),
    );

    // The loan's own balance after the hidden months, against what the simulation says it was.
    const own = accountRows(out.rows, { accountId: acc.id });
    const owedNow = -balanceAt(own, acc, truth[1].date);
    expect(Math.abs(owedNow - truth[1].owed)).toBeLessThan(3);
    expect(out.summary).toHaveLength(1);
    expect(out.summary[0]).toMatchObject({ accountId: acc.id, postings: 2, payments: 2 });
    expect(out.summary[0].rate).toBeGreaterThan(0.09);
    expect(out.summary[0].rate).toBeLessThan(0.1);
  });

  it('keeps ids in step with the sorted order and leaves real rows alone', () => {
    const { rows, lastReal } = scenario(1);
    const acc = account({ currentBalance: -lastReal.owed, balanceAsOf: lastReal.date });
    const out = addInferredLoanRows(rows, [acc, cheque]);
    expect(out.rows.map((r) => r.id)).toEqual(out.rows.map((_, i) => i));
    const dates = out.rows.map((r) => r.Date);
    expect(dates).toEqual([...dates].sort());
    expect(out.rows.filter((r) => !r.inferred)).toHaveLength(rows.length);
  });

  it('writes nothing once the loan’s own rows catch up', () => {
    const sim = simulate();
    const rows = [...sim.loan, ...sim.cheque].map((r, i) => ({ ...r, id: i }));
    const acc = account({ currentBalance: -sim.owedAfter[sim.owedAfter.length - 1].owed, balanceAsOf: sim.owedAfter[sim.owedAfter.length - 1].date });
    const out = addInferredLoanRows(rows, [acc, cheque]);
    expect(out.rows.filter((r) => r.inferred)).toHaveLength(0);
    expect(out.summary).toEqual([]);
  });

  it('does not run ahead of the account that pays it', () => {
    const { rows, lastReal } = scenario(2);
    const acc = account({ currentBalance: -lastReal.owed, balanceAsOf: lastReal.date });
    // The cheque history stops after the first hidden month: no interest is charged for the second.
    const trimmed = rows.filter((r) => r.Account !== CHEQUE || r.Date <= '2026-10-31');
    const out = addInferredLoanRows(trimmed, [acc, cheque]);
    expect(out.rows.filter((r) => r.inferred && r.Description.startsWith('Interest'))).toHaveLength(1);
  });

  it('does not project a loan whose rate it has only assumed', () => {
    const sim = simulate({ months: 12 });
    // One lone instalment and no interest ever seen: nothing to learn a rate from.
    const rows = [sim.loan[2], ...sim.cheque].map((r, i) => ({ ...r, id: i }));
    const out = addInferredLoanRows(rows, [account({ currentBalance: -600000, balanceAsOf: '2025-12-25' }), cheque]);
    expect(out.rows.filter((r) => r.inferred)).toHaveLength(0);
  });

  it('leaves a closed account alone', () => {
    const { rows, lastReal } = scenario(2);
    const acc = account({ currentBalance: -lastReal.owed, balanceAsOf: lastReal.date, closedOn: '2026-10-01' });
    expect(addInferredLoanRows(rows, [acc, cheque]).rows.filter((r) => r.inferred)).toHaveLength(0);
  });

  it('keeps estimating a closed loan up to the day it closed, and the settlement then takes it to nothing', () => {
    const { rows, lastReal } = scenario(2);
    const open = account({ currentBalance: -lastReal.owed, balanceAsOf: lastReal.date });
    const closedOn = '2026-10-25';

    // Before closing: the estimate runs, and the settlement is sized from it.
    const before = addInferredLoanRows(rows, [open, cheque]);
    const owedOnTheDay = -balanceAt(accountRows(before.rows, { accountId: open.id }).filter((r) => r.Date <= closedOn), open, closedOn);
    const settlement = settlementFor({ account: open, data: before.rows, closedOn, payMonthOf: () => '2026-11' });
    expect(settlement.amount).toBeCloseTo(owedOnTheDay, 2);

    // After closing: the server has stored the settlement and restated the account at nothing.
    const row = { ...settlementRowOf(settlement, closedOn), id: rows.length };
    const closed = {
      ...open,
      closedOn,
      currentBalance: 0,
      balanceAsOf: closedOn,
      preClosure: { currentBalance: open.currentBalance, balanceAsOf: open.balanceAsOf },
    };
    const after = addInferredLoanRows([...rows, row], [closed, cheque]);

    // The same estimate up to the closing day, and none beyond it.
    const inferred = after.rows.filter((r) => r.inferred);
    expect(inferred.map((r) => r.Date).sort()).toEqual(before.rows.filter((r) => r.inferred && r.Date <= closedOn).map((r) => r.Date).sort());
    expect(after.rows.some((r) => r.Source === 'settlement')).toBe(true);
    // A closed loan is finished, not an estimate to show.
    expect(after.summary).toEqual([]);
    // And measured the way it was before it was closed, the loan ends at exactly nothing.
    const ledger = accountRows(after.rows, { accountId: open.id });
    expect(balanceAt(ledger, open, closedOn)).toBeCloseTo(0, 2);
  });

  it('claims a payment for the loan that has a name for it, not a loan that only matches the amount', () => {
    const { rows, lastReal } = scenario(1);
    const acc = account({ currentBalance: -lastReal.owed, balanceAsOf: lastReal.date });
    // A second loan with the same instalment but a different payee.
    const other = account({ id: 'fnb|1111', mask: '1111', rawName: 'FNB Loan *1111', currentBalance: -lastReal.owed, balanceAsOf: lastReal.date });
    const otherRows = [
      row('2026-08-25', 'Interest', other.rawName, -4900, { Category: 'Interest' }),
      row('2026-09-25', 'Interest', other.rawName, -4800, { Category: 'Interest' }),
      row('2026-09-25', 'Dc Debit Order', other.rawName, INSTALMENT),
    ];
    const out = addInferredLoanRows([...rows, ...otherRows].map((r, i) => ({ ...r, id: i })), [acc, other, cheque]);
    expect(out.rows.filter((r) => r.inferred && r.Account === other.rawName && r.Description.startsWith('Instalment'))).toHaveLength(0);
    expect(out.rows.filter((r) => r.inferred && r.Account === LOAN && r.Description.startsWith('Instalment'))).toHaveLength(1);
  });

  it('is read by the terms engine as a balance, not as evidence', () => {
    const { rows, lastReal, truth } = scenario(2);
    const acc = account({ currentBalance: -lastReal.owed, balanceAsOf: lastReal.date });
    const before = buildLiabilityTerms(rows, [acc, cheque], { asOf: new Date(2026, 10, 30) })[0];
    const out = addInferredLoanRows(rows, [acc, cheque]);
    const after = buildLiabilityTerms(out.rows, [acc, cheque], { asOf: new Date(2026, 10, 30) })[0];
    // The balance moves with the estimate; what was learned from the real rows does not.
    expect(Math.abs(after.balanceOwed - truth[1].owed)).toBeLessThan(3);
    expect(after.postings).toBe(before.postings);
    expect(after.rateNominal).toBeCloseTo(before.rateNominal, 6);
    expect(after.instalment).toBe(before.instalment);
  });
});
