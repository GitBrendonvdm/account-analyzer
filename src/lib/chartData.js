import { enrichWithEffectivePayMonths, getPayMonth } from './effectivePayMonth';
import { buildExceptionClusters, resolveMainGroup } from './exceptions';
import { projectedMonthNet } from './expected';
import { detectTransferPairs } from './transfers';
import { formatMonthLabel } from '../utils/format';
import {
  endOfDay,
  endOfMonth,
  formatBucketLabel,
  isoWeekKey,
  monthKeyFromDate,
  parseMonthKey,
  parseTransactionDate,
  startOfDay,
  startOfMonth,
} from '../utils/date';

export function chartGranularity(monthCount) {
  if (monthCount <= 2) return 'day';
  if (monthCount <= 5) return 'week';
  return 'month';
}

function netTransactions(data, months) {
  const scopedData = enrichWithEffectivePayMonths(data, months);
  const { transferIds } = detectTransferPairs(data, months);
  const exceptionState = { ...buildExceptionClusters(scopedData, months, transferIds), transferIds };

  return scopedData
    .filter((t) => {
      if (!months.includes(getPayMonth(t))) return false;
      return resolveMainGroup(t, exceptionState) !== 'Transfers';
    })
    .map((t) => ({
      ...t,
      date: parseTransactionDate(t.Date) || parseTransactionDate(`${getPayMonth(t)}-01`),
    }))
    .filter((t) => t.date)
    .sort((a, b) => a.date - b.date);
}

