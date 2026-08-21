import { buildCycleCalendar } from '../lib/cycleCurve';
import { categoriseAll, trainCategoriser } from '../lib/categorise';
import { normalizeTransactionAmount, parseAmount } from '../utils/amount';

/**
 * Turning raw bank data into rows this app can actually use.
 *
 * A statement or a notification gives a date, a description, an amount and an account. The app
 * needs two more things that no bank supplies, because an aggregator used to supply them:
 *
 *   Pay Month       which pay cycle the transaction belongs to. Derived from the cycle boundary
 *                   the app already infers from history, so a raw row lands in the same cycle the
 *                   old export would have put it in.
 *   Category        filled from your own labelled history — see categorise.js.
 *
 * Doing this here rather than in each source means OFX, QIF and notification rows all arrive in one
 * shape, and adding a future source (an aggregator API) means writing a parser and nothing else.
 */

/**
 * Which pay cycle a date falls in, given the boundary day of month and month offset the calendar
 * inferred. The app's cycles run 23rd → 22nd, so 24 July belongs to pay month 2026-08.
 */
function payMonthFor(dateStr, boundaryDom, startMonthOffset) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  // A date on or after the boundary belongs to the NEXT cycle key when the cycle starts in the
  // previous calendar month (startMonthOffset === -1).
  let year = y;
  let month = m;
  if (startMonthOffset === -1) {
    if (d >= boundaryDom) month += 1;
  } else if (d < boundaryDom) {
    month -= 1;
  }
  if (month > 12) { month = 1; year += 1; }
  if (month < 1) { month = 12; year -= 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * @param incoming raw rows from any source
 * @param history  everything already held — used to learn categories and the cycle boundary
 */
export function normaliseRows(incoming, history = [], { asOf = new Date() } = {}) {
  if (!incoming?.length) return { rows: [], stats: { total: 0 } };

  // The cycle boundary is a property of your history, so it is inferred once from what's stored
  // rather than guessed per file. With no history at all, fall back to calendar months.
  const months = [...new Set(history.map((t) => t['Pay Month']).filter(Boolean))].sort();
  const calendar = history.length && months.length ? buildCycleCalendar(history, months, asOf) : null;
  const boundaryDom = calendar?.boundaryDom ?? 1;
  const startMonthOffset = calendar?.startMonthOffset ?? 0;

  const model = trainCategoriser(history);

  const withBasics = incoming.map((row) => {
    const amountNum = Number.isFinite(row.AmountNum)
      ? row.AmountNum
      : normalizeTransactionAmount(row.Description, parseAmount(row.Amount));
    return {
      ...row,
      AmountNum: amountNum,
      Amount: row.Amount ?? String(amountNum),
      Currency: row.Currency || 'ZAR',
      'Pay Month': row['Pay Month'] || payMonthFor(row.Date, boundaryDom, startMonthOffset) || row.Date?.slice(0, 7),
      Type: row.Type || (amountNum < 0 ? 'Expense' : 'Income'),
      Status: row.Status || 'Completed',
    };
  });

  const rows = categoriseAll(withBasics, model);

  const bySource = {};
  rows.forEach((r) => {
    const key = r.categorySource ?? 'given';
    bySource[key] = (bySource[key] ?? 0) + 1;
  });

  return {
    rows,
    stats: {
      total: rows.length,
      boundaryDom,
      categorised: bySource,
      learnedFrom: model.trainedOn,
      merchantsKnown: model.merchants.size,
    },
  };
}

export { payMonthFor };
