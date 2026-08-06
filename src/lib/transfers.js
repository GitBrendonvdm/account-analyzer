import { amountCents } from '../utils/amount';
import {
  isBudgetFacilityDescription,
  isBudgetFacilityTransferDescription,
} from './transferPatterns';

export { amountCents };

/** Resolve the month bucket for a transaction (Pay Month, falling back to Date). */
export function transactionMonth(transaction, visibleMonths) {
  const visible = visibleMonths ? new Set(visibleMonths) : null;
  const payMonth = transaction['Pay Month'];
  if (payMonth && (!visible || visible.has(payMonth))) return payMonth;

  const fromDate = parseMonthFromDate(transaction.Date);
  if (fromDate && (!visible || visible.has(fromDate))) return fromDate;

  return payMonth || fromDate || '';
}

function parseMonthFromDate(date) {
  if (!date) return '';
  const iso = date.match(/^(\d{4}-\d{2})/);
  if (iso) return iso[1];
  const dmy = date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}`;
  return '';
}

function inVisibleWindow(transaction, visibleMonths) {
  const visible = new Set(visibleMonths);
  return visible.has(transaction['Pay Month']) || visible.has(parseMonthFromDate(transaction.Date));
}

function bucketTransactions(transactions, visibleMonths) {
  const buckets = new Map();
  transactions.forEach((t) => {
    const month = transactionMonth(t, visibleMonths);
    if (!month) return;
    const key = `${month}|${amountCents(t.AmountNum)}`;
    if (!buckets.has(key)) buckets.set(key, { credit: [], debit: [] });
    const bucket = buckets.get(key);
    if (t.AmountNum > 0) bucket.credit.push(t);
    else bucket.debit.push(t);
  });
  return buckets;
}

function recordMatch(rawMatches, transferIds, credit, debit, visibleMonths, isReversal) {
  transferIds.add(credit.id);
  transferIds.add(debit.id);
  rawMatches.push({
    credit,
    debit,
    month: transactionMonth(credit, visibleMonths),
    amount: credit.AmountNum,
    isReversal,
  });
}

function matchCreditDebit({
  credit,
  debit,
  usedDebit,
  transferIds,
  rawMatches,
  visibleMonths,
  isReversal,
  sameAccount,
}) {
  credit.forEach((incoming) => {
    if (transferIds.has(incoming.id)) return;
    const matchIdx = debit.findIndex((outgoing, i) => {
      if (usedDebit.has(i) || transferIds.has(outgoing.id)) return false;
      const same = outgoing.Account === incoming.Account;
      return sameAccount ? same : !same;
    });
    if (matchIdx >= 0) {
      usedDebit.add(matchIdx);
      recordMatch(rawMatches, transferIds, incoming, debit[matchIdx], visibleMonths, isReversal);
    }
  });
}

function matchCrossAccountBuckets(buckets, transferIds, rawMatches, visibleMonths) {
  buckets.forEach(({ credit, debit }) => {
    matchCreditDebit({
      credit,
      debit,
      usedDebit: new Set(),
      transferIds,
      rawMatches,
      visibleMonths,
      isReversal: false,
      sameAccount: false,
    });
  });
}

function matchReversalBuckets(buckets, transferIds, rawMatches, visibleMonths) {
  buckets.forEach(({ credit, debit }) => {
    matchCreditDebit({
      credit,
      debit,
      usedDebit: new Set(),
      transferIds,
      rawMatches,
      visibleMonths,
      isReversal: true,
      sameAccount: true,
    });
  });
}

function matchBudgetFacilityGroups(scoped, visibleMonths, transferIds, rawMatches) {
  const groups = new Map();
  scoped.forEach((t) => {
    if (!isBudgetFacilityDescription(t.Description)) return;
    const month = transactionMonth(t, visibleMonths);
    if (!month) return;
    const key = `${month}|${amountCents(t.AmountNum)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  groups.forEach((txns) => {
    const hasTransfer = txns.some((t) => isBudgetFacilityTransferDescription(t.Description));
    if (!hasTransfer) return;

    const credits = txns.filter((t) => t.AmountNum > 0 && !transferIds.has(t.id));
    const debits = txns.filter((t) => t.AmountNum < 0 && !transferIds.has(t.id));
    const usedDebit = new Set();

    matchCreditDebit({
      credit: credits,
      debit: debits,
      usedDebit,
      transferIds,
      rawMatches,
      visibleMonths,
      isReversal: false,
      sameAccount: true,
    });

    matchCreditDebit({
      credit: credits,
      debit: debits,
      usedDebit,
      transferIds,
      rawMatches,
      visibleMonths,
      isReversal: false,
      sameAccount: false,
    });

    txns.forEach((t) => {
      if (isBudgetFacilityTransferDescription(t.Description)) transferIds.add(t.id);
    });
  });
}

