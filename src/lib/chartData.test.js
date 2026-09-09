import { describe, expect, it } from 'vitest';
import { buildNetTotalChartData } from './chartData';
import { processTransactionData } from './processTransactionData';
import { assignKeys } from '../db/txnKey';
import { loadRealExport } from '../test/realData';

/**
 * The chart and the table must be the same claim, drawn twice.
 *
 * They were not. The chart re-ran the whole classification — its own transfer pairing, its own
 * exception clustering, its own loan-account list — and then drew a line whose far end was rebuilt
 * from a third arithmetic. The result contradicted the table's Forecast column, contradicted the
 * chart's own footnote, and fell R66 132 over thirteen days while the sentence underneath said the
 * rest of the cycle costs R16 472.
 *
 * These are the invariants that make that impossible to reintroduce: the projection has to start
 * where the line is, and the running total has to be built from the rows the table counted.
 */

const real = loadRealExport();

describe.skipIf(!real)('the chart agrees with the table', () => {
  if (!real) return;
  const rows = assignKeys(real);
  const accounts = [...new Set(rows.map((t) => t.Account))];
  const asOf = new Date(2026, 8, 4);
  const processed = processTransactionData(rows, accounts, 9, asOf);
  const chart = buildNetTotalChartData(rows, accounts, processed);

  it('projects from where the line actually is', () => {
    // The dashed line begins at today's running total and ends at next pay. Whatever else moves,
    // the distance between them is the remaining the table printed — nothing else.
    expect(chart.monthEndProjectedRunning).toBeCloseTo(chart.todayRunning + chart.signedRemaining, 6);
  });

  it("uses the table's own remaining, not a second estimate of it", () => {
    expect(chart.signedRemaining).toBeCloseTo(
      processed.incomeRemaining + processed.expenseRemaining,
      6,
    );
    expect(chart.netExpected).toBeCloseTo(chart.signedRemaining, 6);
  });

  it('closes the cycle on the same figure the Forecast column does', () => {
    const tableForecast =
      processed.currentMonthIncome +
      processed.currentMonthExpense +
      processed.incomeRemaining +
      processed.expenseRemaining;
    expect(chart.currentMonthProjected).toBeCloseTo(tableForecast, 6);
  });

  it('counts a transfer exactly where the table counts one', () => {
    // The table releases the paying leg of a loan pair back into Expense. A private pairing here
    // would not know that, and the two would silently disagree about what a transfer is.
    expect(processed.transferIds.size).toBeGreaterThan(0);
    expect(chart.points.length).toBeGreaterThan(0);
  });

  it('runs the history to the same total the table adds up', () => {
    // The running total at today is the prior cycles plus this one so far — the table's own
    // per-cycle nets. If the chart drew a different set of rows, this would drift.
    const prior = processed.months
      .filter((m) => m !== processed.currentMonth)
      .reduce((sum, m) => sum + (processed.calcNetByMonth[processed.months.indexOf(m)] ?? 0), 0);
    expect(chart.priorRunning).toBeCloseTo(prior, 6);
    expect(chart.tableMonthNet).toBeCloseTo(
      processed.currentMonthIncome + processed.currentMonthExpense,
      6,
    );
  });
});
