import { formatCurrency, formatCurrencyAbs } from '../../utils/format';

/**
 * The low–high pair printed under a forecast figure.
 *
 * Every forecast carries one. A number with nothing beside it reads as a promise, and no claim
 * about the rest of a month is exact — not "R22 991 still to spend", not "R89 086 by payday". Where
 * the range is narrow that is the answer rather than noise: it says this row really is predictable,
 * which is worth knowing about a rent line precisely because it is not true of the groceries above.
 *
 * ORDERED AS IT WILL BE READ. The band is ordered by value, but a spend row prints magnitudes, and
 * there the lower value is the bigger number — printed in band order that came out "R7 300–R6 925",
 * a range running backwards. Rows whose sign can go either way (Net Total) print signed instead,
 * joined with "to", because a dash between two minus signs is a mess.
 */
export function RangeUnder({ from, to, cycles, signed = false, note = null }) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const lo = signed ? Math.min(from, to) : Math.min(Math.abs(from), Math.abs(to));
  const hi = signed ? Math.max(from, to) : Math.max(Math.abs(from), Math.abs(to));
  const fmt = signed ? formatCurrency : formatCurrencyAbs;
  const title = `Over the last ${cycles} ${cycles === 1 ? 'cycle' : 'cycles'} this ran between ${fmt(lo)} and ${fmt(hi)} from this point in the cycle${note ? `. ${note}` : '.'}`;
  return (
    <span className="num block text-[11px] leading-tight font-normal text-label-4" title={title}>
      {signed ? (
        <>
          {fmt(lo)} to {fmt(hi)}
        </>
      ) : (
        <>
          {fmt(lo)}–{fmt(hi)}
        </>
      )}
    </span>
  );
}
