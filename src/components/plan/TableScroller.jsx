import { ArrowLeftRight } from 'lucide-react';

/**
 * A wide table inside a card, on a phone.
 *
 * The Plan tables are six to eleven columns and every column earns its place — the whole point of
 * the standing-charges table is that it hides nothing. On a 360px screen that means the table has
 * to scroll sideways inside its card, and three things make that usable rather than merely
 * possible: a caption saying it scrolls (an overflow-x container gives no visual cue at all until
 * the first accidental swipe), the row's label staying put while the figures slide under it (so a
 * number is never read without knowing whose it is), and the scroll being contained (so the swipe
 * that reaches the end does not turn into the browser's back gesture).
 *
 * Every class is behind `max-md:`, because at desktop widths the tables fit and none of this is
 * wanted — the sticky cell's backing would otherwise tint the first column of every table.
 */

/** Put on the first `th`/`td` of each row. The backing is the sticky-head material, opaque enough
 *  that the columns scrolling beneath do not show through the label. */
export const STICKY_CELL =
  'max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-[rgba(18,18,23,0.96)] max-md:shadow-[10px_0_14px_-10px_rgba(0,0,0,0.7)]';

export function TableScroller({ children, hint = 'Swipe sideways for the other columns', className = '' }) {
  return (
    <>
      <p className="t-caption flex items-center gap-1.5 px-4 pt-3 md:hidden">
        <ArrowLeftRight size={13} aria-hidden />
        {hint}
      </p>
      <div className={`overflow-x-auto overscroll-x-contain ${className}`}>{children}</div>
    </>
  );
}
