/**
 * Replays the real pipeline over historical pay cycles and scores its forecast.
 *
 * For each complete cycle it truncates the data to a given cycle-day, runs
 * processTransactionData as if that were today, and compares the projected cycle expense against
 * what actually happened. This is the acceptance gate for the estimation changes — the numbers
 * quoted in the plan come from here, against the real code rather than a model of it.
 *
 * Run with:  npm run backtest
 * Requires a real export in the gitignored test-data/ directory.
 */
import { processTransactionData } from '../src/lib/processTransactionData.js';
import { buildCycleCalendar } from '../src/lib/cycleCurve.js';
import { parseTransactionDate } from '../src/utils/date.js';
import { loadRealExport } from '../src/test/realData.js';

const EVAL_DAYS = [7, 14, 20];
const MONTH_RANGE = 6;

const data = loadRealExport();
if (!data) {
  console.error('No CSV found in test-data/ — nothing to backtest.');
  process.exit(1);
}

data.forEach((t) => {
  t.DateObj = parseTransactionDate(t.Date);
});

const accounts = [...new Set(data.map((t) => t.Account))];
const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
const calendar = buildCycleCalendar(data, months, new Date());

/**
 * Transfer pairing is unstable under truncation: mid-cycle, a debit whose matching credit hasn't
 * landed yet is counted as expense, then reclassified once the pair completes. In 2026-01 that
 * inflated "spent so far" at day 14 to -245 349 against a true cycle total of -93 531 — a
 * classification artifact, not a forecast error. Score the forecast on rows that are transfers
 * under the FULL dataset, so the same transactions are excluded at every evaluation point.
 * (Commit 5 removes this instability from the app itself by trusting the CSV's Transfer label.)
 */
const fullTransferIds = processTransactionData(data, accounts, MONTH_RANGE, new Date()).transferIds;
const stable = data.filter((t) => !fullTransferIds.has(t.id));

/** Actual non-transfer expense for a completed cycle, as the pipeline itself would total it. */
function actualExpense(monthKey) {
  const asOf = new Date(calendar.ends[monthKey].getTime() + 86400000);
  const upTo = stable.filter((t) => t.DateObj <= asOf);
  const p = processTransactionData(upTo, accounts, MONTH_RANGE, asOf);
  return p?.totalsByMonth?.Expense?.[monthKey] ?? null;
}

function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const median = (xs) => percentile(xs, 0.5);

// Skip the leading partial cycle and the final in-progress one; keep cycles with enough history.
const scorable = months.slice(8, -1).filter((m) => !calendar.isPartial[m]);

console.log(`Backtesting ${scorable.length} cycles (${scorable[0]} … ${scorable.at(-1)})`);
console.log(`Month range ${MONTH_RANGE}, forecasting each cycle's total non-transfer expense.\n`);

for (const day of EVAL_DAYS) {
  const errors = [];
  const rows = [];
  for (const monthKey of scorable) {
    const start = calendar.starts[monthKey];
    const end = calendar.ends[monthKey];
    const asOf = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day - 1);
    if (asOf > end) continue;

    const upTo = stable.filter((t) => t.DateObj <= asOf);
    const p = processTransactionData(upTo, accounts, MONTH_RANGE, asOf);
    if (!p || p.currentMonth !== monthKey) continue;

    const projected = (p.totalsByMonth.Expense[monthKey] ?? 0) + p.expenseRemaining;
    const actual = actualExpense(monthKey);
    if (!actual) continue;

    const err = Math.abs(projected - actual) / Math.abs(actual) * 100;
    errors.push(err);
    rows.push({ monthKey, actual, projected, err });
  }

  errors.sort((a, b) => a - b);
  console.log(`=== evaluated at cycle-day ${day} (${errors.length} cycles) ===`);
  rows.forEach((r) => {
    console.log(
      `  ${r.monthKey}  actual ${Math.round(r.actual).toString().padStart(8)}` +
        `  projected ${Math.round(r.projected).toString().padStart(8)}` +
        `  err ${r.err.toFixed(1).padStart(6)}%`,
    );
  });
  console.log(
    `  -> median ${median(errors).toFixed(1)}%   p90 ${percentile(errors, 0.9).toFixed(1)}%` +
      `   worst ${errors.at(-1).toFixed(1)}%\n`,
  );
}
