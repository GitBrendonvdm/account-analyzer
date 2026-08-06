import { GROUP_ORDER } from '../constants';
import { enrichWithEffectivePayMonths, getPayMonth } from './effectivePayMonth';
import { buildExceptionClusters, resolveMainGroup } from './exceptions';
import { monthlyAvg } from './expected';
import { addDays, buildCycleCalendar, cycleDay } from './cycleCurve';
import {
  buildWeeklyAvg,
  buildWeekdayCurve,
  isDiscreteCadence,
  mondayOf,
  mondayWeekIndex,
  weekDayRanges,
  weeklyRemainingByWeek,
} from './weeklyEnvelope';
import { isMissedThisCycle } from './missedPayments';
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

export function processTransactionData(data, selectedAccounts, monthRange, asOf = new Date()) {
  if (!data || data.length === 0) return null;

  const selected = new Set(selectedAccounts);
  const allMonths = [...new Set(data.map((t) => t['Pay Month']))].sort();
  // One window, used for both display and every average. These used to differ — `calcMonths` was
  // the whole file — so dragging the month slider changed the columns but not the Avg or the
  // forecast, which is exactly the kind of control that makes a tool feel untrustworthy.
  const months = allMonths.slice(-monthRange);
  const calcMonths = months;
  const scopedData = enrichWithEffectivePayMonths(data, calcMonths);
  const currentMonth = calcMonths[calcMonths.length - 1];
  const groups = Object.fromEntries(GROUP_ORDER.map((name) => [name, { totals: {}, sub: {} }]));
  const totalsByMonth = { Income: {}, Expense: {} };
  calcMonths.forEach((m) => {
    totalsByMonth.Income[m] = 0;
    totalsByMonth.Expense[m] = 0;
  });

  // Classification runs on every account; only aggregation is filtered. A transfer pair spans two
  // accounts, so detecting pairs on a filtered set would orphan one leg and it would resurface as
  // phantom income or expense. Exception clustering is likewise kept stable across chip changes.
  const { transferIds, pairs, reversalIds } = detectTransferPairs(data, calcMonths);
  const exceptionState = { ...buildExceptionClusters(scopedData, calcMonths, transferIds), transferIds };
  scopedData.forEach((t) => {
    const mainGroup = resolveMainGroup(t, exceptionState);
    const m = mainGroup === 'Transfers' ? t['Pay Month'] : getPayMonth(t);
    if (!calcMonths.includes(m)) return;
    // Every total below is account-scoped. Previously only the sub-row month cells were filtered,
    // so group rows, the Net Total and every average silently ignored the account chips.
    if (!selected.has(t.Account)) return;

    if (mainGroup === 'Transfers') {
      groups.Transfers.totals[m] = (groups.Transfers.totals[m] || 0) + t.AmountNum;
      return;
    }

    const c = t.Category || 'Uncategorized';
    if (!groups[mainGroup].sub[c]) groups[mainGroup].sub[c] = { totals: {}, items: [] };
    groups[mainGroup].totals[m] = (groups[mainGroup].totals[m] || 0) + t.AmountNum;
    groups[mainGroup].sub[c].totals[m] = (groups[mainGroup].sub[c].totals[m] || 0) + t.AmountNum;
    groups[mainGroup].sub[c].items.push(t);

    // Income + Expense (exceptions folded into their base flow) drive the net-per-month totals.
    const flow = mainGroup.includes('Income') ? 'Income' : 'Expense';
    totalsByMonth[flow][m] = (totalsByMonth[flow][m] || 0) + t.AmountNum;
  });

  // Cycle-phase inputs: learn how far through the current pay-cycle we are, and the
  // historical spend curve for each flow, so "remaining" projects along the real curve.
  // Boundaries come from the export's own `Pay Month` bucketing (see cycleCurve.js) rather than a
  // hardcoded payday rule, so the weeks always tile the same period the transactions belong to.
  // Inference uses every month in the file, not just the visible window — the boundary is a
  // property of the export, and a wider sample makes the modal day-of-month more reliable.
  const calendar = buildCycleCalendar(data, allMonths, asOf);
  const starts = calendar.starts;
  // The first cycle in an export starts mid-stream, so its total is structurally too small to
  // average against the others.
  const excludeMonths = new Set(allMonths.filter((m) => calendar.isPartial[m]));
  const cycleLen = calendar.lengths[currentMonth] ?? 0;
  const currentCycleStart = starts[currentMonth] ?? null;
  // Inclusive last day of the cycle (22 Aug), not the next payday — `nextPayDate` is that.
  const currentCycleEnd = calendar.ends[currentMonth] ?? null;
  const nextPayDate = currentCycleEnd ? addDays(currentCycleEnd, 1) : null;
  const curDay = cycleDay(asOf, currentCycleStart, cycleLen);
  const priorMonths = calcMonths.slice(0, -1);
  // Each category's "remaining" is projected with the weekly-envelope model, split per Monday-week:
  // elapsed weeks are locked at their actuals (a quiet week stays quiet), the current week tops up
  // to its average, and future weeks carry their averages. Group/Net remaining = sums of these.
  // Weeks are Mon–Sun and only the current week through the cycle end are surfaced (no past weeks).
  const lastWeek =
    currentCycleStart && currentCycleEnd ? mondayWeekIndex(currentCycleEnd, currentCycleStart) : 0;
  const weekCount = Math.max(1, lastWeek + 1);
  const currentWeek = currentCycleStart
    ? Math.max(0, Math.min(lastWeek, mondayWeekIndex(asOf, currentCycleStart)))
    : 0;
  const cycleStartMonday = currentCycleStart ? mondayOf(currentCycleStart) : null;
  // Only the current week onward are shown as columns; past weeks are elapsed.
  const cycleWeeks = [];
  for (let w = currentWeek; w <= lastWeek; w++) {
    const monday = cycleStartMonday
      ? new Date(cycleStartMonday.getFullYear(), cycleStartMonday.getMonth(), cycleStartMonday.getDate() + w * 7)
      : null;
    cycleWeeks.push({
      index: w,
      label: monday ? monday.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : `W${w + 1}`,
      isCurrent: w === currentWeek,
    });
  }
  // The day-of-cycle span each Monday column covers. Prior cycles are bucketed against these
  // spans rather than by week index, because cycles hold 4-6 Monday-weeks depending on which
  // weekday the boundary lands on.
  const dayRanges = weekDayRanges(currentCycleStart, currentCycleEnd);
  const dataThrough = calendar.dataThrough;

  // One weekday shape per flow: how a typical week's spend is distributed Mon→Sun. Per-category
  // curves would be noise at ~25 observations, so income and expense each get one.
  const nonTransfer = scopedData.filter((t) => !transferIds.has(t.id));
  const weekdayCurves = {
    Income: buildWeekdayCurve(nonTransfer.filter((t) => t.AmountNum > 0), priorMonths),
    Expense: buildWeekdayCurve(nonTransfer.filter((t) => t.AmountNum < 0), priorMonths),
  };

  const zeroWeeks = () => new Array(weekCount).fill(0);
  const catWeeklyRemaining = (items, flow) => {
    const catItems = items.filter((t) => !transferIds.has(t.id));
    return weeklyRemainingByWeek(
      catItems,
      currentMonth,
      starts,
      currentWeek,
      buildWeeklyAvg(catItems, priorMonths, starts, dayRanges),
      {
        sign: flow === 'Income' ? 1 : -1,
        weekdayCurve: weekdayCurves[flow] ?? weekdayCurves.Expense,
        asOf,
        dataThrough,
        dayRanges,
        discrete: isDiscreteCadence(catItems, priorMonths),
      },
    );
  };

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
              // sData.items is already account-scoped — the filter happens once, at accumulation.
              if (sData.items.length === 0) return null;
              // Per-category weekly-envelope remaining, split by cycle-week; total is the sum.
              const weeklyRemaining = skipExpected
                ? zeroWeeks()
                : catWeeklyRemaining(sData.items, gName.includes('Income') ? 'Income' : 'Expense');
              return {
                name: sName,
                totalsByMonth: totalsForItems(sData.items, calcMonths),
                avg: monthlyAvg(sData.totals, calcMonths, { excludeMonths }),
                weeklyRemaining,
                expected: weeklyRemaining.reduce((s, x) => s + x, 0),
                items: sData.items,
                isException: isExceptionGroup,
                skipExpected,
                // Flag-only (no visual, no effect on the estimate): the payment usually lands by
                // now but hasn't this cycle. See missedPayments.js.
                missed: skipExpected
                  ? false
                  : isMissedThisCycle(sData.items, priorMonths, currentMonth, starts, curDay),
              };
            })
            .filter(Boolean);
    if (sub.length === 0 && gName !== 'Transfers' && !hasMonthTotals(gData.totals)) return null;
    // Group weekly remaining = element-wise sum of its sub-rows'.
    const groupWeekly = zeroWeeks();
    if (!skipExpected) {
      sub.forEach((s) => s.weeklyRemaining?.forEach((v, w) => (groupWeekly[w] += v)));
    }
    return {
      name: gName,
      totalsByMonth: gData.totals,
      avg: monthlyAvg(gData.totals, calcMonths, { excludeMonths }),
      weeklyRemaining: groupWeekly,
      expected: groupWeekly.reduce((s, x) => s + x, 0),
      sub,
      isException: isExceptionGroup,
      isTransfer: gName === 'Transfers',
    };
  }).filter(Boolean);

  // Flat list of missed payments (past their usual week, nothing landed this cycle). Not yet
  // surfaced in the UI — available for a future view.
  const missedPayments = rows.flatMap((g) =>
    (g.sub || []).filter((s) => s.missed).map((s) => ({ group: g.name, name: s.name })),
  );

  const calcNetByMonth = calcMonths.map(
    (m) => (totalsByMonth.Income[m] || 0) + (totalsByMonth.Expense[m] || 0),
  );
  const netByMonth = months.map(
    (m) => (totalsByMonth.Income[m] || 0) + (totalsByMonth.Expense[m] || 0),
  );
  const incomeAvg = monthlyAvg(groups.Income.totals, calcMonths, { excludeMonths });
  const expenseAvg = monthlyAvg(groups.Expense.totals, calcMonths, { excludeMonths });
  const netAvg = incomeAvg + expenseAvg;
  const currentMonthIncome = totalsByMonth.Income[currentMonth] ?? 0;
  const currentMonthExpense = totalsByMonth.Expense[currentMonth] ?? 0;

  // Income / Expense / Net remaining are the sums of their per-week envelope splits.
  const incomeRow = rows.find((r) => r.name === 'Income');
  const expenseRow = rows.find((r) => r.name === 'Expense');
  const incomeRemaining = incomeRow?.expected ?? 0;
  const expenseRemaining = expenseRow?.expected ?? 0;
  const netExpected = incomeRemaining + expenseRemaining;
  // Full-length (indexed by week index, since cycleWeeks only carries current→end).
  const netWeeklyRemaining = zeroWeeks().map(
    (_, w) => (incomeRow?.weeklyRemaining?.[w] ?? 0) + (expenseRow?.weeklyRemaining?.[w] ?? 0),
  );

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
    cycleWeeks,
    currentWeek,
    netWeeklyRemaining,
    currentCycleStart,
    currentCycleEnd,
    nextPayDate,
    cycleLength: cycleLen,
    cycleDay: curDay,
    daysToPayday: Math.max(0, cycleLen - curDay),
    isProjectedCycleEnd: calendar.isProjected[currentMonth] ?? false,
    dataThrough: calendar.dataThrough,
    missedPayments,
    transferIds,
    reversalIds,
  };
}
