/**
 * What a debt costs each cycle, from its terms.
 *
 * Interest is what the loan engine saw accrue this cycle if it saw one, else a card's finance charge,
 * else the balance at the nominal rate for a twelfth of a year. Fees are the monthly admin and
 * service fees. Shared by the debts table and the line at the head of the Debt page, so the two can
 * never print different totals.
 */

export const isCard = (t) => t?.type === 'Credit Card' || t?.kind === 'card';

export function monthlyInterest(term) {
  if (Number.isFinite(term.accruedThisCycle)) return term.accruedThisCycle;
  if (isCard(term) && Number.isFinite(term.financeChargeMonthly)) return term.financeChargeMonthly;
  if (Number.isFinite(term.balanceOwed) && Number.isFinite(term.rateNominal)) {
    return (term.balanceOwed * term.rateNominal) / 12;
  }
  return 0;
}

/** @returns {{ interest, fees, total, owed, unknown: number }} owed counts only debts with a balance */
export function debtCostPerCycle(terms) {
  const list = terms ?? [];
  const interest = list.reduce((s, t) => s + monthlyInterest(t), 0);
  const fees = list.reduce((s, t) => s + (Number.isFinite(t.feeMonthly) ? t.feeMonthly : 0), 0);
  const owed = list.reduce((s, t) => s + (Number.isFinite(t.balanceOwed) ? t.balanceOwed : 0), 0);
  return { interest, fees, total: interest + fees, owed, unknown: list.filter((t) => !Number.isFinite(t.balanceOwed)).length };
}
