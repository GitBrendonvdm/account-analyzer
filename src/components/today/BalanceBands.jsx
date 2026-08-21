import { useMemo } from 'react';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';

/**
 * Three balance bands on one axis.
 *
 * Cash and savings sit above zero, card debt below it, all against a shared scale — so the gap
 * between what you hold and what you owe is a shape rather than a subtraction you have to do. Three
 * separate charts would hide exactly the thing worth seeing: cash holding level while the red
 * deepens underneath is spending that was financed, not afforded.
 *
 * Drawn by hand for the same reason as the spend curve — the areas need to fill toward the zero
 * line in both directions, which is not what a stacked-area component does by default.
 */

const W = 1000;
const H = 230;
const PAD = 14;

export function BalanceBands({ series }) {
  const geometry = useMemo(() => {
    if (!series?.points?.length) return null;
    const { points, bands } = series;

    let min = 0;
    let max = 0;
    points.forEach((p) => {
      bands.forEach((b) => {
        if (p[b.id] < min) min = p[b.id];
        if (p[b.id] > max) max = p[b.id];
      });
    });
    if (max === min) max = min + 1;

    const lastDay = points.length - 1;
    const xOf = (day) => (day / Math.max(1, lastDay)) * W;
    const yOf = (v) => PAD + ((max - v) / (max - min)) * (H - PAD * 2);
    const zeroY = yOf(0);

    const shapes = bands.map((band) => {
      const line = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.day).toFixed(1)},${yOf(p[band.id]).toFixed(1)}`)
        .join(' ');
      const area = `${line} L${xOf(lastDay).toFixed(1)},${zeroY.toFixed(1)} L0,${zeroY.toFixed(1)} Z`;
      return { ...band, line, area, last: points[lastDay][band.id] };
    });

    return {
      shapes,
      zeroY,
      ticks: [0, 0.33, 0.66, 1].map((f) => {
        const day = Math.round(lastDay * f);
        return { x: xOf(day), date: points[day]?.date };
      }),
    };
  }, [series]);

  if (!geometry) return null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="t-head">Balances over {series.cycles} cycles</h2>
          <p className="t-label mt-1.5">
            {series.anchored
              ? 'Cash above the line, card debt below it.'
              : `Movement, not balances — ${series.anchoredCount} of ${series.accountCount} accounts have a balance entered. The shape is exact; the level is anchored at zero.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {geometry.shapes.map((b) => (
            <span key={b.id} className="flex items-center gap-2 text-[12.5px] text-label-2">
              <span
                className="block h-[3px] w-4 rounded-full"
                style={{ background: b.colour }}
              />
              {b.label}
              <span className="num font-semibold text-label">{formatCurrency(b.last)}</span>
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-5 block h-[230px] w-full"
        role="img"
        aria-label={`Balances across ${series.cycles} pay cycles. ${geometry.shapes
          .map((b) => `${b.label} ${formatCurrency(b.last)}`)
          .join(', ')}.`}
      >
        <defs>
          {geometry.shapes.map((b) => (
            <linearGradient key={b.id} id={`band-${b.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={b.colour} stopOpacity="0.34" />
              <stop offset="100%" stopColor={b.colour} stopOpacity="0.04" />
            </linearGradient>
          ))}
        </defs>

        {geometry.shapes.map((b) => (
          <path key={`a-${b.id}`} d={b.area} fill={`url(#band-${b.id})`} />
        ))}

        {/* Zero is the reading line here — everything above it is held, everything below owed. */}
        <line
          x1="0"
          x2={W}
          y1={geometry.zeroY}
          y2={geometry.zeroY}
          stroke="rgba(255,255,255,0.22)"
          vectorEffect="non-scaling-stroke"
        />

        {geometry.shapes.map((b) => (
          <path
            key={`l-${b.id}`}
            d={b.line}
            fill="none"
            stroke={b.colour}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="flex justify-between pt-1 text-[12px] text-label-3">
        {geometry.ticks.map((t, i) => (
          <span key={i}>
            {t.date?.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
          </span>
        ))}
      </div>

      <p className="t-caption mt-4 border-t pt-4">
        Loans excluded — a bond amortises on its own schedule and its size would flatten everything
        else against the axis.{' '}
        {series.netChange >= 0 ? 'Up ' : 'Down '}
        <span className={series.netChange >= 0 ? 'text-good' : 'text-bad'}>
          {formatCurrencyAbs(series.netChange)}
        </span>{' '}
        across the period.
      </p>
    </div>
  );
}
