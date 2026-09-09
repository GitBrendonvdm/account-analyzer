import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TransactionTable } from '../TransactionTable';
import { TableSpendingGroup } from './TableSpendingGroup';
import { TableSubcategory } from './TableSubcategory';
import { TransferPairSubcategory } from './TransferPairSubcategory';
import { VariantTransactionRow } from './VariantTransactionRow';
import { forecastOf } from './forecast';

/**
 * The ledger's column grid, and the one figure it used to leave out.
 *
 * A `<td>` miscount does not throw — it silently shunts every figure one column left for one kind
 * of row, which is the worst possible failure for a table of money. So the first test simply counts
 * cells: every row, at every depth, against the header. The rest cover the Forecast column, which
 * exists because a reader following the Expense row left to right hit "Typical" and read it as the
 * row's total.
 */

const MONTHS = ['2026-07', '2026-08', '2026-09'];
const WEEKS = [
  { index: 1, label: '14 Sept', isCurrent: true },
  { index: 2, label: '21 Sept', isCurrent: false },
];

const category = (name, soFar, weekly) => ({
  name,
  key: name,
  totalsByMonth: { '2026-07': -9000, '2026-08': -9500, '2026-09': soFar },
  avg: -9300,
  weeklyRemaining: weekly,
  expected: weekly.reduce((s, x) => s + x, 0),
  items: [],
  sub: [],
});

const groceries = category('Groceries', -4000, [-600, -400]);
const fuel = category('Fuel', -1600, [-300, -100]);

const expenseGroup = {
  name: 'Expense',
  totalsByMonth: { '2026-07': -18000, '2026-08': -19000, '2026-09': -5600 },
  avg: -18600,
  weeklyRemaining: [-900, -500],
  expected: -1400,
  sub: [groceries, fuel],
  isException: false,
  isTransfer: false,
};

const processed = {
  rows: [expenseGroup],
  months: MONTHS,
  currentMonth: '2026-09',
  netByMonth: [12000, 11000, 4400],
  netExpected: -1400,
  netAvg: 11500,
  netWeeklyRemaining: [-900, -500],
  cycleWeeks: WEEKS,
  currentCycleStart: new Date(2026, 8, 7),
  currentCycleEnd: new Date(2026, 8, 22),
  dataThrough: new Date(2026, 8, 17),
};

const render = (p = processed) =>
  renderToStaticMarkup(createElement(TransactionTable, { processed: p }))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\u202f]/g, ' ');

/** Cells per row, counting a colSpan as the columns it covers. */
function cellCounts(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, body]) => {
    const cells = [...body.matchAll(/<t[hd]\b([^>]*)>/g)];
    return cells.reduce((n, [, attrs]) => n + Number(/colspan="(\d+)"/i.exec(attrs)?.[1] ?? 1), 0);
  });
}

describe('the ledger table grid', () => {
  it('gives every row the same number of columns as the header', () => {
    const counts = cellCounts(render());
    // 1 pinned + 3 cycles + 2 weeks + left-to-payday + forecast + typical.
    expect(counts[0]).toBe(1 + MONTHS.length + WEEKS.length + 3);
    expect(new Set(counts).size).toBe(1);
  });

  it('gives the same count to the rows a group hides until it is opened', () => {
    // Groups render collapsed, so their children never reach the table's own markup. Render each
    // deeper row on its own instead — they are the ones a new column is easiest to forget.
    const COLUMNS = 1 + MONTHS.length + WEEKS.length + 3;
    const rowProps = { months: MONTHS, sort: { key: 'group', direction: 'asc' }, cycleWeeks: WEEKS };
    const deep = [
      [TableSubcategory, { sub: groceries, parentGroup: 'Expense', ...rowProps }],
      [TableSpendingGroup, { sub: { ...groceries, isSpendingGroup: true, sub: [] }, parentGroup: 'Expense', ...rowProps }],
      [
        TransferPairSubcategory,
        { sub: { ...groceries, isTransferPair: true, matches: [], totalsByMonth: groceries.totalsByMonth }, ...rowProps },
      ],
      [VariantTransactionRow, { variant: { description: 'Checkers', amountsByMonth: {} }, months: MONTHS, cycleWeeks: WEEKS }],
    ];
    for (const [Row, props] of deep) {
      const html = renderToStaticMarkup(
        createElement('table', null, createElement('tbody', null, createElement(Row, props))),
      );
      expect(cellCounts(html), Row.name).toEqual([COLUMNS]);
    }
  });
});

describe('the Forecast column', () => {
  it('closes the row: so far plus what is still expected', () => {
    expect(forecastOf(expenseGroup, MONTHS)).toBe(-7000);
    expect(forecastOf(groceries, MONTHS)).toBe(-5000);
    // No current cycle, no forecast — rather than a figure that means nothing.
    expect(forecastOf(expenseGroup, [])).toBeNull();
    expect(forecastOf({}, MONTHS)).toBe(0);
  });

  it('prints it, headed Forecast, and says what Typical is not', () => {
    const html = render();
    expect(html).toContain('Forecast');
    expect(html).toContain('R 7 000');
    // The complaint that prompted the column: Typical sat where a row total would, and is not one.
    expect(html).toContain('an average of completed cycles, not a total of this one');
    // And it is not the same number as Typical, which is the average of the completed cycles.
    expect(html).toContain('R 18 600');
  });

  it('sorts on it', () => {
    expect(render()).toContain('Sort by Forecast');
  });
});
