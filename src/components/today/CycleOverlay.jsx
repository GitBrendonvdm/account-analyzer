import { useCallback, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { formatCurrency } from '../../utils/format';

/**
 * Several pay cycles overlaid on one set of axes, with drag-to-zoom.
 *
 * Everything is plotted against DAY OF CYCLE rather than calendar date, which is the move that
 * makes the comparison work: day 8 of July sits directly above day 8 of August, so three months
 * become three shapes read against each other instead of one long line with the pattern buried in
 * its own history.
 *
 * Lines, not areas. Three filled areas overlaid mostly obscure each other, and a series that is
 * entirely negative fills from its line up to a zero baseline off the top of the frame and floods
 * it.
 *
 * Recency is encoded twice: by HUE, so the cycles are told apart at a glance, and by WEIGHT, so the
 * further back one is the quieter it draws. Hue alone left three equally loud lines with no sense
 * of which was now; weight alone turned the older ones into ghosts.
 *
 * ZOOM. Drag across the plot to select a span of days and the chart rescales to it — on BOTH axes,
 * because rescaling y is what turns a stretch that looked flat into something with shape in it.
 * The selection tracks the pointer 1:1 and is drawn from the moment the button goes down rather
 * than on release, so the gesture is visible while it happens instead of resolving afterwards.
 * Double-click, Escape or the reset chip puts it back.
 */

const W = 1000;
const H = 210;
const PAD = 14;
/** Below this the drag was a click, not a selection. */
const MIN_SPAN_DAYS = 2;

/** Vibrancy by how far back the cycle is — index 0 is the current one. */
const DEPTH_OPACITY = [1, 0.66, 0.44, 0.32];
const DEPTH_WIDTH = [3, 2.25, 2, 1.75];
const at = (ramp, depth) => ramp[Math.min(depth ?? 0, ramp.length - 1)];

export function CycleOverlay({
  series,
  length,
  min,
  max,
  idPrefix,
  dayLabel = (d) => `Day ${d + 1}`,
  /**
   * What the hover readout measures against.
   *   'start' — change since the beginning of the visible period. Right for a cumulative series:
   *             the delta IS the spend over that stretch.
   *   'peak'  — how far below the period's high the line has fallen. Right for a balance, where
   *             "since the start" answers a question nobody asked and the drawdown is the thing
   *             you feel.
   */
  deltaMode = 'start',
}) {
  const svgRef = useRef(null);
  const [range, setRange] = useState(null); // {from,to} in days; null = the whole cycle
  const [drag, setDrag] = useState(null); // {from,to} while the pointer is down
  const [hover, setHover] = useState(null); // day index under the pointer

  const from = range?.from ?? 0;
  const to = range?.to ?? length - 1;
  const zoomed = range != null;

  /** Where the pointer is, in days. Linear, because the viewBox does not preserve aspect ratio. */
  const dayAt = useCallback(
    (clientX) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return from;
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(from + t * (to - from));
    },
    [from, to],
  );

  const onPointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button !== 0) return;
      // Capture, so the drag survives the pointer leaving the chart's bounds.
      e.currentTarget.setPointerCapture(e.pointerId);
      const day = dayAt(e.clientX);
      setDrag({ from: day, to: day });
    },
    [dayAt],
  );

  const onPointerMove = useCallback(
    (e) => {
      const day = dayAt(e.clientX);
      setHover(day);
      setDrag((d) => (d ? { ...d, to: day } : d));
    },
    [dayAt],
  );

  // Both handlers: pointerleave does not bubble, so React delegates it through pointerout, and a
  // pointer lifted outside the plot can otherwise leave the crosshair stranded.
  const onPointerLeave = useCallback(() => setHover(null), []);

  const onPointerUp = useCallback(() => {
    setDrag((d) => {
      if (!d) return null;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      // A tap is not a selection — leave the view alone rather than zooming to a sliver.
      if (hi - lo >= MIN_SPAN_DAYS) setRange({ from: lo, to: hi });
      return null;
    });
  }, []);

  const reset = useCallback(() => {
    setRange(null);
    setDrag(null);
  }, []);

  const geometry = useMemo(() => {
    if (!series?.length || !length) return null;
    const span = Math.max(1, to - from);

    // Rescale y to what is actually visible. Holding the full-range scale while zoomed in would
    // keep a wider window's extremes and leave the selected stretch as flat as it looked before.
    const visible = series.flatMap((s) => s.points.slice(from, to + 1).filter((v) => v != null));
    const lo = visible.length ? Math.min(...visible) : min;
    const hi = visible.length ? Math.max(...visible) : max;
    const pad = (hi - lo || 1) * 0.08;
    const top = hi + pad;
    const bottom = lo - pad;

    const xOf = (day) => ((day - from) / span) * W;
    const yOf = (v) => PAD + ((top - v) / (top - bottom)) * (H - PAD * 2);

    const draw = (points, a, b) => {
      let d = '';
      let open = false;
      for (let i = Math.max(a, from); i <= Math.min(b, to) && i < points.length; i += 1) {
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
        headVisible: solidTo >= from && solidTo <= to,
        headX: xOf(solidTo),
        headY: yOf(s.points[solidTo] ?? 0),
      };
    });

    return {
      shapes,
      xOf,
      yOf,
      showZero: bottom < 0 && top > 0,
      zeroY: yOf(0),
      gridYs: [0.25, 0.5, 0.75].map((f) => PAD + f * (H - PAD * 2)),
      ticks: [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(from + f * span)))],
    };
  }, [series, length, min, max, from, to]);

  if (!geometry) return null;

  /**
   * What the pointer is over: each series' value at that day, and how far it has moved from a
   * baseline — see `deltaMode`. Both figures are shown, because a delta alone next to a legend of
   * absolutes reads as a contradiction: a balance can be improving off its low while still being
   * deeply negative, and showing only the change made that look like a mistake.
   *
   * Zooming redefines the period, so the baseline re-bases to the selection.
   */
  const readout =
    hover != null && !drag
      ? {
          day: hover,
          x: geometry.xOf(hover),
          baselineLabel: deltaMode === 'peak' ? 'from peak' : `since ${dayLabel(from)}`,
          rows: series
            .map((s) => {
              const here = s.points[hover];
              if (here == null) return null;
              const window = s.points.slice(from, to + 1).filter((v) => v != null);
              if (!window.length) return null;
              const baseline = deltaMode === 'peak' ? Math.max(...window) : s.points[from];
              if (baseline == null) return null;
              return {
                id: s.id,
                label: s.label,
                colour: s.colour,
                depth: s.depth,
                value: here,
                delta: here - baseline,
              };
            })
            .filter(Boolean),
        }
      : null;

  const band =
    drag && Math.abs(drag.to - drag.from) > 0
      ? {
          x: Math.min(geometry.xOf(drag.from), geometry.xOf(drag.to)),
          w: Math.abs(geometry.xOf(drag.to) - geometry.xOf(drag.from)),
          days: Math.abs(drag.to - drag.from) + 1,
        }
      : null;

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') reset();
      }}
    >
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[210px] w-full touch-none select-none"
          style={{ cursor: drag ? 'ew-resize' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onPointerOut={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) onPointerLeave();
          }}
          onDoubleClick={reset}
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
                  strokeWidth={at(DEPTH_WIDTH, s.depth) * 0.9}
                  strokeDasharray="2 7"
                  strokeLinecap="round"
                  opacity={at(DEPTH_OPACITY, s.depth) * 0.55}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <path
                d={s.solid}
                fill="none"
                stroke={s.colour}
                strokeWidth={at(DEPTH_WIDTH, s.depth)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={at(DEPTH_OPACITY, s.depth)}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}

          {geometry.shapes
            .filter((s) => s.isCurrent && s.headVisible)
            .map((s) => (
              <g key={`head-${s.id}`}>
                <circle cx={s.headX} cy={s.headY} r="10" fill={s.colour} opacity="0.22" />
                <circle cx={s.headX} cy={s.headY} r="4.5" fill={s.colour} />
              </g>
            ))}

          {readout && (
            <g>
              <line
                x1={readout.x}
                x2={readout.x}
                y1="0"
                y2={H}
                stroke="rgba(255,255,255,0.28)"
                vectorEffect="non-scaling-stroke"
              />
              {readout.rows.map((r) => (
                <circle
                  key={r.id}
                  cx={readout.x}
                  cy={geometry.yOf(r.value)}
                  r="4"
                  fill={r.colour}
                  opacity={at(DEPTH_OPACITY, r.depth)}
                />
              ))}
            </g>
          )}

          {band && (
            <g>
              <rect x={band.x} y="0" width={band.w} height={H} fill="rgba(10,132,255,0.16)" />
              <line
                x1={band.x}
                x2={band.x}
                y1="0"
                y2={H}
                stroke="#0a84ff"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={band.x + band.w}
                x2={band.x + band.w}
                y1="0"
                y2={H}
                stroke="#0a84ff"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>

        {band && (
          <div className="glass-chip pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 text-[12px] text-label">
            {band.days} days
          </div>
        )}

        {readout && readout.rows.length > 0 && (
          <div
            className="glass pointer-events-none absolute top-2 z-10 min-w-[300px] rounded-[16px] p-3"
            style={{
              // Flip to the other side of the crosshair near the right edge, so the card never
              // hangs off the chart and covers what you are pointing at.
              left: `${(readout.x / W) * 100}%`,
              transform: readout.x / W > 0.62 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
            }}
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-[12px] font-medium text-label">{dayLabel(readout.day)}</span>
              <span className="text-[11px] text-label-3">{readout.baselineLabel}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {readout.rows.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span
                    className="block h-[3px] w-3.5 shrink-0 rounded-full"
                    style={{ background: r.colour, opacity: at(DEPTH_OPACITY, r.depth) }}
                  />
                  <span className="min-w-0 flex-grow truncate text-label-2">{r.label}</span>
                  <span className="num shrink-0 tabular-nums text-label">
                    {formatCurrency(r.value)}
                  </span>
                  <span
                    className={`num w-[86px] shrink-0 text-right font-semibold ${
                      r.delta >= 0 ? 'text-good' : 'text-bad'
                    }`}
                  >
                    {r.delta >= 0 ? '+' : '−'}
                    {formatCurrency(Math.abs(r.delta))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-1.5 text-[12px] text-label-3">
        {geometry.ticks.map((day) => (
          <span key={day}>{dayLabel(day)}</span>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-[12px] text-label-3">
        {zoomed ? (
          <button
            type="button"
            onClick={reset}
            className="glass-chip press flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-label-2 hover:text-label"
          >
            <X size={12} />
            {dayLabel(from)} – {dayLabel(to)} · reset
          </button>
        ) : (
          <span className="flex items-center gap-1.5">
            <Search size={12} />
            Drag across the chart to zoom in
          </span>
        )}
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
            style={{ background: s.colour, opacity: at(DEPTH_OPACITY, s.depth) }}
          />
          <span
            className={s.isCurrent ? 'font-medium text-label' : 'text-label-2'}
            style={{ opacity: s.isCurrent ? 1 : 0.82 }}
          >
            {s.label}
          </span>
          <span className={`num font-semibold ${tone ? tone(s) : 'text-label'}`}>
            {formatCurrency(s.total)}
          </span>
        </span>
      ))}
    </div>
  );
}