export function isTransferDescription(description = '') {
  return /\btransf\w*|\btrans\b/i.test(description);
}

/**
 * Does the row's own category describe money moving between the user's accounts?
 *
 * The export's `Spending Group` column labels some rows "Transfer" that plainly aren't: groceries at
 * Makro, a hosting invoice, a bet. Those rows carry `Type = Expense` and a real spending category,
 * and the same merchant is filed as "Day-to-day" elsewhere in the same export — the label is simply
 * wrong on them, and trusting it deleted R13 194 of real spend over four cycles. The category is the
 * corroborating signal: keep the label where the row itself says internal movement.
 */
export function isInternalMovementCategory(category = '') {
  return /transfer|repayment/i.test(category);
}

function markDescriptionTransfers(scoped, transferIds) {
  scoped.forEach((t) => {
    if (isTransferDescription(t.Description)) transferIds.add(t.id);
  });
}

function buildPairMap(rawMatches) {
  const pairMap = new Map();
  rawMatches.forEach(({ credit, debit, month, amount, isReversal }) => {
    const fromAccount = debit.Account;
    const toAccount = credit.Account;
    const key = isReversal
      ? `reversal:${fromAccount}|${amountCents(amount)}`
      : `${fromAccount}→${toAccount}`;
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        fromAccount,
        toAccount,
        isReversal,
        itemMap: new Map(),
        matches: [],
      });
    }
    const pair = pairMap.get(key);
    pair.itemMap.set(credit.id, credit);
    pair.itemMap.set(debit.id, debit);
    pair.matches.push({ credit, debit, month, amount, isReversal });
  });
  return pairMap;
}

/**
 * Pairs inflows/outflows with the same amount in the same month:
 * - cross-account transfers
 * - same-account reversals (e.g. purchase + refund)
 * - budget facility transfers (not direct payments — those stay as expenses until paired)
 */
export function detectTransferPairs(transactions, visibleMonths) {
  const transferIds = new Set();
  const scoped = transactions.filter((t) => t.AmountNum !== 0 && inVisibleWindow(t, visibleMonths));
  const buckets = bucketTransactions(scoped, visibleMonths);
  const rawMatches = [];

  matchCrossAccountBuckets(buckets, transferIds, rawMatches, visibleMonths);
  matchReversalBuckets(buckets, transferIds, rawMatches, visibleMonths);
  matchBudgetFacilityGroups(scoped, visibleMonths, transferIds, rawMatches);
  markDescriptionTransfers(scoped, transferIds);

  const pairMap = buildPairMap(rawMatches);
  const pairs = [...pairMap.values()].map((p) => ({
    fromAccount: p.fromAccount,
    toAccount: p.toAccount,
    isReversal: p.isReversal,
    items: [...p.itemMap.values()],
    matches: p.matches,
  }));

  return { transferIds, pairs, reversalIds: new Set(rawMatches.filter((m) => m.isReversal).flatMap((m) => [m.credit.id, m.debit.id])) };
}

export function detectTransferIds(transactions, visibleMonths) {
  return detectTransferPairs(transactions, visibleMonths).transferIds;
}

export function isTransfer(transaction, transferIds) {
  return transferIds.has(transaction.id);
}
