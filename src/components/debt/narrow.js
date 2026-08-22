import { useSyncExternalStore } from 'react';

/**
 * Is the viewport narrower than Tailwind's `md` (48rem)? The same line the `max-md:` classes draw.
 *
 * The Recharts charts need a JS answer to the question the CSS already answers: below `md` the
 * legend is drawn OUTSIDE the chart frame (two 44px-tall rows inside it would halve the plot) and
 * the payoff pins drop their labels (four of them collide across a 300px plot). A media query
 * rather than a resize observer, so it flips exactly where the stylesheet flips.
 */

const NARROW = '(max-width: 47.99rem)';
const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
function subscribe(onChange) {
  if (!canQuery()) return () => {};
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const read = () => canQuery() && window.matchMedia(NARROW).matches;
const readOnServer = () => false;

export function useNarrowViewport() {
  return useSyncExternalStore(subscribe, read, readOnServer);
}

/** The kit's legend and reset chips are mouse-sized; on a phone each needs to be a thumb tall. */
export const LEGEND_TAP = 'max-md:[&_button]:min-h-11';
