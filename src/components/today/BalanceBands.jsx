import { useMemo } from 'react';
import { CycleLegend, CycleOverlay } from './CycleOverlay';
import { useSeriesToggle } from '../charts/interactive';

/**
 * What the accounts did, three cycles overlaid, each starting at zero.
 *
 * Every account is summed into a single line — cash, savings and cards together — because the
 * question is how much moved, and one number answers it. Loans are excluded and not optional.
 *
 * EVERY CYCLE STARTS AT ZERO. Drawn as a raw running balance, cycles begin wherever the previous
 * one ended, and those openings differ by tens of thousands: the chart became three roughly
 * parallel lines at different heights, which reads as enormous differences when it is mostly just
 * the starting height. It also made this chart incomparable with the spend curve above it, which
 * has always started each cycle at zero. Rebasing to the opening balance puts both charts on the
 * same footing — day 1 is the origin in each, and the lines compare what a cycle DID rather than
 * where it happened to begin.
 *
 * The level is not lost: the legend carries where each cycle finished, which is the number you
 * would have read off the y-axis anyway.
 */
export function BalanceBands({ series }) {
  const shown = useMemo(
    () =>
      series?.series?.map((s) => ({
        ...s,
        points: s.change,
        total: s.total - s.opening,
      })) ?? null,
    [series],
  );
  const { hidden, toggle } = useSeriesToggle();

  if (!shown?.length) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="t-head">What the accounts did</h2>
          <p className="t-label mt-1.5">
            {series.anchored
              ? 'Every account except the loans, summed — each cycle from zero at its opening.'
              : `Each cycle from zero at its opening. ${series.anchoredCount} of ${series.accountCount} accounts have a balance entered, so the movement is exact even where the level is not.`}
          </p>
        </div>
        <CycleLegend
          series={shown}
          tone={(s) => (s.total < 0 ? 'text-bad' : 'text-good')}
          hidden={hidden}
          onToggle={toggle}
        />
      </div>

      <div className="mt-5 flex min-h-0 flex-grow flex-col">
        <CycleOverlay
          series={shown}
          length={series.changeLength}
          min={series.changeMin}
          max={series.changeMax}
          idPrefix="bal"
          deltaMode="peak"
          dayLabel={(d) => (d === 0 ? 'Start' : `Day ${d}`)}
          hidden={hidden}
        />
      </div>

      <p className="t-caption mt-4 border-t pt-4">
        Loans excluded — a bond amortises on its own schedule and its size would flatten everything
        else against the axis. Each line starts at zero at its own opening, so they compare what each cycle moved rather
        than where it began.
      </p>
    </div>
  );
}
