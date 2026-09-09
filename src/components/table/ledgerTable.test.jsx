import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TransactionTable } from '../TransactionTable';
import { TableGroup } from './TableGroup';
import { TableSpendingGroup } from './TableSpendingGroup';
import { TableSubcategory } from './TableSubcategory';
import { TransferPairSubcategory } from './TransferPairSubcategory';
import { VariantTransactionRow } from './VariantTransactionRow';
import { GroupedTransactionRow } from './GroupedTransactionRow';
import { RowOverrideEditor } from './RowOverrideEditor';
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

const category = (name, soFar, weekly, remainder = null) => ({
  name,
  key: name,
  totalsByMonth: { '2026-07': -9000, '2026-08': -9500, '2026-09': soFar },
  avg: -9300,
  weeklyRemaining: weekly,
  expected: weekly.reduce((s, x) => s + x, 0),
  // What this row spent from this cycle day onward in each of six prior cycles — the band's
  // evidence. See lib/forecastBand.js.
  remainder,
  items: [],
  sub: [],
});

const groceries = category('Groceries', -4000, [-600, -400], [-900, -1400, -1000, -1100, -950, -1050]);
const fuel = category('Fuel', -1600, [-300, -100]);

const expenseGroup = {
  name: 'Expense',
  totalsByMonth: { '2026-07': -18000, '2026-08': -19000, '2026-09': -5600 },
  avg: -18600,
  weeklyRemaining: [-900, -500],
  expected: -1400,
  remainder: [-1300, -1900, -1400, -1500, -1350, -1450],
  sub: [groceries, fuel],
  isException: false,
  isTransfer: false,
};

/**
 * Exceptions are one-offs: no forecast to payday (nothing more is expected), but the amount already
 * charged is part of where the cycle closes — and Net Total has always counted them.
 */
const exceptionGroup = (name, soFar) => ({
  name,
  totalsByMonth: { '2026-07': 0, '2026-08': 0, '2026-09': soFar },
  avg: soFar,
  weeklyRemaining: [0, 0],
  expected: 0,
  sub: [],
  isException: true,
  isTransfer: false,
  skipExpected: true,
});

const incomeGroup = {
  name: 'Income',
  totalsByMonth: { '2026-07': 30000, '2026-08': 31000, '2026-09': 20000 },
  avg: 30500,
  weeklyRemaining: [500, 0],
  expected: 500,
  sub: [],
  isException: false,
  isTransfer: false,
};

const transfersGroup = {
  name: 'Transfers',
  totalsByMonth: { '2026-07': 0, '2026-08': 0, '2026-09': 0 },
  avg: 0,
  weeklyRemaining: [0, 0],
  expected: 0,
  sub: [],
  isException: false,
  isTransfer: true,
};

const incomeExceptions = exceptionGroup('Income Exceptions', 1200);
const expenseExceptions = exceptionGroup('Expense Exceptions', -3400);

const processed = {
  rows: [incomeGroup, expenseGroup, transfersGroup, incomeExceptions, expenseExceptions],
  months: MONTHS,
  currentMonth: '2026-09',
  // Net counts every flow, exceptions included: 20 000 − 5 600 + 1 200 − 3 400.
  netByMonth: [12000, 11000, 12200],
  netExpected: -900,
  netAvg: 11500,
  netWeeklyRemaining: [-900, -500],
  cycleWeeks: WEEKS,
  currentCycleStart: new Date(2026, 8, 7),
  currentCycleEnd: new Date(2026, 8, 22),
  dataThrough: new Date(2026, 8, 17),
};

