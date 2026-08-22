import { describe, expect, it } from 'vitest';
import {
  MIN_ZOOM_POINTS,
  ZOOM_IDLE,
  selectionOf,
  toggleKey,
  visibleSlice,
  zoomReducer,
} from './interactive';

const run = (actions, start = ZOOM_IDLE) => actions.reduce(zoomReducer, start);
const data = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((label, i) => ({ label, value: i * 10 }));

describe('zoomReducer', () => {
  it('narrows to the dragged span on release', () => {
    const s = run([{ type: 'down', index: 2 }, { type: 'move', index: 5 }, { type: 'up' }]);
    expect(s).toEqual({ range: { from: 2, to: 5 }, drag: null, pinned: false });
  });

  it('treats a drag from right to left the same as one from left to right', () => {
    const s = run([{ type: 'down', index: 5 }, { type: 'move', index: 3 }, { type: 'move', index: 2 }, { type: 'up' }]);
    expect(s.range).toEqual({ from: 2, to: 5 });
  });

  it('ignores a click — one point is not a selection', () => {
    expect(MIN_ZOOM_POINTS).toBe(2);
    expect(run([{ type: 'down', index: 3 }, { type: 'up' }]).range).toBeNull();
    expect(run([{ type: 'down', index: 3 }, { type: 'move', index: 3 }, { type: 'up' }]).range).toBeNull();
  });

  it('accepts the smallest real selection, two adjacent points', () => {
    const s = run([{ type: 'down', index: 3 }, { type: 'move', index: 4 }, { type: 'up' }]);
    expect(s.range).toEqual({ from: 3, to: 4 });
  });

  it('keeps the existing zoom when a click happens inside it', () => {
    const zoomed = { range: { from: 2, to: 5 }, drag: null, pinned: false };
    const s = run([{ type: 'down', index: 1 }, { type: 'up' }], zoomed);
    expect(s).toEqual({ ...zoomed, pinned: true });
  });

  it('pins the readout on a release that did not move — a tap, placed or not', () => {
    // A mouse click lands on a point; a touch start arms the drag without one.
    expect(run([{ type: 'down', index: 3 }, { type: 'up' }])).toEqual({ ...ZOOM_IDLE, pinned: true });
    expect(run([{ type: 'down', index: null }, { type: 'up' }])).toEqual({ ...ZOOM_IDLE, pinned: true });
    // Moving within the same point is still a tap.
    expect(run([{ type: 'down', index: 3 }, { type: 'move', index: 3 }, { type: 'up' }]).pinned).toBe(true);
  });

  it('unpins the readout on a release that zoomed, and on reset', () => {
    const pinned = { range: null, drag: null, pinned: true };
    const zoomed = run([{ type: 'down', index: 2 }, { type: 'move', index: 5 }, { type: 'up' }], pinned);
    expect(zoomed).toEqual({ range: { from: 2, to: 5 }, drag: null, pinned: false });
    expect(zoomReducer(pinned, { type: 'reset' })).toBe(ZOOM_IDLE);
  });

  it('leaves the pin alone while a drag is open and when it is cancelled', () => {
    const pinned = { range: null, drag: null, pinned: true };
    const midDrag = run([{ type: 'down', index: null }, { type: 'move', index: 2 }, { type: 'move', index: 4 }], pinned);
    expect(midDrag.pinned).toBe(true);
    expect(zoomReducer(midDrag, { type: 'cancel' })).toEqual(pinned);
  });

  it('offsets a drag made inside a zoom by the window it was made in', () => {
    // Visible indices 1..2 of a window starting at 2 are absolute 3..4.
    const zoomed = { range: { from: 2, to: 5 }, drag: null };
    const s = run([{ type: 'down', index: 1 }, { type: 'move', index: 2 }, { type: 'up' }], zoomed);
    expect(s.range).toEqual({ from: 3, to: 4 });
  });

  it('restores everything on reset', () => {
    const zoomed = run([{ type: 'down', index: 2 }, { type: 'move', index: 5 }, { type: 'up' }]);
    expect(zoomReducer(zoomed, { type: 'reset' })).toBe(ZOOM_IDLE);
    const midDrag = run([{ type: 'down', index: 2 }, { type: 'move', index: 3 }]);
    expect(zoomReducer(midDrag, { type: 'reset' })).toBe(ZOOM_IDLE);
  });

  it('does nothing for a move or release with no drag open', () => {
    expect(zoomReducer(ZOOM_IDLE, { type: 'move', index: 4 })).toBe(ZOOM_IDLE);
    expect(zoomReducer(ZOOM_IDLE, { type: 'up' })).toBe(ZOOM_IDLE);
  });

  it('holds the drag still while the pointer is off the points', () => {
    const s = run([{ type: 'down', index: 2 }, { type: 'move', index: null }]);
    expect(s.drag).toEqual({ from: 2, to: 2 });
  });

  it('arms a drag from a touch start and anchors it on the first point reported', () => {
    const armed = zoomReducer(ZOOM_IDLE, { type: 'down', index: null });
    expect(armed.drag).toEqual({ from: null, to: null });
    // Lifting an armed-but-unplaced finger is a tap: no zoom.
    expect(zoomReducer(armed, { type: 'up' })).toEqual({ ...ZOOM_IDLE, pinned: true });
    const s = run([{ type: 'move', index: 4 }, { type: 'move', index: 6 }, { type: 'up' }], armed);
    expect(s.range).toEqual({ from: 4, to: 6 });
  });

  it('abandons a drag on cancel without zooming — the browser took the touch for a scroll', () => {
    const midDrag = run([{ type: 'down', index: 2 }, { type: 'move', index: 5 }]);
    expect(zoomReducer(midDrag, { type: 'cancel' })).toEqual(ZOOM_IDLE);
    const zoomed = { range: { from: 2, to: 5 }, drag: null };
    const insideZoom = run([{ type: 'down', index: 0 }, { type: 'move', index: 2 }], zoomed);
    expect(zoomReducer(insideZoom, { type: 'cancel' })).toEqual(zoomed);
    expect(zoomReducer(zoomed, { type: 'cancel' })).toBe(zoomed);
  });

  it('returns the same state object for an unknown action', () => {
    const state = { range: { from: 1, to: 3 }, drag: null };
    expect(zoomReducer(state, { type: 'wheel' })).toBe(state);
  });
});

