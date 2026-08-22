/* eslint-disable react-refresh/only-export-components -- A kit of hooks, reducers and small
   components that belong together; a change here reloading every chart that uses it is the right
   outcome, not a fast-refresh failure. */
import { useCallback, useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { Search, X } from 'lucide-react';
import { formatCurrency } from '../../utils/format';

/**
 * The interaction kit for the Recharts charts, so they behave like the hand-drawn ones.
 *
 * The Today view's cycle overlays set the bar: hover gives a crosshair and a readout of every
 * series, dragging across the plot zooms to that stretch, and a chip puts it back. The Recharts
 * charts were static and light-themed by default, and each one styled its own tooltip. Everything
 * those charts share lives here — the tooltip, the zoom gesture, legend toggles, the axis and grid
 * tokens — so a new chart gets the same behaviour by composition rather than by copying.
 *
 * Nothing in this file imports Recharts. The hooks produce plain handlers and values that a chart
 * spreads onto its own `<LineChart>` / `<ReferenceArea>`, which keeps the kit usable from the SVG
 * charts too (the cycle overlays borrow `useSeriesToggle`) and keeps the zoom logic testable as
 * pure functions under Node, where Recharts will not render.
 */

// ---- tokens ---------------------------------------------------------------------------------
// Recharts takes colours as props, not classes, so the Aurora tokens are repeated here as values.
// Kept in one place so the charts read the same and a re-tone is a one-file change.

export const LABEL = '#f5f5f7';
export const LABEL_3 = 'rgba(235,235,245,0.46)';
export const HAIRLINE = 'rgba(255,255,255,0.08)';
export const GOOD = '#30d158';
export const BAD = '#ff453a';
export const INFO = '#0a84ff';
export const DEEP = '#5e5ce6';

/** X axis: quiet ticks, no tick marks, a hairline baseline. */
export const axisStyle = {
  tick: { fontSize: 11, fill: LABEL_3 },
  tickLine: false,
  axisLine: { stroke: HAIRLINE },
};
/** Y axis: the same, without the line — the grid already draws the horizontals. */
export const yAxisStyle = { ...axisStyle, axisLine: false };
/** Horizontal hairlines only; verticals compete with the crosshair. */
export const gridStyle = { stroke: 'rgba(255,255,255,0.07)', vertical: false };
/**
 * The hover crosshair. On a line chart the cursor is a vertical line, on a bar chart a band across
 * the category; the same style gives a 1px line in the first case and a faintly lit band with
 * hairline edges in the second.
 */
export const cursorStyle = { stroke: 'rgba(255,255,255,0.22)', strokeWidth: 1, fill: 'rgba(255,255,255,0.04)' };
/** The drag selection, matching the band the cycle overlays draw. */
export const selectionStyle = { fill: 'rgba(10,132,255,0.16)', stroke: INFO, strokeWidth: 1 };

const compact = new Intl.NumberFormat('en-ZA', { notation: 'compact', maximumFractionDigits: 1 });
/** Y-axis tick formatter: R1.2M rather than 1200000. */
export const compactNumber = (v) => compact.format(v);

// ---- drag-to-zoom ---------------------------------------------------------------------------

/** Fewer than this and the drag was a click, not a selection. */
export const MIN_ZOOM_POINTS = 2;
export const ZOOM_IDLE = { range: null, drag: null };

/**
 * The zoom state machine, as a pure reducer.
 *
 *   range  {from,to} — the zoomed-in window, as indices into the FULL data; null = everything
 *   drag   {from,to} — the selection in progress, also absolute; null = pointer is up
 *
 * Indices carried by `down` and `move` are RELATIVE TO THE VISIBLE WINDOW, because that is all a
 * chart drawing the narrowed data can report. The reducer adds the window's offset, which is what
 * lets a zoom be made inside a zoom.
 *
 * A `down` with no index arms a drag without placing it (a touch start does not yet know which
 * point is under the finger); the first `move` with an index then anchors it. Releasing a drag that
 * spans fewer than MIN_ZOOM_POINTS leaves the range as it was.
 */
export function zoomReducer(state, action) {
  const offset = state.range?.from ?? 0;
  switch (action.type) {
    case 'down': {
      if (action.index == null) return { ...state, drag: { from: null, to: null } };
      const at = offset + action.index;
      return { ...state, drag: { from: at, to: at } };
    }
    case 'move': {
      if (!state.drag || action.index == null) return state;
      const at = offset + action.index;
      if (state.drag.from == null) return { ...state, drag: { from: at, to: at } };
      return { ...state, drag: { ...state.drag, to: at } };
    }
    case 'up': {
      if (!state.drag) return state;
      if (state.drag.from == null) return { ...state, drag: null };
      const lo = Math.min(state.drag.from, state.drag.to);
      const hi = Math.max(state.drag.from, state.drag.to);
      const range = hi - lo + 1 >= MIN_ZOOM_POINTS ? { from: lo, to: hi } : state.range;
      return { range, drag: null };
    }
    case 'reset':
      return ZOOM_IDLE;
    default:
      return state;
  }
}

/**
 * The rows a chart should draw for a range. Clamped to the data, and if clamping leaves too few
 * points to be a view at all, the whole series — a stale range must never blank a chart.
 */
export function visibleSlice(data, range) {
  if (!range || !data?.length) return data;
  const from = Math.max(0, Math.min(range.from, data.length - 1));
  const to = Math.max(from, Math.min(range.to, data.length - 1));
  if (to - from + 1 < MIN_ZOOM_POINTS) return data;
  return data.slice(from, to + 1);
}

/**
 * The selection to highlight while the pointer is down: the x values at either end (which is what
 * a ReferenceArea takes — domain values, not pixels) and how many points it spans. Null until the
 * drag covers enough to zoom, so the band appears exactly when releasing would do something.
 */
export function selectionOf(data, drag, xKey) {
  if (!drag || drag.from == null || !data?.length) return null;
  const lo = Math.max(0, Math.min(drag.from, drag.to));
  const hi = Math.min(data.length - 1, Math.max(drag.from, drag.to));
  if (hi - lo + 1 < MIN_ZOOM_POINTS) return null;
  return { x1: data[lo][xKey], x2: data[hi][xKey], from: lo, to: hi, count: hi - lo + 1 };
}

/** Recharts reports the active index as a string; anything that is not a number is "no point". */
function indexOf(next) {
  const raw = next?.activeTooltipIndex;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Drag-to-zoom for a Recharts chart.
 *
 *   const zoom = useZoomDomain(points, 'label');
 *   <LineChart data={zoom.visibleData} {...zoom.chartProps}>
 *     {zoom.selection && <ReferenceArea x1={zoom.selection.x1} x2={zoom.selection.x2} {...selectionStyle} />}
 *
 * `xKey` names the field the x-axis is keyed on; its values must be unique, because the selection
 * is handed back to Recharts as values rather than indices.
 *
 * The zoom belongs to the data it was made on: when `data` is replaced (a different account
 * selection, a different month range) the indices mean nothing, so the view resets rather than
 * showing an arbitrary slice of the new series.
 */
export function useZoomDomain(data, xKey) {
  const [state, dispatch] = useReducer(zoomReducer, ZOOM_IDLE);
  const [seen, setSeen] = useState(data);
  if (seen !== data) {
    setSeen(data);
    dispatch({ type: 'reset' });
  }

  const dragging = state.drag != null;

  // The release usually lands outside the plot — the eye runs ahead of the pointer — and Recharts
  // only reports mouse-ups on its own surface. Listen on the window while a drag is open.
  useEffect(() => {
    if (!dragging) return undefined;
    const up = () => dispatch({ type: 'up' });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging]);

  const onMouseDown = useCallback((next, e) => {
    if (e?.button != null && e.button !== 0) return;
    dispatch({ type: 'down', index: indexOf(next) });
  }, []);
  const onMouseMove = useCallback((next) => dispatch({ type: 'move', index: indexOf(next) }), []);
  const onMouseUp = useCallback(() => dispatch({ type: 'up' }), []);
  const onTouchStart = useCallback((next) => dispatch({ type: 'down', index: indexOf(next) }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const visibleData = visibleSlice(data, state.range);
  const selection = selectionOf(data, state.drag, xKey);

  return {
    visibleData,
    range: state.range,
    zoomed: state.range != null && visibleData !== data,
    dragging,
    selection,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onTouchStart,
    onTouchMove: onMouseMove,
    onTouchEnd: onMouseUp,
    reset,
    /** Everything the chart element itself needs, in one spread. */
    chartProps: {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onTouchStart,
      onTouchMove: onMouseMove,
      onTouchEnd: onMouseUp,
      onDoubleClick: reset,
    },
  };
}

// ---- series toggles -------------------------------------------------------------------------

/** Flip one key in a hidden set, without touching the set that was passed in. */
export function toggleKey(hidden, key) {
  const next = new Set(hidden);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Legend click hides and shows a series.
 *
 *   const toggles = useSeriesToggle(['actual', 'remaining']);
 *   <Line dataKey="actual" hide={toggles.isHidden('actual')} />
 *   <Legend content={<ChartLegend toggle={toggles.toggle} />} />         // buttons, aria-pressed
 *   <Legend {...toggles.legendProps} />                                   // or the stock legend
 *
 * Hidden series keep their legend entry, greyed, so the way back is where the way in was.
 */
export function useSeriesToggle(keys = []) {
  const [hidden, setHidden] = useState(() => new Set());
  const toggle = useCallback((key) => setHidden((h) => toggleKey(h, key)), []);
  const isHidden = useCallback((key) => hidden.has(key), [hidden]);
  return {
    hidden,
    toggle,
    isHidden,
    visibleKeys: keys.filter((k) => !hidden.has(k)),
    legendProps: {
      onClick: (entry) => toggle(entry.dataKey),
      formatter: (value, entry) => <span style={{ opacity: entry.inactive ? 0.35 : 1 }}>{value}</span>,
    },
  };
}

// ---- motion ---------------------------------------------------------------------------------

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
function subscribeReducedMotion(onChange) {
  if (!canQuery()) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const readReducedMotion = () => canQuery() && window.matchMedia(REDUCED_MOTION).matches;
const readReducedMotionOnServer = () => false;

/** True when the OS asks for less motion; pass `isAnimationActive={!reduced}` to the series. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, readReducedMotionOnServer);
}

// ---- components -----------------------------------------------------------------------------

/**
 * The box a chart sits in: its accessible summary, the pointer affordances for the zoom gesture,
 * Escape to reset, and the "n points" chip while a selection is being drawn.
 *
 * `touch-action: pan-y` rather than `none`: a horizontal drag is the zoom, a vertical one is still
 * the page scrolling. Taking both would make a tall chart a dead zone on a phone.
 */
export function ChartFrame({ label, zoom, unit = 'points', className = '', children }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`relative ${className}`}
      style={{
        touchAction: 'pan-y',
        userSelect: 'none',
        cursor: zoom?.dragging ? 'ew-resize' : 'crosshair',
      }}
      onKeyDown={
        zoom
          ? (e) => {
              if (e.key === 'Escape') zoom.reset();
            }
          : undefined
      }
    >
      {children}
      {zoom?.selection && (
        <div className="glass-chip pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 px-3 py-1.5 text-[12px] text-label">
          {zoom.selection.count} {unit}
        </div>
      )}
    </div>
  );
}

/**
 * The caption under a zoomable chart: the hint while at rest, a reset chip once zoomed. Pass
 * `hint={null}` to show nothing at rest, for a grid of small charts that share one hint.
 */
export function ZoomHint({ zoomed, onReset, label, hint = 'Drag across the chart to zoom in', className = '' }) {
  if (!zoomed && !hint) return null;
  return (
    <div className={`flex items-center gap-2 text-[12px] text-label-3 ${className}`}>
      {zoomed ? (
        <button
          type="button"
          onClick={onReset}
          className="glass-chip press flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-label-2 hover:text-label"
        >
          <X size={12} />
          Reset zoom
          {label && <span className="text-label-3">· {label}</span>}
        </button>
      ) : (
        <span className="flex items-center gap-1.5">
          <Search size={12} />
          {hint}
        </span>
      )}
    </div>
  );
}

/** A legend swatch: a short line for a line series, a square for a bar. */
function Swatch({ type, colour }) {
  const isBar = type === 'rect' || type === 'square';
  return (
    <span
      aria-hidden
      className={`block shrink-0 ${isBar ? 'h-2.5 w-2.5 rounded-[3px]' : 'h-[3px] w-3.5 rounded-full'}`}
      style={{ background: colour }}
    />
  );
}

/**
 * Legend content for `<Legend content={<ChartLegend … />} />`.
 *
 * Recharts' stock legend is a list of spans with a click handler, which a keyboard cannot reach.
 * These are buttons: focusable, `aria-pressed` while the series is shown, 35% when it is not.
 * `swatch` overrides the colour per data key, for a series whose bars are coloured per value or
 * whose line is dashed — the legend should look like the thing it names.
 */
export function ChartLegend({ payload = [], toggle, isHidden, swatch = {}, className = '' }) {
  if (!payload.length) return null;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-3 text-[12.5px] ${className}`}>
      {payload.map((entry) => {
        const key = entry.dataKey ?? entry.value;
        const off = entry.inactive || (isHidden ? isHidden(key) : false);
        const colour = swatch[key] ?? entry.color;
        const body = (
          <>
            <Swatch type={entry.type} colour={colour} />
            <span className={off ? 'text-label-2' : 'text-label'}>{entry.value}</span>
          </>
        );
        if (!toggle) {
          return (
            <span key={key} className="flex items-center gap-2">
              {body}
            </span>
          );
        }
        return (
          <button
            key={key}
            type="button"
            aria-pressed={!off}
            onClick={() => toggle(key)}
            className="press flex items-center gap-2 rounded-full px-1.5 py-0.5 hover:bg-fill"
            style={{ opacity: off ? 0.35 : 1 }}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tooltip content for `<Tooltip content={<ChartTooltip … />} />`.
 *
 * A glass card with the x label, then one row per series: swatch, name, value. `deltaFrom` is a
 * data row — usually the first visible one — and adds a column of change since it, which is the
 * reading a cumulative chart is for: zoom to a fortnight and the delta IS that fortnight's net.
 *
 *   labelKey     read the title from the row rather than the axis value (an axis keyed on an id)
 *   filterEntry  (entry, row) => bool, to drop a series that is meaningless for this row
 *   colorOf      (entry, row) => colour, for a series whose colour depends on the value
 *   footer       (row) => node, rendered under a hairline for a row that has more to say
 */
export function ChartTooltip({
  active,
  payload,
  label,
  deltaFrom,
  labelKey = 'label',
  filterEntry,
  colorOf,
  footer,
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const rows = payload.filter((e) => e.value != null && (!filterEntry || filterEntry(e, row)));
  const extra = footer?.(row);
  if (!rows.length && !extra) return null;

  return (
    <div
      className="num min-w-[200px] text-[12px]"
      style={{
        background: 'rgba(22,22,28,0.92)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        padding: '10px 12px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.32)',
      }}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        <span className="font-medium text-label">{row?.[labelKey] ?? label}</span>
        {deltaFrom && deltaFrom !== row && (
          <span className="text-[11px] text-label-3">since {deltaFrom[labelKey]}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((e) => {
          const base = deltaFrom && deltaFrom !== row ? deltaFrom[e.dataKey] : null;
          const delta = base != null ? e.value - base : null;
          return (
            <div key={e.dataKey ?? e.name} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="block h-[3px] w-3.5 shrink-0 rounded-full"
                style={{ background: colorOf?.(e, row) ?? e.color }}
              />
              <span className="min-w-0 flex-grow truncate text-label-2">{e.name}</span>
              <span className="shrink-0 text-label">{formatCurrency(e.value)}</span>
              {delta != null && (
                <span className={`w-[86px] shrink-0 text-right font-semibold ${delta >= 0 ? 'text-good' : 'text-bad'}`}>
                  {delta >= 0 ? '+' : '−'}
                  {formatCurrency(Math.abs(delta))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {extra && <div className="mt-2 border-t border-hair pt-2 text-label-2">{extra}</div>}
    </div>
  );
}
