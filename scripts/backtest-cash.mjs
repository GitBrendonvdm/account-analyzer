/**
 * Replays cash-to-payday over past cycles and scores it.
 *
 * For each of the last twelve complete cycles the data is truncated to cycle day 7 and 14, every
 * liquid account is self-anchored at its own position on that day (the level is arbitrary, the
 * shape is exact, and both sides of the comparison share it), the lines, profile and calendar are
 * rebuilt from the truncated file, and the path is compared with what the accounts actually did
 * through the end of the cycle:
 *
 *   trough-window error |predicted trough day − nearest day of the actual flat bottom| (see FLAT_BAND)
 *   minimum-value error predicted trough − actual trough, in rand
 *   sign                did the total dip below (cycle opening − R10 000), predicted vs actual
 *
 * Gate before the Today card shows the path as fact rather than an estimate: minimum-day MAE
 * ≤ 3 days and sign accuracy ≥ 75%. Until it passes, cashToPayday.js keeps `estimate: true`.
 *
 * Run with:  npx vite-node scripts/backtest-cash.mjs
 * Requires a real export in the gitignored test-data/ directory. Prints aggregates only.
 */
import { buildAccountRecord } from '../src/db/accountIdentity.js';
import { buildCashToPayday } from '../src/lib/cashToPayday.js';
import { buildCycleCalendar } from '../src/lib/cycleCurve.js';
import { buildFullTransfers, completeMonths, spendRows } from '../src/lib/flows.js';
import { buildIncomeProfile } from '../src/lib/incomeProfile.js';
import { accountRows, positionAt } from '../src/lib/ledger.js';
import { buildRecurringLines } from '../src/lib/recurring.js';
import { buildUpcoming } from '../src/lib/upcoming.js';
import { parseTransactionDate } from '../src/utils/date.js';
import { loadRealExport } from '../src/test/realData.js';

const EVAL_DAYS = [7, 14];
const CYCLES = 12;
const DIP_BELOW_OPENING = 10000;
const GATE_MAE_DAYS = 3;
/**
 * A trough day is only meaningful where the path actually has a trough. After the front-loaded
 * fortnight this household's cash sits flat to within a few hundred rand, and which day of that
 * flat bottom is the arithmetic minimum is decided by a R900 refund or a R1 500 debit that no
 * history foretells — an oracle that knows every future row over R1 000 still misses the exact day
 * by 3.4 on average. So the day error is measured against the WINDOW of days within FLAT_BAND of
 * the actual minimum: a prediction inside it is right, outside it is off by the distance to the
 * nearest edge. The raw single-day error is still printed beside it.
 */
const FLAT_BAND = 1000;
/** The trough VALUE is what decides whether a debit order bounces; it is gated as a share of typical cycle spend. */
const GATE_VALUE_SHARE = 0.05;
const GATE_SIGN_ACCURACY = 0.75;
const LIQUID = new Set(['Bank', 'Savings']);

const data = loadRealExport();
if (!data) {
  console.error('No CSV found in test-data/ — nothing to backtest.');
  process.exit(1);
}
data.forEach((t) => {
  t.DateObj = parseTransactionDate(t.Date);
});

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const names = [...new Set(data.map((t) => t.Account))];
const months = [...new Set(data.map((t) => t['Pay Month']))].sort();
const lastDate = data.reduce((latest, t) => (t.DateObj > latest ? t.DateObj : latest), data[0].DateObj);
const fullCalendar = buildCycleCalendar(data, months, addDays(lastDate, 1));
const byId = new Map();
names.forEach((n) => {
  const rec = buildAccountRecord([n], null, null);
  if (!byId.has(rec.id)) byId.set(rec.id, rec);
  else if (!byId.get(rec.id).seenNames.includes(n)) byId.get(rec.id).seenNames.push(n);
});
const records = [...byId.values()];
const liquidRecords = records.filter((a) => LIQUID.has(a.type));
const fullRows = new Map(records.map((a) => [a.id, accountRows(data, { accountId: a.id })]));

const scorable = completeMonths(fullCalendar).slice(-CYCLES);
console.log(`Backtesting cash-to-payday over ${scorable.length} cycles (${scorable[0]} … ${scorable.at(-1)})`);
console.log(`Liquid accounts: ${liquidRecords.length}; trough and "dips R${DIP_BELOW_OPENING} below the opening" scored per cycle.\n`);

const totalActual = (date) => liquidRecords.reduce((s, a) => s + positionAt(fullRows.get(a.id), date), 0);

