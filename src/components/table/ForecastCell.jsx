import { forecastBand } from '../../lib/forecastBand';
import { Cell } from './Cell';
import { RangeUnder } from './RangeUnder';
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
  return (
    <span className="inline-flex flex-col items-end">
      <Cell val={mid} absolute={absolute} />
      {bandWorthShowing(band) && (
        <RangeUnder
          from={band.low}
          to={band.high}
          cycles={band.cycles}
          signed={!absolute}
          note={band.midOutside ? 'The forecast falls outside that, so the range is stretched to reach it' : null}
        />
      )}
    </span>
  );
}

/**
 * The "left to payday" cell, with its own range.
 *
 * This is the more actionable of the two forecast figures and the one most obviously not a promise:
 * nobody can say a fortnight will cost exactly R22 991. It is the same band with what has already
 * landed taken back off.
 */
export function RemainingCell({ item, months, absolute = true, className = '' }) {
  const remaining = item?.expected ?? 0;
  const band = forecastBand(soFarOf(item, months), remaining, item?.remainder);
  return (
    <span className={`inline-flex flex-col items-end ${className}`}>
      <Cell val={remaining} absolute={absolute} />
      {bandWorthShowing(band) && (
        <RangeUnder from={band.remainingLow} to={band.remainingHigh} cycles={band.cycles} signed={!absolute} />
      )}
    </span>
  );
}
