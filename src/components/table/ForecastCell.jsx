import { formatCurrencyAbs } from '../../utils/format';
import { forecastBand } from '../../lib/forecastBand';
import { Cell } from './Cell';
import { bandWorthShowing, forecastOf, soFarOf } from './forecast';

/**
 * The Forecast cell: the figure, and under it the range the row's own history has actually run.
 *
 * The figure is the envelope's number, unchanged, so the column still equals "so far + left to
 * payday" and still sums to Net Total. The pair beneath comes from `forecastBand` — percentiles of
 * what this same row really spent from this cycle day onward in each prior cycle — and it is
 * deliberately quieter than the figure: it is the uncertainty around a decision, not a second
 * decision. A single number for where a cycle closes reads as a promise; it never was one.
 *
 * The range is left out where it would be noise rather than information (see `bandWorthShowing`)
 * and where there is too little history to have one at all.
 */
export function ForecastCell({ item, months, absolute = true }) {
  const mid = forecastOf(item, months);
  if (mid == null) return null;
  const band = forecastBand(soFarOf(item, months), item?.expected ?? 0, item?.remainder);
  const show = bandWorthShowing(band, mid);
  // The band is ordered by VALUE, but the cell prints magnitudes: on a spend row the lower value
  // is the bigger number, so printing them in band order gave "R 7 300–R 6 925" — a range running
  // backwards. Order the pair the way it will actually be read.
  const [from, to] = show && absolute
    ? [Math.min(Math.abs(band.low), Math.abs(band.high)), Math.max(Math.abs(band.low), Math.abs(band.high))]
    : [band?.low, band?.high];
  return (
    <span className="inline-flex flex-col items-end">
      <Cell val={mid} absolute={absolute} />
      {show && (
        <span
          className="num text-[11px] leading-tight font-normal text-label-4"
          title={`Over the last ${band.cycles} cycles this row ran between ${formatCurrencyAbs(from)} and ${formatCurrencyAbs(to)} from this point in the cycle${band.midOutside ? '. The forecast falls outside that, so the range is stretched to reach it' : ''}.`}
        >
          {formatCurrencyAbs(from)}–{formatCurrencyAbs(to)}
        </span>
      )}
    </span>
  );
}
