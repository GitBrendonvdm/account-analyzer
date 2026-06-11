import { GROUP_ORDER } from '../constants';
import { enrichWithEffectivePayMonths, getPayMonth } from './effectivePayMonth';
import { buildExceptionClusters, resolveMainGroup } from './exceptions';
import { computeCurrentMinusAvg, computeExpectedValue, monthlyAvg } from './expected';
import { detectTransferPairs } from './transfers';

function totalsForItems(items, months, useEffectiveMonth = true) {
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  items.forEach((t) => {
    const m = useEffectiveMonth ? getPayMonth(t) : t['Pay Month'];
    if (months.includes(m)) totals[m] = (totals[m] || 0) + t.AmountNum;
  });
  return totals;
}

function buildTransferSubcategories(pairs, months, selectedAccounts) {
  const selected = new Set(selectedAccounts);
  const pairedIds = new Set();
  const sub = pairs
    .filter((pair) => pair.items.some((t) => selected.has(t.Account)))
    .map((pair) => {
      pair.items.forEach((t) => {
        if (selected.has(t.Account)) pairedIds.add(t.id);
      });
      const selectedItems = pair.items.filter((t) => selected.has(t.Account));
      return {
        name: pair.isReversal
          ? `${pair.fromAccount} · Reversed`
          : `${pair.fromAccount} → ${pair.toAccount}`,
        totalsByMonth: totalsForItems(selectedItems, months, false),
        avg: 0,
        expected: 0,
        items: selectedItems,
        matches: pair.matches,
        isTransferPair: true,
        isReversal: pair.isReversal,
        fromAccount: pair.fromAccount,
        toAccount: pair.toAccount,
        skipExpected: true,
      };
    });
  return { sub, pairedIds };
}

function hasMonthTotals(totalsByMonth) {
  return Object.values(totalsByMonth).some((value) => Math.abs(value || 0) > 0.001);
}