const render = (p = processed, extra = {}) =>
  renderToStaticMarkup(createElement(TransactionTable, { processed: p, ...extra }))
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

  it('shows a range under the figure, from what the row itself has run', () => {
    const html = render();
    // Expense: R5 600 booked, and its six prior cycles needed between R1 325 and R1 700 more from
    // this point — so R6 925 to R7 300 around a R7 000 forecast.
    expect(html).toContain('R 6 925–R 7 300');
    // The figure itself is untouched, so the column still reconciles.
    expect(html).toContain('R 7 000');
    // A spend range must read upwards. Printed in the band's own (negative) order it came out
    // "R 7 300–R 6 925", which every reader would call a bug.
    expect(html).not.toContain('R 7 300–R 6 925');
  });

  it('prints the Net band signed and in value order, because net can go either way', () => {
    // The bug this pins: Net Total's forecast is -R9 920, and its band was printed with the
    // magnitude formatter — so "-R16 622 to -R4 238" rendered as "R 16 622–R 4 238": two
    // positive-looking numbers, descending, bracketing a negative figure.
    const html = render({
      ...processed,
      netByMonth: [12000, 11000, -8000],
      netExpected: -1920,
      netRemainder: [-2000, -8600, -3000, -4000, -2500, -3500],
    });
    const net = html.split('<tr').find((r) => r.includes('Net Total')) ?? '';
    expect(net).toMatch(/-R [\d ]+ to -R [\d ]+/);
    // Worst first: the range reads upward in value, like every other range in the table.
    const [, low, high] = /-R ([\d ]+) to -R ([\d ]+)/.exec(net) ?? [];
    expect(Number(low.replace(/ /g, ''))).toBeGreaterThan(Number(high.replace(/ /g, '')));
    // And never as bare magnitudes, which is what made it read as a positive range.
    expect(net).not.toMatch(/>R [\d ]+–R [\d ]+</);
  });

  it('shows a range even where it is narrow, and none only where there is no history', () => {
    // A tight range is the answer, not noise: it says this row really is predictable, which is
    // worth knowing precisely because it is not true of the rows around it. Suppressing it left a
    // bare figure, and a bare figure reads as a promise.
    const flat = { ...expenseGroup, remainder: [-1400, -1400, -1400, -1401, -1399, -1400] };
    const html = render({ ...processed, rows: [flat] });
    const row = html.split('<tr').find((r) => r.includes('Expense')) ?? '';
    // Both edges round to about R7 000 — and printing that is the point: it says the row is
    // predictable, rather than leaving a bare figure that reads as a promise.
    expect(row).toMatch(/R [67] \d\d\d–R [67] \d\d\d/);

    // With no history there is nothing to bracket it with, and inventing one would be worse.
    const bare = render({ ...processed, rows: [{ ...expenseGroup, remainder: null }] });
    const cells = bare.split('<tr').find((r) => r.includes('Expense')) ?? '';
    expect(cells).toContain('R 7 000');
    expect(cells).not.toMatch(/R [\d ]+–R [\d ]+/);
  });

  it('gives Left to payday its own range — a fortnight is never exact either', () => {
    const html = render();
    // Expense: R1 400 still expected, and its six prior cycles needed R1 325 to R1 700 from here.
    expect(html).toContain('R 1 400');
    expect(html).toMatch(/R 1 3\d\d–R 1 700/);
  });

  it('adds up: the flow rows and the exceptions reconcile with Net Total', () => {
    // The bug this test exists for: the exception groups printed a blank forecast while Net Total
    // counted them, so a reader adding the column up got a different answer from the app.
    const flows = [incomeGroup, expenseGroup, incomeExceptions, expenseExceptions];
    const sum = flows.reduce((s, g) => s + forecastOf(g, MONTHS), 0);
    const net = forecastOf(
      { totalsByMonth: { '2026-09': processed.netByMonth.at(-1) }, expected: processed.netExpected },
      MONTHS,
    );
    expect(sum).toBe(net);
    expect(net).toBe(11300);

    const html = render();
    // Each of the four is on the page, so the sum can actually be done by eye.
    expect(html).toContain('R 20 500'); // Income:  20 000 + 500
    expect(html).toContain('R 7 000'); // Expense: −5 600 − 1 400
    expect(html).toContain('R 1 200'); // Income Exceptions: the one-off itself
    expect(html).toContain('R 3 400'); // Expense Exceptions
    expect(html).toContain('R 11 300'); // Net Total
  });

  it('leaves the forecast blank only where there is no flow to forecast', () => {
    const cells = (group) => {
      const html = renderToStaticMarkup(
        createElement(
          'table',
          null,
          createElement(
            'tbody',
            null,
            createElement(TableGroup, { group, months: MONTHS, sort: { key: 'group', direction: 'asc' }, cycleWeeks: WEEKS }),
          ),
        ),
      );
      return [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map(([, c]) => c.replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ').trim());
    };

    // Transfers are two legs that cancel: no flow, so neither a forecast nor a left-to-payday.
    const transfers = cells(transfersGroup);
    expect(transfers.at(-3)).toBe('');
    expect(transfers.at(-2)).toBe('');

    // An exception has nothing more expected — but the one-off already charged is part of where
    // the cycle closes, and blanking it was what stopped the column reconciling with Net Total.
    const exceptions = cells(expenseExceptions);
    expect(exceptions.at(-3)).toBe('');
    expect(exceptions.at(-2)).toContain('3 400');
  });
});