function bucketKey(date, granularity) {
  if (granularity === 'month') return monthKeyFromDate(date);
  if (granularity === 'week') return isoWeekKey(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function bucketStartDate(key, granularity) {
  if (granularity === 'day') return startOfDay(parseTransactionDate(key));
  if (granularity === 'month') {
    const { year, monthIndex } = parseMonthKey(key);
    return startOfMonth(year, monthIndex);
  }
  const [year, weekPart] = key.split('-W');
  const week = Number(weekPart);
  const jan4 = new Date(Number(year), 0, 4);
  const day = jan4.getDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setDate(jan4.getDate() - day + 1 + (week - 1) * 7);
  return startOfDay(weekStart);
}

function bucketEndDate(key, granularity) {
  if (granularity === 'day') return endOfDay(parseTransactionDate(key));
  if (granularity === 'month') {
    const { year, monthIndex } = parseMonthKey(key);
    return endOfMonth(year, monthIndex);
  }
  const weekStart = bucketStartDate(key, granularity);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return endOfDay(weekEnd);
}

function bucketTiming(key, granularity, today) {
  const bucketStart = bucketStartDate(key, granularity);
  const bucketEnd = bucketEndDate(key, granularity);
  const todayStart = startOfDay(today);
  const isFuture = bucketStart > todayStart;
  const containsToday = bucketStart <= todayStart && bucketEnd >= endOfDay(today);
  return { bucketStart, bucketEnd, isFuture, containsToday };
}

/**
 * Running total aligned with the table: full net for each completed pay-month,
 * plus partial net in the active month through cutoff.
 */
function runningAtDate(transactions, months, netByMonth, cutoff) {
  if (!cutoff) return null;
  const cutoffMonth = monthKeyFromDate(cutoff);
  let total = 0;

  months.forEach((m, i) => {
    if (m < cutoffMonth) {
      total += netByMonth[i];
    } else if (m === cutoffMonth) {
      transactions.forEach((t) => {
        if (getPayMonth(t) === m && t.date <= cutoff) total += t.AmountNum;
      });
    }
  });
  return total;
}

function priorMonthsRunning(months, netByMonth, currentMonth) {
  return months.reduce((sum, m, i) => (m === currentMonth ? sum : sum + netByMonth[i]), 0);
}

function generateBucketKeys(rangeStart, rangeEnd, granularity) {
  const keys = [];
  const cursor = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);

  while (cursor <= end) {
    const key = bucketKey(cursor, granularity);
    if (!keys.includes(key)) keys.push(key);
    if (granularity === 'day') cursor.setDate(cursor.getDate() + 1);
    else if (granularity === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}


function projectExpected(todayRunning, monthEndRunning, bucketEnd, todayEnd, monthEnd) {
  if (bucketEnd <= todayEnd) return todayRunning;
  const remaining = monthEnd - todayEnd;
  if (remaining <= 0) return monthEndRunning;
  return todayRunning + (monthEndRunning - todayRunning) * ((bucketEnd - todayEnd) / remaining);
}

function applyExpectedLines(point, ctx) {
  if (!point.inCurrentMonth) return;

  const { todayCumulative, monthEndExpectedCumulative, todayEnd, monthEnd } = ctx;

  if (!point.isFuture) {
    point.expectedSolid = point.isToday || point.containsToday ? todayCumulative : point.actual;
  }

  if (point.isFuture || point.isMonthEndProjection || point.isToday || point.containsToday) {
    point.expectedProjected = projectExpected(
      todayCumulative,
      monthEndExpectedCumulative,
      point.bucketEnd,
      todayEnd,
      monthEnd,
    );
  }

  if (point.isToday || point.containsToday) {
    point.expectedProjected = todayCumulative;
  }
}

function insertTodayJunction(points, ctx) {
  if (points.some((p) => p.isToday || p.containsToday)) return points;

  const { todayEnd, todayCumulative, currentMonth, granularity, expectedCtx } = ctx;
  const firstFutureIdx = points.findIndex((p) => p.isFuture && p.inCurrentMonth);
  if (firstFutureIdx < 0) return points;

  const todayPoint = {
    key: `today-${bucketKey(startOfDay(todayEnd), granularity)}`,
    label: 'Today',
    bucketEnd: todayEnd,
    actual: todayCumulative,
    expectedSolid: null,
    expectedProjected: null,
    isToday: true,
    isFuture: false,
    containsToday: true,
    inCurrentMonth: monthKeyFromDate(todayEnd) === currentMonth,
    isMonthEndProjection: false,
  };
  applyExpectedLines(todayPoint, expectedCtx);

  return [...points.slice(0, firstFutureIdx), todayPoint, ...points.slice(firstFutureIdx)];
}

export function buildNetTotalChartData(data, selectedAccounts, processed) {
  if (!data || !processed) return null;

  const {
    months,
    calcMonths = months,
    netByMonth,
    calcNetByMonth = netByMonth,
    netAvg,
    netExpected,
    incomeAvg,
    expenseAvg,
    currentMonthIncome,
    currentMonthExpense,
    incomeRemaining,
    expenseRemaining,
    currentMonth,
    currentCycleEnd,
  } = processed;
  const granularity = chartGranularity(months.length);
  const transactions = netTransactions(data, calcMonths);
  const today = new Date();
  const todayEnd = endOfDay(today);

  const { year: startYear, monthIndex: startMonthIndex } = parseMonthKey(months[0]);
  const { year: endYear, monthIndex: endMonthIndex } = parseMonthKey(currentMonth);
  const rangeStart = startOfMonth(startYear, startMonthIndex);
  // Projection horizon = the next pay boundary (end of the current pay-cycle). The prediction
  // must run to the next payday, not stop at today; the calendar month-end is ~3 weeks too far.
  const monthEnd = currentCycleEnd ? new Date(currentCycleEnd) : endOfMonth(endYear, endMonthIndex);
  const priorRunning = priorMonthsRunning(calcMonths, calcNetByMonth, currentMonth);
  const todayRunning = runningAtDate(transactions, calcMonths, calcNetByMonth, todayEnd);
  const tableMonthNet = currentMonthIncome + currentMonthExpense;
  const projectedNet = projectedMonthNet(
    currentMonthIncome,
    incomeAvg,
    currentMonthExpense,
    expenseAvg,
  );
  const signedRemaining = incomeRemaining + expenseRemaining;
  const currentMonthProjected = tableMonthNet + signedRemaining;
  const monthEndProjectedRunning = priorRunning + currentMonthProjected;

  const expectedCtx = {
    todayCumulative: todayRunning,
    monthEndExpectedCumulative: monthEndProjectedRunning,
    todayEnd,
    monthEnd,
  };

  const bucketKeys = generateBucketKeys(rangeStart, monthEnd, granularity);
  let points = [];

  bucketKeys.forEach((key) => {
    const { bucketEnd, isFuture, containsToday } = bucketTiming(key, granularity, today);
    const inCurrentMonth = monthKeyFromDate(bucketEnd) === currentMonth;
    const cutoff = isFuture ? null : containsToday ? todayEnd : bucketEnd;

    if (granularity === 'month' && inCurrentMonth && key === currentMonth) {
      const todayPoint = {
        key: `${key}-today`,
        label: 'Today',
        bucketEnd: todayEnd,
        actual: todayRunning,
        expectedSolid: null,
        expectedProjected: null,
        isToday: true,
        isFuture: false,
        containsToday: true,
        inCurrentMonth: true,
        isMonthEndProjection: false,
      };
      applyExpectedLines(todayPoint, expectedCtx);
      points.push(todayPoint);

      const endPoint = {
        key: `${key}-end`,
        label: 'Next pay',
        bucketEnd: monthEnd,
        actual: null,
        expectedSolid: null,
        expectedProjected: null,
        isToday: false,
        isFuture: true,
        containsToday: false,
        inCurrentMonth: true,
        isMonthEndProjection: true,
      };
      applyExpectedLines(endPoint, expectedCtx);
      points.push(endPoint);
      return;
    }

    const point = {
      key,
      label: formatBucketLabel(key, granularity),
      bucketEnd,
      actual: runningAtDate(transactions, calcMonths, calcNetByMonth, cutoff),
      expectedSolid: null,
      expectedProjected: null,
      isToday: false,
      isFuture,
      containsToday,
      inCurrentMonth,
      isMonthEndProjection: false,
    };
    applyExpectedLines(point, expectedCtx);
    points.push(point);
  });

  if (granularity !== 'month') {
    points = insertTodayJunction(points, {
      todayEnd,
      todayCumulative: todayRunning,
      currentMonth,
      granularity,
      expectedCtx,
    });
  }

  // Guarantee the projection reaches the next-pay horizon. Weekly/daily bucket stepping stops at
  // the last whole bucket *before* the horizon, cutting the forecast off days short of next pay.
  const horizonTime = monthEnd.getTime();
  const reachesHorizon = points.some((p) => p.bucketEnd && p.bucketEnd.getTime() >= horizonTime);
  if (!reachesHorizon) {
    const endPoint = {
      key: 'next-pay',
      label: 'Next pay',
      bucketEnd: monthEnd,
      actual: null,
      expectedSolid: null,
      expectedProjected: null,
      isToday: false,
      isFuture: true,
      containsToday: false,
      inCurrentMonth: true,
      isMonthEndProjection: true,
    };
    applyExpectedLines(endPoint, expectedCtx);
    points.push(endPoint);
  }

  return {
    granularity,
    points,
    netAvg,
    netExpected,
    currentMonth,
    priorRunning,
    tableMonthNet,
    projectedNet,
    incomeRemaining,
    expenseRemaining,
    signedRemaining,
    currentMonthProjected,
    monthEndProjectedRunning,
    todayRunning,
  };
}

/** Per-period net (not cumulative) — one bar per pay month, current month includes remaining. */
export function buildPeriodNetChartData(processed) {
  if (!processed) return null;

  const { months, netByMonth, netAvg, netExpected, currentMonth } = processed;

  const points = months.map((m, i) => {
    const actual = netByMonth[i] ?? 0;
    const isCurrentMonth = m === currentMonth;
    const remaining = isCurrentMonth ? netExpected : 0;
    return {
      label: formatMonthLabel(m, currentMonth),
      actual,
      remaining,
      display: isCurrentMonth ? actual + remaining : actual,
      isCurrentMonth,
    };
  });

  return { points, netAvg, currentMonth };
}
