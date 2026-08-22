import { GROUP_ORDER } from '../constants';
import { parseAccount } from './accounts';
import { addMonthsToKey, enrichWithEffectivePayMonths, getPayMonth } from './effectivePayMonth';
import { buildExceptionClusters, resolveMainGroup } from './exceptions';
import { monthlyAvg } from './expected';
import { cycleBoundsOf } from './flows';
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
import { isMissedThisCycle, isRegularAmount } from './missedPayments';
import {
  compareSpendingGroups,
  hasSpendingGroups,
  spendingGroupOf,
  TRANSFER_SPENDING_GROUP,
  UNCLASSIFIED_SPENDING_GROUP,
} from './spendingGroups';
import { detectTransferPairs, isInternalMovementCategory } from './transfers';

function totalsForItems(items, months, useEffectiveMonth = true) {
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  items.forEach((t) => {
    const m = useEffectiveMonth ? getPayMonth(t) : t['Pay Month'];
    if (months.includes(m)) totals[m] = (totals[m] || 0) + t.AmountNum;
  });
  return totals;
}

/**
 * How much a pair moved in each month — gross volume, one side of the match.
 *
 * Netting the legs is meaningless here: both sides are the same money, so a matched pair is zero by
 * construction and a half-selected pair is whatever leg happened to survive the account filter.
 * Volume is the only figure that says something ("R5 000 went from the bank to savings") and it is
 * the same number no matter which account chips are on.
 */
