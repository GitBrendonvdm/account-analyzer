import { useCallback, useRef, useState } from 'react';

/**
 * The pointer gesture the hand-drawn Today charts share: hover for a readout, drag across the
 * plot to zoom to a span of days, double-click or Escape to put it back.
 *
 * One hook, because the spend curve, the balances and the cash path all drew it themselves and
 * the touch behaviour below is fiddly enough that three copies would drift.
 *
 * TOUCH. The SVG declares `touch-action: pan-y`, so a vertical swipe stays the page scrolling —
 * a full-width chart on a phone must not be a dead zone between the cards above and below it.
 * That means a finger going down is not yet a drag: the gesture is held as PENDING until it has
 * moved far enough to show its direction. Mostly sideways and it becomes the zoom selection, with
 * the pointer captured from that moment so the drag survives leaving the plot; mostly vertical
 * and it is abandoned, because the browser is about to take it for the scroll (it fires
 * pointercancel when it does, which also has to discard, not commit, whatever was in progress —
 * a cancelled gesture zooming the chart is exactly the surprise the rule exists to prevent).
 *
 * A tap with no movement pins the readout on that day, since there is no hover on a phone; a tap
 * on the same day again clears it. The mouse path is unchanged: the drag starts on the button
 * going down and the readout follows the pointer.
 */

/** Below this the drag was a click, not a selection. */
export const MIN_SPAN_DAYS = 2;
/** How far a finger moves before a touch is read as a drag rather than a tap. */
const TOUCH_SLOP = 8;

export function useSpanDrag({ svgRef, length }) {
  const [range, setRange] = useState(null); // {from,to} in days; null = the whole span
  const [drag, setDrag] = useState(null); // {from,to} while a selection is being drawn
  const [hover, setHover] = useState(null); // day index under the pointer, or pinned by a tap
  const pending = useRef(null); // a touch whose direction is not yet known
  const pinned = useRef(null); // the day a tap pinned the readout on, if any

  const from = range?.from ?? 0;
  const to = range?.to ?? Math.max(0, length - 1);
  const zoomed = range != null;

  /** Where the pointer is, in days. Linear, because the viewBox does not preserve aspect ratio. */
  const dayAt = useCallback(
    (clientX) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return from;
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(from + t * (to - from));
    },
    [svgRef, from, to],
  );

  const onPointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button !== 0) return;
      const day = dayAt(e.clientX);
      if (e.pointerType === 'touch') {
        pending.current = { x: e.clientX, y: e.clientY, day, id: e.pointerId };
        setHover(day);
        return;
      }
      pinned.current = null;
      // Capture, so the drag survives the pointer leaving the chart's bounds.
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: day, to: day });
    },
    [dayAt],
  );

  const onPointerMove = useCallback(
    (e) => {
      const day = dayAt(e.clientX);
      const p = pending.current;
      if (p) {
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (Math.abs(dx) < TOUCH_SLOP && Math.abs(dy) < TOUCH_SLOP) return;
        pending.current = null;
        if (Math.abs(dy) > Math.abs(dx)) {
          // A scroll. The readout it would leave behind is a finger-shaped accident, so clear it.
          setHover(null);
          return;
        }
        pinned.current = null;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ from: p.day, to: day });
      } else if (e.pointerType === 'touch' && !drag) {
        // A finger that was abandoned to a scroll, still reporting: nothing to follow.
        return;
      }
      setHover(day);
      setDrag((d) => (d ? { ...d, to: day } : d));
    },
    [dayAt, drag],
  );

  const onPointerUp = useCallback((e) => {
    const p = pending.current;
    pending.current = null;
    if (p) {
      // A tap: pin the readout there, or clear it if it was already pinned on that day.
      const same = pinned.current === p.day;
      pinned.current = same ? null : p.day;
      setHover(same ? null : p.day);
      return;
    }
    setDrag((d) => {
      if (!d) return null;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      // A tap is not a selection — leave the view alone rather than zooming to a sliver.
      if (hi - lo >= MIN_SPAN_DAYS) setRange({ from: lo, to: hi });
      return null;
    });
    if (e?.pointerType === 'touch') setHover(null);
  }, []);

  /** The browser took the gesture (a scroll, a system edge swipe): discard, never commit. */
  const onPointerCancel = useCallback(() => {
    pending.current = null;
    setDrag(null);
    setHover(null);
  }, []);

  // Both leave and out: pointerleave does not bubble, so React delegates it through pointerout,
  // and a pointer lifted outside the plot can otherwise leave the crosshair stranded. A pinned
  // readout stays, because a finger always "leaves" the moment it lifts.
  const onPointerLeave = useCallback(() => {
    if (pinned.current == null) setHover(null);
  }, []);

  const reset = useCallback(() => {
    setRange(null);
    setDrag(null);
  }, []);

  return {
    range,
    drag,
    hover,
    from,
    to,
    zoomed,
    reset,
    /** Everything the SVG element needs, in one spread. */
    svgProps: {
      className: 'chart-frame block w-full touch-pan-y select-none',
      style: { cursor: drag ? 'ew-resize' : 'crosshair' },
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onPointerOut: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onPointerLeave();
      },
      onDoubleClick: reset,
    },
    /** For the wrapper around the plot: Escape resets the zoom. */
    frameProps: {
      onKeyDown: (e) => {
        if (e.key === 'Escape') reset();
      },
    },
  };
}

/**
 * Where the hover readout card goes. On a phone the card is as wide as the chart and sits across
 * its top, so it can never hang off the screen; from `sm` up it floats beside the crosshair and
 * flips to the other side near the right edge, so it never covers what you are pointing at. The
 * two custom properties carry the desktop placement into the `sm:` classes.
 */
export const READOUT_CLASS =
  'glass pointer-events-none absolute inset-x-0 top-2 z-10 rounded-[16px] p-3 sm:right-auto sm:left-(--readout-left) sm:translate-x-(--readout-shift)';
export const readoutStyle = (fraction) => ({
  '--readout-left': `${fraction * 100}%`,
  '--readout-shift': fraction > 0.62 ? 'calc(-100% - 14px)' : '14px',
});
