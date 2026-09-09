/**
 * Where this cycle is heading: what has landed so far, plus what is still expected before payday.
 *
 * The table used to end "So far · This week · 14 Sept · 21 Sept · Left to payday · Typical", and a
 * reader following the row left to right arrived at Typical and read it as the row's total — it is
 * the only big figure after the forecast columns, and the group header saying otherwise scrolls out
 * of sight. But Typical is a recency-weighted average of COMPLETED cycles; it is not this cycle's
 * anything. The number the eye was looking for — R65 624 so far plus R21 321 still to come — was
 * simply not on the page. This computes it, and `Forecast` prints it as the last column of the
 * forecast block, where the row's arithmetic closes.
 *
 * Signed like every other figure in the table (expenses negative), so `Cell` tones it the same way
 * and a row's forecast can be added to another's.
 */

/**
 * So far + still expected, for one row of the table. Null when there is no current cycle.
 *
 * Group and category rows key their cycle totals on `totalsByMonth`; the description-level rows
 * under them use `amountsByMonth`. Both are read, so one row type cannot quietly forecast zero.
 *
 * A row with nothing more expected still HAS a forecast — the one-off already charged this cycle is
 * exactly as much a part of where the cycle closes as a bill still to come. That distinction is why
 * the exception rows print a figure here while their "left to payday" cell is rightly blank, and it
 * is what makes the column add up: Income + Expense + the two Exceptions groups reconcile with Net
 * Total, which has always counted the exceptions.
 */
export function forecastOf(item, months) {
  if (!months?.length) return null;
  return soFarOf(item, months) + (item?.expected ?? 0);
}

/** What this cycle has already booked for the row; 0 when there is no current cycle. */
export function soFarOf(item, months) {
  const current = months?.[months.length - 1];
  if (!current) return 0;
  return item?.totalsByMonth?.[current] ?? item?.amountsByMonth?.[current] ?? 0;
}

/**
 * Every forecast that HAS a range shows it.
 *
 * This used to suppress ranges it judged too narrow to be worth the ink — a rent line that has been
 * R12 000 for a year does not need telling you it will probably be R12 000. That reasoning was
 * wrong, and the reader said so plainly: a figure with no range beside it reads as a promise, and
 * "R22 991 for the rest of the month" is not a thing anyone can promise. A tight range is not
 * noise, it is the answer — it says this one really is predictable, which is worth knowing about a
 * rent line precisely because it is not true of the groceries above it.
 *
 * What remains is the honest floor: too few cycles to have a range at all (BAND_MIN_CYCLES).
 */
export function bandWorthShowing(band) {
  return Boolean(band);
}
