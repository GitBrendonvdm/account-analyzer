/**
 * The numbers behind the header — everything needed to answer "how much have I got left before
 * payday", which the app never actually stated.
 *
 * Pure derivation from `processed`, so the component holds no arithmetic and the figures can be
 * tested directly.
 *
 * One honesty constraint runs through this file: the export carries no account balance, so nothing
 * here may claim to know how much money you have. Every figure is about THIS CYCLE's flows —
 * hence "projected close" rather than "available", and "left to spend" rather than "balance".
 */

import { STALE_ALARM_DAYS, STALE_WARN_DAYS } from '../constants';

const DAY_MS = 86400000;

function wholeDaysBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

export function deriveCycleSummary(processed, asOf = new Date()) {
  if (!processed) return null;

  const {
    currentCycleStart,
    currentCycleEnd,
    nextPayDate,
    cycleLength = 0,
    cycleDay = 0,
    daysToPayday = 0,
    isProjectedCycleEnd = false,
    dataThrough,
    currentMonthIncome = 0,
    currentMonthExpense = 0,
    incomeRemaining = 0,
    expenseRemaining = 0,
    incomeAvg = 0,
    expenseAvg = 0,
    netExpected = 0,
    missedPayments = [],
    months = [],
  } = processed;

  const incomeProjected = currentMonthIncome + incomeRemaining;
  const expenseProjected = currentMonthExpense + expenseRemaining;
  const projectedClose = incomeProjected + expenseProjected;

  // Magnitudes for display — expense is stored negative.
  const spent = Math.abs(currentMonthExpense);
  const stillToSpend = Math.abs(expenseRemaining);
  const expectedSpend = Math.abs(expenseProjected);
  const typicalSpend = Math.abs(expenseAvg);

  const staleDays = dataThrough ? Math.max(0, wholeDaysBetween(dataThrough, asOf)) : 0;
  const staleLevel =
    staleDays >= STALE_ALARM_DAYS ? 'alarm' : staleDays >= STALE_WARN_DAYS ? 'warn' : 'fresh';

  // How the cycle is tracking: >1 means spending faster than a typical cycle by this point.
  // Uses share-of-cycle rather than share-of-days, because spend is heavily front-loaded.
  const expectedByNow = typicalSpend > 0 && expectedSpend > 0 ? typicalSpend * (spent / expectedSpend) : 0;
  const pace = expectedByNow > 0 ? spent / expectedByNow : null;

  return {
    start: currentCycleStart,
    end: currentCycleEnd,
    nextPayDate,
    cycleLength,
    cycleDay,
    daysToPayday,
    // Guard against a zero-length cycle before any data has loaded.
    progress: cycleLength > 0 ? Math.min(1, cycleDay / cycleLength) : 0,
    isProjectedEnd: isProjectedCycleEnd,

    dataThrough,
    staleDays,
    staleLevel,

    income: {
      received: currentMonthIncome,
      remaining: incomeRemaining,
      projected: incomeProjected,
      typical: incomeAvg,
    },
    expense: {
      spent,
      remaining: stillToSpend,
      projected: expectedSpend,
      typical: typicalSpend,
      pace,
    },
    projectedClose,
    netExpected,

    /**
     * What the remaining forecast works out to per day left. This is a burn rate, not an
     * allowance — there is no opening balance in the data to spend against.
     */
    forecastPerDay: daysToPayday > 0 ? stillToSpend / daysToPayday : stillToSpend,

    missedPayments,
    cycleCount: months.length,
  };
}
