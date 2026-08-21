import { CycleLegend, CycleOverlay } from './CycleOverlay';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * What the accounts held, three cycles overlaid.
 *
 * Every account summed into one line — cash, savings and cards together — because the question is
 * "how much is there", and one number answers it. Overlaying the cycles on a day-of-cycle axis then
 * shows whether this month is running above or below the last two at the same point, which a single
 * continuous line across three months cannot show.
 */
export function BalanceBands({ series }) {
  if (!series?.series?.length) return null;

  const against = series.againstPrevious;
  const previous = series.series.find((s) => !s.isCurrent);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="t-head">What the accounts hold</h2>
          <p className="t-label mt-1.5">
            {series.anchored
              ? 'Every account except the loans, summed.'
              : `Movement, not balances — ${series.anchoredCount} of ${series.accountCount} accounts have a balance entered, so the shape is exact and the level is anchored at zero.`}
          </p>
        </div>
        <CycleLegend
          series={series.series}
          tone={(s) => (s.total < 0 ? 'text-bad' : 'text-good')}
        />
      </div>

      <div className="mt-5">
        <CycleOverlay
          series={series.series}
          length={series.length}
          min={series.min}
          max={series.max}
          idPrefix="bal"
          deltaMode="peak"
        />
      </div>

      <p className="t-caption mt-4 border-t pt-4">
        Loans excluded — a bond amortises on its own schedule and its size would flatten everything
        else against the axis.
        {against != null && previous && (
          <>
            {' '}
            This cycle is{' '}
            <span className={against >= 0 ? 'text-good' : 'text-bad'}>
              {formatCurrencyAbs(against)} {against >= 0 ? 'above' : 'below'}
            </span>{' '}
            where {previous.label} finished.
          </>
        )}
      </p>
    </div>
  );
}
