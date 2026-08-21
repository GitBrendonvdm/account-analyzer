/**
 * Safe to spend today.
 *
 * The one number people actually use, and the one the app never showed. "Still to spend" answers
 * what the forecast EXPECTS you to spend; this answers what you can spend without breaking the
 * cycle — a different question, and the useful one.
 *
 *   safe = income still expected
 *        + what's already come in
 *        − what's already gone out
 *        − what's committed between now and payday
 *
 * "Committed" is deliberately narrow: bills, instalments and other discrete payments that are
 * going to happen whether or not you change your behaviour. Groceries are forecast, not committed —
 * you can spend less on them, which is the whole point of the number.
 *
 * A cash buffer can be held back so the figure doesn't run the cycle to exactly zero.
 */

import { flattenCategories } from './categoryRows';

/** Categories whose spend is a decision rather than an obligation. */
function isDiscretionary(row) {
  // Discrete cadence is the pipeline's own test for "a bill lands, it isn't a stream of purchases".
  // Anything it treats as a stream is discretionary here.
  return !row.discrete;
}

export function deriveSafeToSpend(processed, summary, { buffer = 0 } = {}) {
  if (!processed || !summary) return null;

  const categories = flattenCategories(processed);

  // Committed = the remaining forecast for the parts of each category that behave like bills.
  const committed = categories.reduce((s, c) => s + (c.committed ?? 0), 0);
  const discretionaryForecast = categories.reduce(
    (s, c) => s + Math.max(0, Math.abs(c.expected ?? 0) - (c.committed ?? 0)),
    0,
  );

  const incomeStillExpected = Math.abs(summary.income.remaining ?? 0);
  const cycleNetSoFar = (summary.income.received ?? 0) - (summary.expense.spent ?? 0);

  const available = cycleNetSoFar + incomeStillExpected - committed - buffer;
  const daysLeft = Math.max(1, summary.daysToPayday || 1);

  return {
    safe: available,
    perDay: available / daysLeft,
    daysLeft,
    committed,
    discretionaryForecast,
    incomeStillExpected,
    cycleNetSoFar,
    buffer,
    // Spending at the forecast rate rather than the safe rate leaves you here.
    forecastGap: available - discretionaryForecast,
    bills: categories
      .filter((c) => (c.committed ?? 0) > 1)
      .map((c) => ({ name: c.name, amount: c.committed }))
      .sort((a, b) => b.amount - a.amount),
  };
}

export { isDiscretionary };