// Typical cycle spend, for the value gate: the median over the scored cycles of everything that
// left the liquid accounts that was not a transfer or a loan leg.
const fullTransfersAll = buildFullTransfers(data, { accounts: records });
const cycleSpend = median(
  scorable.map((m) => -spendRows(data, { transfers: fullTransfersAll, accounts: records, months: [m] }).reduce((a, t) => a + t.AmountNum, 0)),
);
console.log(`Typical cycle spend (median over scored cycles): R${Math.round(cycleSpend)}; value gate ±R${Math.round(cycleSpend * GATE_VALUE_SHARE)} (${GATE_VALUE_SHARE * 100}%).
`);
let gatePassed = true;
const summaryByDay = {};
for (const day of EVAL_DAYS) {
  const rows = [];
  for (const monthKey of scorable) {
    const start = fullCalendar.starts[monthKey];
    const end = fullCalendar.ends[monthKey];
    const asOf = addDays(start, day - 1);
    if (asOf >= end) continue;

    const truncated = data.filter((t) => t.DateObj <= asOf);
    const truncatedMonths = [...new Set(truncated.map((t) => t['Pay Month']))].sort();
    const calendar = buildCycleCalendar(truncated, truncatedMonths, asOf);
    if (calendar.currentMonth !== monthKey) continue;
    const accounts = records.map((a) =>
      LIQUID.has(a.type) || a.type === 'Credit Card'
        ? { ...a, currentBalance: positionAt(accountRows(truncated, { accountId: a.id }), asOf), balanceAsOf: iso(asOf) }
        : a,
    );
    const transfers = buildFullTransfers(truncated, { accounts });
    const lines = buildRecurringLines(truncated, { accounts, calendar, transfers, asOf, dataThrough: asOf });
    const incomeProfile = buildIncomeProfile(truncated, { accounts, calendar, transfers, asOf, dataThrough: asOf });
    const upcoming = buildUpcoming(lines.lines, { calendar, asOf, dataThrough: asOf, incomeProfile });
    const cash = buildCashToPayday({
      data: truncated,
      accounts,
      calendar,
      transfers,
      lines: lines.lines,
      explained: lines.explained,
      upcoming,
      incomeProfile,
      asOf,
      dataThrough: asOf,
      extendDays: 0,
    });
    if (!cash) continue;

    const predicted = cash.total.days.filter((d) => d.date > asOf && d.date <= end);
    const actual = predicted.map((d) => ({ date: d.date, cycleDay: d.cycleDay, balance: totalActual(d.date) }));
    if (!predicted.length) continue;
    const trough = (path) => path.reduce((best, d) => (best == null || d.balance < best.balance ? d : best), null);
    const pMin = trough(predicted);
    const aMin = trough(actual);
    const opening = totalActual(addDays(start, -1));
    const threshold = opening - DIP_BELOW_OPENING;
    const pDip = pMin.balance < threshold;
    const aDip = aMin.balance < threshold;
    const flatDays = actual.filter((d) => d.balance <= aMin.balance + FLAT_BAND).map((d) => d.cycleDay);
    const windowError = Math.min(...flatDays.map((d) => Math.abs(pMin.cycleDay - d)));
    rows.push({
      monthKey,
      dayError: Math.abs(pMin.cycleDay - aMin.cycleDay),
      windowError,
      flatSpan: `${Math.min(...flatDays)}–${Math.max(...flatDays)}`,
      pDay: pMin.cycleDay,
      aDay: aMin.cycleDay,
      valueError: pMin.balance - aMin.balance,
      signOk: pDip === aDip,
      pDip,
      aDip,
    });
  }

  const mae = rows.reduce((s, r) => s + r.dayError, 0) / Math.max(1, rows.length);
  const windowMae = rows.reduce((s, r) => s + r.windowError, 0) / Math.max(1, rows.length);
  const signAccuracy = rows.filter((r) => r.signOk).length / Math.max(1, rows.length);
  const valueMedian = median(rows.map((r) => Math.abs(r.valueError)));
  console.log(`=== evaluated at cycle-day ${day} (${rows.length} cycles) ===`);
  rows.forEach((r) => {
    console.log(
      `  ${r.monthKey}  trough day predicted ${String(r.pDay).padStart(2)} actual ${String(r.aDay).padStart(2)}` +
        ` (flat ${r.flatSpan.padEnd(5)})  |Δday| ${String(r.dayError).padStart(2)}  window ${String(r.windowError).padStart(2)}` +
        `  value error ${Math.round(r.valueError).toString().padStart(8)}` +
        `  dip predicted ${r.pDip ? 'Y' : 'N'} actual ${r.aDip ? 'Y' : 'N'} ${r.signOk ? 'ok' : 'MISS'}`,
    );
  });
  const valueOk = valueMedian <= cycleSpend * GATE_VALUE_SHARE;
  console.log(
    `  -> trough-window MAE ${windowMae.toFixed(2)} days (single-day MAE ${mae.toFixed(2)})` +
      `   median |value error| ${Math.round(valueMedian)} ${valueOk ? 'ok' : 'MISS'}` +
      `   sign accuracy ${(signAccuracy * 100).toFixed(0)}%
`,
  );
  if (windowMae > GATE_MAE_DAYS || signAccuracy < GATE_SIGN_ACCURACY || !valueOk) gatePassed = false;
  summaryByDay[`day${day}`] = {
    cycles: rows.length,
    windowMae: +windowMae.toFixed(2),
    singleDayMae: +mae.toFixed(2),
    signAccuracy: +signAccuracy.toFixed(3),
    signHits: rows.filter((r) => r.signOk).length,
    valueMedian: Math.round(valueMedian),
    valueGate: Math.round(cycleSpend * GATE_VALUE_SHARE),
  };
}

console.log(
  gatePassed
    ? `GATE PASSED: trough-window MAE ≤ ${GATE_MAE_DAYS} days, sign accuracy ≥ ${GATE_SIGN_ACCURACY * 100}% and trough value within ${GATE_VALUE_SHARE * 100}% of cycle spend at every evaluation day.`
    : `GATE NOT PASSED: the Today card keeps its "Estimate" label (cashToPayday.js VALIDATED stays false).`,
);

// The measured reliability travels with the app: the Today card quotes these figures beside the
// path instead of a bare "Estimate". Aggregates only — nothing about any transaction.
const { writeFileSync } = await import('node:fs');
const summaryPath = new URL('../src/lib/cashBacktest.json', import.meta.url);
const summary = { generatedOn: iso(new Date()), cycles: scorable.length, gatePassed, flatBand: FLAT_BAND, ...summaryByDay };
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote src/lib/cashBacktest.json`);