function transferVolumeByMonth(matches, months) {
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  (matches ?? []).forEach((match) => {
    if (months.includes(match.month)) {
      totals[match.month] = (totals[match.month] || 0) + Math.abs(match.amount);
    }
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
      return {
        name: pair.isReversal
          ? `${pair.fromAccount} · Reversed`
          : `${pair.fromAccount} → ${pair.toAccount}`,
        // An account can have several reversals, so the display name isn't unique. React needs a
        // stable distinct key or it silently drops or duplicates rows.
        key: `pair-${pair.items[0]?.id ?? pair.fromAccount}-${pair.isReversal ? 'rev' : pair.toAccount}`,
        totalsByMonth: transferVolumeByMonth(pair.matches, months),
        avg: 0,
        expected: 0,
        items: pair.items.filter((t) => selected.has(t.Account)),
        matches: pair.matches,
        isTransferPair: true,
        isVolume: true,
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

/** Sentinel used when there is no spending-group level to build. */
const FLAT_LEVEL = '\u0000flat';

function skipsSpendingGroup(groupName) {
  return groupName === 'Transfers' || groupName.includes('Exceptions');
}

export function processTransactionData(data, selectedAccounts, monthRange, asOf = new Date()) {
  if (!data || data.length === 0) return null;

  const selected = new Set(selectedAccounts);
  const useSpendingGroups = hasSpendingGroups(data);
  const allMonths = [...new Set(data.map((t) => t['Pay Month']))].sort();
  // One window, used for both display and every average. These used to differ — `calcMonths` was
  // the whole file — so dragging the month slider changed the columns but not the Avg or the
  // forecast, which is exactly the kind of control that makes a tool feel untrustworthy.
  const months = allMonths.slice(-monthRange);
  const calcMonths = months;
  // A loan account records no spending of its own — only the instalment arriving and the interest,
  // service fee and insurance premium the lender charges against it. All of that is already inside
  // the instalment, so counting it as well would bill the same money twice (R21k/cycle on the bond
  // alone). The instalment leaving the bank is the one real cash movement, and it is charged below
  // as an expense; everything inside the loan account is dropped from the flows.
  const loanAccounts = new Set(
    [...new Set(data.map((t) => t.Account))].filter((a) => parseAccount(a).type === 'Loan'),
  );
  const scopedData = enrichWithEffectivePayMonths(data, calcMonths).filter(
    (t) => !loanAccounts.has(t.Account),
  );
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
  const { transferIds: pairedTransferIds, pairs, reversalIds } = detectTransferPairs(data, calcMonths);
  // Two signals, and they disagree both ways. Pair-matching finds internal movements the export
  // doesn't label (72 Debt rows — card and loan repayments). The export labels movements that never
  // paired, because the other leg is outside the window or the amounts don't match exactly — the
  // R30 561 credit-card repayment among them.
  //
  // Taking the plain union was too generous. Sixteen rows carried the label without a partner, and
  // only three of them were internal: the rest were groceries, a hosting invoice and a bet, each
  // with `Type = Expense` and a real category, quietly removed from spend. So an unpaired row keeps
  // the label only when its own category agrees that it is a movement — which still catches the
  // repayment cases the label was added for.
  const transferIds = new Set(pairedTransferIds);
  data.forEach((t) => {
    if (spendingGroupOf(t) === TRANSFER_SPENDING_GROUP && isInternalMovementCategory(t.Category)) {
      transferIds.add(t.id);
    }
  });

  // Paying a loan is not a transfer. Moving money to savings leaves it yours and paying a credit
  // card settles spending already counted where it happened, but a loan instalment is cash gone —
  // and treating it as internal meant switching the loan chips off removed the cost of the loans
  // from the table entirely, which is what made the totals move under the account filter. The
  // paying leg is released back into Expense; the loan-side leg is already out of `scopedData`.
  const touchesLoan = (pair) => loanAccounts.has(pair.toAccount) || loanAccounts.has(pair.fromAccount);
  const loanPairs = pairs.filter(touchesLoan);
  const transferPairs = pairs.filter((pair) => !touchesLoan(pair));
  // The paying legs, exposed so that anything counting debt service (vitals, direction) can find
  // them without re-running the pairing.
  const loanInstalmentIds = new Set();
  loanPairs.forEach((pair) =>
    pair.items.forEach((t) => {
      transferIds.delete(t.id);
      if (!loanAccounts.has(t.Account)) loanInstalmentIds.add(t.id);
    }),
  );
  const clusters = buildExceptionClusters(scopedData, calcMonths, transferIds);
  // Read by name, not spread: `descToCluster` is a lazy, display-only getter and spreading the
  // object would compute it for nothing.
  const exceptionState = {
    incomeSparseCategories: clusters.incomeSparseCategories,
    expenseSparseCategories: clusters.expenseSparseCategories,
    outlierTransactionIds: clusters.outlierTransactionIds,
    transferIds,
  };
  scopedData.forEach((t) => {
    const mainGroup = resolveMainGroup(t, exceptionState);
    const m = mainGroup === 'Transfers' ? t['Pay Month'] : getPayMonth(t);
    if (!calcMonths.includes(m)) return;
    // Every total below is account-scoped. Previously only the sub-row month cells were filtered,
    // so group rows, the Net Total and every average silently ignored the account chips.
    if (!selected.has(t.Account)) return;

    // Transfers carry no total at all. Both legs are the same money moving between the user's own
    // accounts, so the honest figure is zero — and summing the legs that survive the account filter
    // produced a large number that swung wildly (R-41 350 → R+19 896 on the same data) purely
    // because half of a pair had been switched off. Nothing downstream reads this total: the net
    // row is Income + Expense, and the pair rows below show gross volume.
    if (mainGroup === 'Transfers') return;

    const c = t.Category || 'Uncategorized';
    // Categories nest under the export's own Spending Group when the column is present. Transfers
    // and Exceptions stay flat — they're already homogeneous, so the level would add 11 rows with
    // one child each.
    const sg =
      useSpendingGroups && !skipsSpendingGroup(mainGroup) ? spendingGroupOf(t) : FLAT_LEVEL;
    const g = groups[mainGroup];
    // A row that reached a flow despite being labelled "Transfer" is one whose label we've already
    // rejected — nesting it under a "Transfer" heading inside Expense would only re-assert it.
    const level = sg === TRANSFER_SPENDING_GROUP ? UNCLASSIFIED_SPENDING_GROUP : sg;
    if (!g.sub[level]) g.sub[level] = { totals: {}, sub: {} };
    if (!g.sub[level].sub[c]) g.sub[level].sub[c] = { totals: {}, items: [] };
    g.totals[m] = (g.totals[m] || 0) + t.AmountNum;
    g.sub[level].totals[m] = (g.sub[level].totals[m] || 0) + t.AmountNum;
    g.sub[level].sub[c].totals[m] = (g.sub[level].sub[c].totals[m] || 0) + t.AmountNum;
    g.sub[level].sub[c].items.push(t);

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
  // How far into the cycle the DATA reaches. Anything that asks "has this landed yet?" must use
  // this rather than `curDay`: with a stale export the two diverge, and judging lateness by the
  // wall clock reports every un-exported payment as overdue.
  const observedDay = calendar.dataThrough
    ? Math.min(curDay, cycleDay(calendar.dataThrough, currentCycleStart, cycleLen))
    : curDay;
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

  // The cycle after this one, under the same boundary rule the calendar closes the current cycle
  // with. Its shape is what cash-to-payday needs for the week after payday and what the Debt view
  // calls "next cycle's shape"; the history behind it is the prior cycles, plus the current one
  // only once the data has reached its end — a half-seen cycle would drag every later column down.
  const nextBounds = currentMonth ? cycleBoundsOf(addMonthsToKey(currentMonth, 1), calendar) : null;
  const nextCycle = nextBounds
    ? {
        start: nextPayDate,
        end: nextBounds.end,
        length: Math.round((nextBounds.end - nextPayDate) / 86400000) + 1,
        dayRanges: weekDayRanges(nextPayDate, nextBounds.end),
      }
    : null;
  const nextCycleHistory =
    nextCycle && currentCycleEnd && dataThrough && dataThrough >= currentCycleEnd
      ? [...priorMonths, currentMonth]
      : priorMonths;

  // One bucketing for every model: the effective pay month, so the doubled salary the table moves
  // into the next cycle is averaged where its total lands.
  const monthOf = getPayMonth;

  // One weekday shape per flow: how a typical week's spend is distributed Mon→Sun. Per-category
  // curves would be noise at ~25 observations, so income and expense each get one.
  const nonTransfer = scopedData.filter((t) => !transferIds.has(t.id));
  const weekdayCurves = {
    Income: buildWeekdayCurve(nonTransfer.filter((t) => t.AmountNum > 0), priorMonths, { monthOf }),
    Expense: buildWeekdayCurve(nonTransfer.filter((t) => t.AmountNum < 0), priorMonths, { monthOf }),
  };

  const zeroWeeks = () => new Array(weekCount).fill(0);
  /**
   * Does this category behave like a bill? Discrete cadence (a payment lands, rather than a stream
   * of purchases) AND present in most cycles. "Safe to spend" subtracts these as committed, so the
   * test errs toward including: treating an occasional discrete category as committed understates
   * what's safe, which is the direction to be wrong in.
   */
  const looksLikeBill = (catItems, discrete) => {
    if (!discrete) return false;
    if (priorMonths.length === 0) return false;
    const totals = new Map();
    catItems.forEach((t) => {
      const m = monthOf(t);
      if (priorMonths.includes(m)) totals.set(m, (totals.get(m) ?? 0) + t.AmountNum);
    });
    if (totals.size / priorMonths.length < 0.6) return false;
    // Same test as overdue detection: a bill charges roughly the same amount every cycle. Without
    // it, "Home & Garden" (R1 381 one cycle, R4 083 the next) counted as committed spend and was
    // deducted from what's safe to spend.
    return isRegularAmount([...totals.values()]);
  };
  /** The envelope inputs for one category: its cadence verdict, weekly averages and remaining. */
  const catEnvelope = (items, flow) => {
    const catItems = items.filter((t) => !transferIds.has(t.id));
    const discrete = isDiscreteCadence(catItems, priorMonths, { monthOf });
    const weeklyAvg = buildWeeklyAvg(catItems, priorMonths, starts, dayRanges, { monthOf });
    const weeklyRemaining = weeklyRemainingByWeek(
      catItems,
      currentMonth,
      starts,
      currentWeek,
      weeklyAvg,
      {
        sign: flow === 'Income' ? 1 : -1,
        weekdayCurve: weekdayCurves[flow] ?? weekdayCurves.Expense,
        asOf,
        dataThrough,
        dayRanges,
        discrete,
        observedDay,
        monthOf,
      },
    );
    const nextCycleAvg = nextCycle
      ? buildWeeklyAvg(catItems, nextCycleHistory, starts, nextCycle.dayRanges, { monthOf }).reduce(
          (s, x) => s + x,
          0,
        )
      : 0;
    return { discrete, weeklyAvg, weeklyRemaining, nextCycleAvg };
  };

  const { sub: transferSubs, pairedIds } = buildTransferSubcategories(
    transferPairs,
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
      // Volume, like the pair rows: these are legs whose partner is outside the window, so the
      // signed sum is an artefact of which side happened to be exported, not a flow.
      totalsByMonth: transferVolumeByMonth(
        unmatched.map((t) => ({ month: t['Pay Month'], amount: t.AmountNum })),
        calcMonths,
      ),
      avg: 0,
      expected: 0,
      items: unmatched,
      isTransferPair: false,
      isUnmatchedTransfer: true,
      isVolume: true,
      skipExpected: true,
    });
  }
  const rows = GROUP_ORDER.map((gName) => {
    const gData = groups[gName];
    const isExceptionGroup = gName.includes('Exceptions');
    const skipExpected = isExceptionGroup || gName === 'Transfers';
    const flow = gName.includes('Income') ? 'Income' : 'Expense';

    /**
     * @param level the spending-group the category was filed under. It is part of the row's React
     *   key because the Exceptions groups flatten across spending groups, so the same category name
     *   can legitimately appear twice — "Home & Garden" under both Day-to-day and Recurring — and
     *   keying on the name alone silently dropped one of the two rows.
     */
    const buildCategory = ([sName, sData], _i, _all, level = FLAT_LEVEL) => {
      // sData.items is already account-scoped — the filter happens once, at accumulation.
      if (sData.items.length === 0) return null;
      // Per-category weekly-envelope remaining, split by cycle-week; total is the sum.
      const envelope = skipExpected
        ? { discrete: false, weeklyAvg: zeroWeeks(), weeklyRemaining: zeroWeeks(), nextCycleAvg: 0 }
        : catEnvelope(sData.items, flow);
      const nonTransferItems = sData.items.filter((t) => !transferIds.has(t.id));
      return {
        name: sName,
        key: `${gName}|${level}|${sName}`,
        spendingGroup: level === FLAT_LEVEL ? null : level,
        // Committed spend vs spend you choose — see safeToSpend.js.
        isBill: !skipExpected && flow === 'Expense' && looksLikeBill(nonTransferItems, envelope.discrete),
        // A payment lands, rather than a stream of purchases — the envelope's own verdict, exposed
        // so safeToSpend can tell committed from discretionary.
        discrete: envelope.discrete,
        totalsByMonth: totalsForItems(sData.items, calcMonths),
        avg: monthlyAvg(sData.totals, calcMonths, { excludeMonths }),
        weeklyAvg: envelope.weeklyAvg,
        weeklyRemaining: envelope.weeklyRemaining,
        expected: envelope.weeklyRemaining.reduce((s, x) => s + x, 0),
        nextCycleAvg: envelope.nextCycleAvg,
        items: sData.items,
        isException: isExceptionGroup,
        skipExpected,
        // Flag-only (no visual, no effect on the estimate): the payment usually lands by
        // now but hasn't this cycle. See missedPayments.js.
        missed: skipExpected
          ? false
          : isMissedThisCycle(sData.items, priorMonths, currentMonth, starts, observedDay, { monthOf }),
      };
    };

    /** A spending-group row is the sum of its categories — it runs no model of its own. */
    const buildSpendingGroup = ([sgName, sgData]) => {
      const categories = Object.entries(sgData.sub)
        .map((entry, i, all) => buildCategory(entry, i, all, sgName))
        .filter(Boolean);
      if (categories.length === 0) return null;
      const weekly = zeroWeeks();
      categories.forEach((c) => c.weeklyRemaining?.forEach((v, w) => (weekly[w] += v)));
      return {
        name: sgName,
        totalsByMonth: sgData.totals,
        avg: monthlyAvg(sgData.totals, calcMonths, { excludeMonths }),
        weeklyRemaining: weekly,
        expected: weekly.reduce((s, x) => s + x, 0),
        nextCycleAvg: categories.reduce((s, c) => s + (c.nextCycleAvg ?? 0), 0),
        sub: categories.sort((a, b) => a.name.localeCompare(b.name)),
        items: categories.flatMap((c) => c.items),
        isException: isExceptionGroup,
        isSpendingGroup: true,
        skipExpected,
      };
    };

    const entries = Object.entries(gData.sub);
    const nested = useSpendingGroups && !skipsSpendingGroup(gName);
    const sub =
      gName === 'Transfers'
        ? transferSubs
        : nested
          ? entries
              .map(buildSpendingGroup)
              .filter(Boolean)
              .sort((a, b) => compareSpendingGroups(a.name, b.name))
          : // No spending-group column (or a group that doesn't use the level): categories sit
            // directly under the flow, exactly as before.
            entries
              .flatMap(([sgName, sgData]) =>
                Object.entries(sgData.sub).map((entry, i, all) => buildCategory(entry, i, all, sgName)),
              )
              .filter(Boolean);
    if (sub.length === 0 && !hasMonthTotals(gData.totals)) return null;
    // Group weekly remaining = element-wise sum of its sub-rows'.
    const groupWeekly = zeroWeeks();
    if (!skipExpected) {
      sub.forEach((s) => s.weeklyRemaining?.forEach((v, w) => (groupWeekly[w] += v)));
    }
    const isTransferGroup = gName === 'Transfers';
    return {
      name: gName,
      // Transfers are net zero by definition — no arithmetic, and no dependence on the account
      // chips. The detail rows underneath still show what moved.
      totalsByMonth: isTransferGroup
        ? Object.fromEntries(calcMonths.map((m) => [m, 0]))
        : gData.totals,
      avg: isTransferGroup ? 0 : monthlyAvg(gData.totals, calcMonths, { excludeMonths }),
      weeklyRemaining: groupWeekly,
      expected: groupWeekly.reduce((s, x) => s + x, 0),
      nextCycleAvg: skipExpected ? 0 : sub.reduce((s, x) => s + (x.nextCycleAvg ?? 0), 0),
      sub,
      isException: isExceptionGroup,
      isTransfer: gName === 'Transfers',
    };
  }).filter(Boolean);

  // Payments past their usual week with nothing landed this cycle. Detected since the beginning
  // and never shown; CycleSummary surfaces them. Descends the spending-group level when present.
  const missedPayments = rows.flatMap((g) =>
    (g.sub ?? []).flatMap((s) => {
      const categories = s.isSpendingGroup ? (s.sub ?? []) : [s];
      return categories
        .filter((c) => c.missed)
        .map((c) => ({
          group: g.name,
          spendingGroup: s.isSpendingGroup ? s.name : c.spendingGroup,
          name: c.name,
          expected: c.avg,
        }));
    }),
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
  // What the cycle after this one is expected to do, from the regular flows alone.
  const nextCycleExpected = {
    income: incomeRow?.nextCycleAvg ?? 0,
    expense: expenseRow?.nextCycleAvg ?? 0,
    net: (incomeRow?.nextCycleAvg ?? 0) + (expenseRow?.nextCycleAvg ?? 0),
  };

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
    cycleStarts: starts,
    nextPayDate,
    cycleLength: cycleLen,
    cycleDay: curDay,
    daysToPayday: Math.max(0, cycleLen - curDay),
    isProjectedCycleEnd: calendar.isProjected[currentMonth] ?? false,
    dataThrough: calendar.dataThrough,
    calendar,
    cycleLengths: calendar.lengths,
    nextCycle,
    nextCycleExpected,
    missedPayments,
    transferIds,
    reversalIds,
    loanInstalmentIds,
  };
}