export function processTransactionData(data, selectedAccounts, monthRange) {
  if (!data || data.length === 0) return null;

  const selected = new Set(selectedAccounts);
  const allMonths = [...new Set(data.map((t) => t['Pay Month']))].sort();
  const calcMonths = allMonths;
  const months = allMonths.slice(-monthRange);
  const scopedData = enrichWithEffectivePayMonths(data, calcMonths);
  const currentMonth = calcMonths[calcMonths.length - 1];
  const groups = Object.fromEntries(GROUP_ORDER.map((name) => [name, { totals: {}, sub: {} }]));
  const totalsByMonth = { Income: {}, Expense: {} };
  calcMonths.forEach((m) => {
    totalsByMonth.Income[m] = 0;
    totalsByMonth.Expense[m] = 0;
  });

  const { transferIds, pairs, reversalIds } = detectTransferPairs(data, calcMonths);
  const exceptionState = { ...buildExceptionClusters(scopedData, calcMonths, transferIds), transferIds };
  scopedData.forEach((t) => {
    const mainGroup = resolveMainGroup(t, exceptionState);
    const m = mainGroup === 'Transfers' ? t['Pay Month'] : getPayMonth(t);
    if (!calcMonths.includes(m)) return;

    if (mainGroup === 'Transfers') {
      groups.Transfers.totals[m] = (groups.Transfers.totals[m] || 0) + t.AmountNum;
      return;
    }

    const c = t.Category || 'Uncategorized';
    if (!groups[mainGroup].sub[c]) groups[mainGroup].sub[c] = { totals: {}, items: [] };
    groups[mainGroup].totals[m] = (groups[mainGroup].totals[m] || 0) + t.AmountNum;
    groups[mainGroup].sub[c].totals[m] = (groups[mainGroup].sub[c].totals[m] || 0) + t.AmountNum;
    groups[mainGroup].sub[c].items.push(t);

    if (mainGroup === 'Income' || mainGroup === 'Expense') {
      totalsByMonth[mainGroup][m] = (totalsByMonth[mainGroup][m] || 0) + t.AmountNum;
    } else if (mainGroup === 'Income Exceptions') {
      totalsByMonth.Income[m] = (totalsByMonth.Income[m] || 0) + t.AmountNum;
    } else if (mainGroup === 'Expense Exceptions') {
      totalsByMonth.Expense[m] = (totalsByMonth.Expense[m] || 0) + t.AmountNum;
    }
  });

  const { sub: transferSubs, pairedIds } = buildTransferSubcategories(
    pairs,
    calcMonths,
    selectedAccounts,
  );
  const unmatched = scopedData.filter(
    (t) =>
      selected.has(t.Account) &&
      transferIds.has(t.id) &&
      !pairedIds.has(t.id) &&
      calcMonths.includes(t['Pay Month']),
  );
  if (unmatched.length > 0) {
    transferSubs.push({
      name: 'Unmatched single leg',
      totalsByMonth: totalsForItems(unmatched, calcMonths, false),
      avg: 0,
      expected: 0,
      items: unmatched,
      isTransferPair: false,
      isUnmatchedTransfer: true,
      skipExpected: true,
    });
  }
  const rows = GROUP_ORDER.map((gName) => {
    const gData = groups[gName];
    const isExceptionGroup = gName.includes('Exceptions');
    const skipExpected = isExceptionGroup || gName === 'Transfers';
    const sub =
      gName === 'Transfers'
        ? transferSubs
        : Object.entries(gData.sub)
            .map(([sName, sData]) => {
              const visibleItems = sData.items.filter((t) => selected.has(t.Account));
              if (visibleItems.length === 0) return null;
              return {
                name: sName,
                totalsByMonth: totalsForItems(visibleItems, calcMonths),
                avg: monthlyAvg(sData.totals, calcMonths),
                expected: skipExpected
                  ? 0
                  : computeExpectedValue(
                      sData.items,
                      calcMonths,
                      transferIds,
                      gName.includes('Income') ? 'income' : 'expense',
                    ),
                items: visibleItems,
                isException: isExceptionGroup,
                skipExpected,
              };
            })
            .filter(Boolean);
    if (sub.length === 0 && gName !== 'Transfers' && !hasMonthTotals(gData.totals)) return null;
    return {
      name: gName,
      totalsByMonth: gData.totals,
      avg: monthlyAvg(gData.totals, calcMonths),
      expected: skipExpected
        ? 0
        : computeCurrentMinusAvg(
            gData.totals,
            calcMonths,
            gName.includes('Income') ? 'income' : 'expense',
          ),
      sub,
      isException: isExceptionGroup,
      isTransfer: gName === 'Transfers',
    };
  }).filter(Boolean);

  const calcNetByMonth = calcMonths.map(
    (m) => (totalsByMonth.Income[m] || 0) + (totalsByMonth.Expense[m] || 0),
  );
  const netByMonth = months.map(
    (m) => (totalsByMonth.Income[m] || 0) + (totalsByMonth.Expense[m] || 0),
  );
  const incomeAvg = monthlyAvg(groups.Income.totals, calcMonths);
  const expenseAvg = monthlyAvg(groups.Expense.totals, calcMonths);
  const netAvg = incomeAvg + expenseAvg;
  const currentMonthIncome = totalsByMonth.Income[currentMonth] ?? 0;
  const currentMonthExpense = totalsByMonth.Expense[currentMonth] ?? 0;
  const incomeRemaining = computeCurrentMinusAvg(groups.Income.totals, calcMonths, 'income');
  const expenseRemaining = computeCurrentMinusAvg(groups.Expense.totals, calcMonths, 'expense');
  const netExpected = incomeRemaining + expenseRemaining;

  return {
    rows,
    months,
    calcMonths,
    totalsByMonth,
    currentMonth,
    netByMonth,
    calcNetByMonth,
    netAvg,
    incomeAvg,
    expenseAvg,
    currentMonthIncome,
    currentMonthExpense,
    incomeRemaining,
    expenseRemaining,
    netExpected,
    transferIds,
    reversalIds,
  };
}