describe('correcting a payment', () => {
  const COLUMNS = 1 + MONTHS.length + WEEKS.length + 3;
  const descriptionGroup = {
    description: 'Builders',
    variants: ['Builders Warehouse'],
    variantRows: [],
    amountsByMonth: { '2026-09': -4000 },
    datesByMonth: { '2026-09': '2026-09-10' },
    keys: ['k1', 'k2'],
    expected: -400,
    weeklyRemaining: [-400, 0],
    monthCount: 1,
    totalMonths: 3,
    isException: true,
  };
  const inTable = (el) =>
    renderToStaticMarkup(createElement('table', null, createElement('tbody', null, el)))
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  const descRow = (over = {}) =>
    inTable(
      createElement(GroupedTransactionRow, {
        group: descriptionGroup,
        months: MONTHS,
        sort: { key: 'group', direction: 'asc' },
        cycleWeeks: WEEKS,
        columns: COLUMNS,
        ...over,
      }),
    );

  it('offers nothing to press when no caller can write a correction', () => {
    // Read-only callers must not sprout controls they cannot honour.
    const html = descRow();
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('Mark Builders');
  });

  it('shows a stored correction on the row, without it having to be opened', () => {
    const html = descRow({ onSetTxnOverride: () => {}, txnOverrides: { k1: { flag: 'unexpected' }, k2: { flag: 'unexpected' } } });
    expect(html).toContain('unexpected');
    // Only where the payments AGREE — one corrected and one not says nothing.
    expect(descRow({ onSetTxnOverride: () => {}, txnOverrides: { k1: { flag: 'unexpected' } } })).not.toContain('>unexpected<');
  });

  it('spans the whole grid when the editor is open, and says what the choice changes', () => {
    const html = inTable(
      createElement(RowOverrideEditor, {
        columns: COLUMNS,
        label: 'Builders',
        keys: ['k1', 'k2'],
        flag: 'unexpected',
        choices: { categories: ['Groceries', 'Home Maintenance'], spendingGroups: ['Day-to-day'] },
        onChange: () => {},
        isException: true,
      }),
    );
    // A wrong colSpan would shear every column right of it.
    expect(html).toMatch(new RegExp(`colSpan="${COLUMNS}"`));
    expect(html).toContain('2 payments');
    expect(html).toContain('Home Maintenance');
    // The effect is stated, because a control whose consequence is invisible gets used wrongly.
    expect(html).toContain('left out of the averages, the forecast and its range');
    expect(html).toContain('Reset');
  });

  it('offers a way to name a group the bank never had', () => {
    // "Move all Communications to Recurring" — a grouping that does not exist yet. Without this the
    // pickers could only ever re-file into labels the export already used.
    const html = inTable(
      createElement(RowOverrideEditor, {
        columns: COLUMNS,
        label: 'Communications',
        keys: ['k1', 'k2'],
        choices: { categories: ['Cellphone'], spendingGroups: ['Day-to-day'] },
        onChange: () => {},
      }),
    );
    expect(html).toContain('New…');
  });

  it('keeps showing a label it has been moved to, even though the file has no such label', () => {
    const html = inTable(
      createElement(RowOverrideEditor, {
        columns: COLUMNS,
        label: 'Communications',
        keys: ['k1'],
        spendingGroup: 'Recurring',
        choices: { categories: ['Cellphone'], spendingGroups: ['Day-to-day'] },
        onChange: () => {},
      }),
    );
    // Otherwise the picker would silently fall back to "as imported" and the move would look lost.
    expect(html).toContain('Recurring');
  });

  it('offers only labels already in the file', () => {
    const html = inTable(
      createElement(RowOverrideEditor, {
        columns: COLUMNS,
        label: 'Builders',
        keys: ['k1'],
        choices: { categories: ['Groceries'], spendingGroups: [] },
        onChange: () => {},
      }),
    );
    expect(html).toContain('as imported');
    expect(html).toContain('Groceries');
    // No spending-group picker when the export has no such column.
    expect(html).not.toContain('>Group<');
  });
});
