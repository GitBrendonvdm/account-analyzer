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

/** So far + still expected, for one row of the table. Null when there is no current cycle. */
export function forecastOf(item, months) {
  const current = months?.[months.length - 1];
  if (!current) return null;
  const soFar = item?.totalsByMonth?.[current] ?? 0;
  const remaining = item?.expected ?? 0;
  return soFar + remaining;
}