describe('visibleSlice', () => {
  it('returns the data itself when there is no range', () => {
    expect(visibleSlice(data, null)).toBe(data);
  });

  it('slices inclusively', () => {
    expect(visibleSlice(data, { from: 2, to: 4 }).map((d) => d.label)).toEqual(['c', 'd', 'e']);
  });

  it('clamps a range that outlives its data', () => {
    expect(visibleSlice(data, { from: 6, to: 20 }).map((d) => d.label)).toEqual(['g', 'h']);
  });

  it('falls back to everything when clamping leaves too little to draw', () => {
    expect(visibleSlice(data, { from: 7, to: 20 })).toBe(data);
    expect(visibleSlice(data, { from: 40, to: 50 })).toBe(data);
  });

  it('survives empty data', () => {
    expect(visibleSlice([], { from: 0, to: 3 })).toEqual([]);
    expect(visibleSlice(undefined, { from: 0, to: 3 })).toBeUndefined();
  });
});

describe('selectionOf', () => {
  it('is nothing until the drag spans enough to zoom', () => {
    expect(selectionOf(data, null, 'label')).toBeNull();
    expect(selectionOf(data, { from: null, to: null }, 'label')).toBeNull();
    expect(selectionOf(data, { from: 3, to: 3 }, 'label')).toBeNull();
  });

  it('hands back x values in axis order, whichever way the drag went', () => {
    expect(selectionOf(data, { from: 5, to: 2 }, 'label')).toEqual({ x1: 'c', x2: 'f', from: 2, to: 5, count: 4 });
    expect(selectionOf(data, { from: 2, to: 5 }, 'label')).toEqual({ x1: 'c', x2: 'f', from: 2, to: 5, count: 4 });
  });

  it('clamps to the data it is drawn over', () => {
    expect(selectionOf(data, { from: 6, to: 30 }, 'label')).toEqual({ x1: 'g', x2: 'h', from: 6, to: 7, count: 2 });
  });
});

describe('toggleKey', () => {
  it('hides a shown series and shows a hidden one', () => {
    const hidden = toggleKey(new Set(), 'actual');
    expect([...hidden]).toEqual(['actual']);
    expect([...toggleKey(hidden, 'actual')]).toEqual([]);
  });

  it('leaves other keys alone and never mutates its input', () => {
    const before = new Set(['remaining']);
    const after = toggleKey(before, 'actual');
    expect([...before]).toEqual(['remaining']);
    expect([...after].sort()).toEqual(['actual', 'remaining']);
    expect(after).not.toBe(before);
  });
});
