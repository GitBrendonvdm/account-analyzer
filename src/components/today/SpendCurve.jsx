import { useMemo } from 'react';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * The cumulative spend curve.
 *
 * Hand-drawn SVG rather than a chart library, for one reason: the three series need different
 * treatments that a generic line chart fights — a solid actual line that stops where the data
 * stops, a dashed forecast tail continuing from exactly that point, and a ghosted typical curve
 * behind both. Doing it directly is less code than configuring a library out of its defaults.
 */

const W = 1000;
const H = 200;
const PAD_TOP = 12;

function path(points, accessor, xOf, yOf) {
  let d = '';
  let open = false;
  points.forEach((p) => {
    const v = accessor(p);
    if (v == null) {
      open = false;
      return;
    }
    const cmd = open ? 'L' : 'M';
    d += `${cmd}${xOf(p.day).toFixed(1)},${yOf(v).toFixed(1)} `;
    open = true;
  });
  return d.trim();
}

export function SpendCurve({ curve }) {
  const geometry = useMemo(() => {
    if (!curve?.points?.length) return null;
    const max = Math.max(
      curve.projectedEnd,
      curve.typicalTotal,
      ...curve.points.map((p) => p.actual ?? 0),
      1,
    );
    const lastDay = curve.length - 1;
    const xOf = (day) => (day / Math.max(1, lastDay)) * W;
    const yOf = (v) => H - (v / max) * (H - PAD_TOP);

    const actual = path(curve.points, (p) => p.actual, xOf, yOf);
    const forecast = path(curve.points, (p) => p.forecast, xOf, yOf);
    const typical = path(curve.points, (p) => p.typical, xOf, yOf);
    const head = curve.points[curve.throughDay];

    return {
      actual,
      forecast,
      typical,
      area: actual ? `${actual} L${xOf(curve.throughDay).toFixed(1)},${H} L0,${H} Z` : '',
      headX: xOf(curve.throughDay),
      headY: yOf(head?.actual ?? 0),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const day = Math.round(lastDay * f);
        return { x: xOf(day), date: curve.points[day]?.date };
      }),
    };
  }, [curve]);

  if (!geometry) return null;

  const paceLabel =
    curve.pace == null
      ? null
      : curve.pace > 1.04
        ? `${Math.round((curve.pace - 1) * 100)}% ahead of a typical cycle`
        : curve.pace < 0.96
          ? `${Math.round((1 - curve.pace) * 100)}% behind a typical cycle`
          : 'level with a typical cycle';

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="t-head">Spend through the cycle</h2>
          <p className="t-label mt-1.5">
            {paceLabel ?? `Against the previous ${curve.priorCycles} cycles`}
          </p>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2 text-[12.5px] text-label-2">
            <span className="block h-[3px] w-4 rounded-full bg-info" />
            This cycle
          </span>
          <span className="flex items-center gap-2 text-[12.5px] text-label-3">
            <span
              className="block h-[3px] w-4 rounded-full"
              style={{ background: 'rgba(235,235,245,0.35)' }}
            />
            Typical
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-5 block h-[200px] w-full"
        role="img"
        aria-label={`Cumulative spend this cycle: ${formatCurrencyAbs(curve.spentSoFar)} so far, heading for ${formatCurrencyAbs(curve.projectedEnd)}`}
      >
        <defs>
          <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a84ff" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#0a84ff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="rgba(255,255,255,0.055)"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path
          d={geometry.typical}
          fill="none"
          stroke="rgba(235,235,245,0.32)"
          strokeWidth="2"
          strokeDasharray="5 6"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path d={geometry.area} fill="url(#spend-fill)" />
        <path
          d={geometry.forecast}
          fill="none"
          stroke="#0a84ff"
          strokeWidth="3"
          strokeDasharray="2 7"
          strokeLinecap="round"
          opacity="0.55"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={geometry.actual}
          fill="none"
          stroke="#0a84ff"
          strokeWidth="3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={geometry.headX} cy={geometry.headY} r="12" fill="#0a84ff" opacity="0.2" />
        <circle cx={geometry.headX} cy={geometry.headY} r="5.5" fill="#0a84ff" />
      </svg>

      <div className="flex justify-between pt-1 text-[12px] text-label-3">
        {geometry.ticks.map((t, i) => (
          <span key={i}>
            {t.date?.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
          </span>
        ))}
      </div>
    </div>
  );
}
