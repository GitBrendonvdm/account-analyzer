/**
 * Does the inferred ledger predict the bank's own interest postings?
 *
 * For each loan and each of its last twelve postings, take the anchored balance after the
 * previous posting, the rate as the median of the three postings before it (no look-ahead), the
 * actual day count, and predict I = B × rate × days/365. The gap between that and what the bank
 * posted is the honest error of everything inferRates rests on — the anchoring, the day count,
 * the posting grouping — and the gate is a median absolute error of 3% (5% for the vehicle loan,
 * whose balance is a regression rather than a ledger).
 *
 * Prints aggregates only: no amounts, descriptions or account names.
 *
 * Run with:  npx vite-node scripts/backtest-debt.mjs
 * Requires a real export in the gitignored test-data/ directory.
 */
import { buildAccountRecord } from '../src/db/accountIdentity.js';
import { buildFullTransfers } from '../src/lib/flows.js';
import { buildLiabilityTerms } from '../src/lib/inferRates.js';
import { median } from '../src/lib/stats.js';
import { parseTransactionDate } from '../src/utils/date.js';
import { loadRealExport } from '../src/test/realData.js';

const LOOKBACK = 12;
const RATE_WINDOW = 3;
const GATE = { default: 0.03, vehicle: 0.05 };

const data = loadRealExport();
if (!data) {
  console.error('No CSV found in test-data/ — nothing to backtest.');
  process.exit(1);
}
data.forEach((t) => {
  t.DateObj = parseTransactionDate(t.Date);
});

const accounts = [...new Set(data.map((t) => t.Account))].map((name) => buildAccountRecord([name]));
const transfers = buildFullTransfers(data, { accounts });
const terms = buildLiabilityTerms(data, accounts, { asOf: new Date(), transfers });
const loans = terms.filter((t) => t.type === 'Loan' && t.rateHistory.length > RATE_WINDOW + 1);

if (!loans.length) {
  console.error('No loan with enough postings to score.');
  process.exit(1);
}

console.log(`Backtesting ${loans.length} loans over their last ${LOOKBACK} postings each.\n`);
console.log('loan  kind      source      postings  median |err|  max |err|  gate   result');

let failed = false;
loans.forEach((t, i) => {
  const history = t.rateHistory;
  const errors = [];
  const first = Math.max(RATE_WINDOW, history.length - LOOKBACK);
  for (let k = first; k < history.length; k += 1) {
    const rate = median(history.slice(k - RATE_WINDOW, k).map((h) => h.rate));
    const predicted = (history[k].balanceAfterPrevious * rate * history[k].days) / 365;
    errors.push(Math.abs(predicted - history[k].interest) / history[k].interest);
  }
  const med = median(errors);
  const max = Math.max(...errors);
  const gate = GATE[t.kind] ?? GATE.default;
  const ok = med <= gate;
  if (!ok) failed = true;
  console.log(
    `${String(i + 1).padEnd(5)} ${t.kind.padEnd(9)} ${t.balanceSource.padEnd(11)} ${String(errors.length).padEnd(9)} ${(med * 100).toFixed(2).padStart(7)}%     ${(max * 100).toFixed(2).padStart(6)}%    ${(gate * 100).toFixed(0)}%     ${ok ? 'pass' : 'FAIL'}`,
  );
});

console.log(failed ? '\nGate failed.' : '\nAll loans within the gate.');
process.exit(failed ? 1 : 0);
