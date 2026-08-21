import { useMemo } from 'react';
import { formatCurrency } from '../../utils/format';

/**
 * Several pay cycles overlaid on one set of axes.
 *
 * Everything is plotted against DAY OF CYCLE rather than calendar date, which is the move that
 * makes the comparison work: day 8 of July sits directly above day 8 of August, so three months
 * become three shapes you can read against each other instead of one long line where the pattern is
 * buried in its own history.
 *
 * Lines, not areas. Three filled areas overlaid mostly obscure each other, and when a series is
 * entirely negative the fill runs from the line all the way to a zero baseline off the top of the
 * frame and floods it. A stroke reads at any sign and any overlap.
 *
 * The current cycle is thickest and carries the dashed forecast tail, but the earlier ones stay
 * close to full strength. Separating them by HUE rather than by fading them keeps all three
 * readable — a comparison chart whose comparison lines are ghosts is only one line.
 */

const W = 1000;
const H = 210;
const PAD = 14;

export function CycleOverlay({ series, length, min, max, idPrefix }) {
  const geometry = useMemo(() => {
    if (!series?.length || !length) return null;

    // Fit the data, don't force zero in: when every value is negative, including zero throws half
    // the frame away and flattens the differences that are the whole point.
    const span = max - min || 1;
    const pad = span * 0.08;
    const top = max + pad;
    const bottom = min - pad;

    const xOf = (day) => (day / Math.max(1, length - 1)) * W;
    const yOf = (v) => PAD + ((top - v) / (top - bottom)) * (H - PAD * 2);

    const draw = (points, from, to) => {
      let d = '';
      let open = false;
      for (let i = from; i <= to && i < points.length; i += 1) {
        const v = points[i];
        if (v == null) {
          open = false;
          continue;
        }
        d += `${open ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
        open = true;
      }
      return d.trim();
    };

    const shapes = series.map((s) => {
      const solidTo = s.throughDay == null ? s.points.length - 1 : s.throughDay;
      return {
        ...s,
        solid: draw(s.points, 0, solidTo),
        dashed: s.throughDay == null ? '' : draw(s.points, s.throughDay, s.points.length - 1),
        headX: xOf(solidTo),
        headY: yOf(s.points[solidTo] ?? 0),
      };
    });

    // Zero only earns a line when it actually falls inside the frame.
    const showZero = bottom < 0 && top > 0;

    return {
      shapes,
      showZero,
      zeroY: yOf(0),
      gridYs: [0.25, 0.5, 0.75].map((f) => PAD + f * (H - PAD * 2)),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((length - 1) * f)),
    };
  }, [series, length, min, max]);

  if (!geometry) return null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[210px] w-full"
        role="img"
        aria-label={series.map((s) => `${s.label}: ${formatCurrency(s.total)}`).join('. ')}
      >
        {geometry.gridYs.map((y) => (
          <line
            key={y}
            x1="0"
            x2={W}
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.05)"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {geometry.showZero && (
          <line
            x1="0"
            x2={W}
            y1={geometry.zeroY}
            y2={geometry.zeroY}
            stroke="rgba(255,255,255,0.2)"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Oldest first, so the current cycle draws over the others rather than under them. */}
        {[...geometry.shapes].reverse().map((s) => (
          <g key={s.id} id={`${idPrefix}-${s.id}`}>
            {s.dashed && (
              <path
                d={s.dashed}
                fill="none"
                stroke={s.colour}
                strokeWidth={s.isCurrent ? 2.75 : 2}
                strokeDasharray="2 7"
                strokeLinecap="round"
                opacity="0.5"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={s.solid}
              fill="none"
              stroke={s.colour}
              strokeWidth={s.isCurrent ? 3 : 2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={s.isCurrent ? 1 : 0.88}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {geometry.shapes
          .filter((s) => s.isCurrent)
          .map((s) => (
            <g key={`head-${s.id}`}>
              <circle cx={s.headX} cy={s.headY} r="10" fill={s.colour} opacity="0.22" />
              <circle cx={s.headX} cy={s.headY} r="4.5" fill={s.colour} />
            </g>
          ))}
      </svg>

      <div className="flex justify-between pt-1.5 text-[12px] text-label-3">
        {geometry.ticks.map((day) => (
          <span key={day}>Day {day + 1}</span>
        ))}
      </div>
    </div>
  );
}

/** One entry per cycle: its colour, its name and where it ended up. */
export function CycleLegend({ series, tone }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {series.map((s) => (
        <span key={s.id} className="flex items-center gap-2 text-[12.5px]">
          <span
            className="block h-[3px] w-4 rounded-full"
            style={{ background: s.colour, opacity: s.isCurrent ? 1 : 0.88 }}
          />
          <span className={s.isCurrent ? 'font-medium text-label' : 'text-label-2'}>{s.label}</span>
          <span className={`num font-semibold ${tone ? tone(s) : 'text-label'}`}>
            {formatCurrency(s.total)}
          </span>
        </span>
      ))}
    </div>
  );
}
