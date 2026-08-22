import { CycleLegend, CycleOverlay } from './CycleOverlay';
import { useSeriesToggle } from '../charts/interactive';

/**
 * Cumulative spend, three cycles overlaid.
 *
 * The header states the comparison the chart is making — how this cycle is running against the
 * same point in the last one — because "R101 040 spent" means nothing without knowing whether that
 * is early or late in the month, and the whole reason for overlaying on a day-of-cycle axis is to
 * answer exactly that.
 */
export function SpendCurve({ curve }) {
  const { hidden, toggle } = useSeriesToggle();
  if (!curve?.series?.length) return null;

  const paceLabel =
    curve.pace == null || !curve.comparedWith
      ? `Cumulative spend across the last ${curve.cycles} cycles`
      : curve.pace > 1.04
        ? `${Math.round((curve.pace - 1) * 100)}% ahead of ${curve.comparedWith} at the same point`
        : curve.pace < 0.96
          ? `${Math.round((1 - curve.pace) * 100)}% behind ${curve.comparedWith} at the same point`
          : `Level with ${curve.comparedWith} at the same point`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="t-head">Spend through the cycle</h2>
          <p className="t-label mt-1.5">{paceLabel}</p>
        </div>
        <CycleLegend series={curve.series} hidden={hidden} onToggle={toggle} />
      </div>

      <div className="mt-5 flex min-h-0 flex-grow flex-col">
        <CycleOverlay
          series={curve.series}
          length={curve.length}
          min={0}
          max={curve.max}
          idPrefix="spend"
          hidden={hidden}
        />
      </div>
    </div>
  );
}
