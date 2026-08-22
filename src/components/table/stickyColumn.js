/**
 * The ledger's first column on a phone: pinned to the left edge while the month columns slide
 * under it, so a figure is never read without its row name.
 *
 * Everything is `max-md:` — above that the table fits its card, the column never moves, and the
 * desktop ledger keeps its translucent rows. A pinned cell needs its own ground (the cells passing
 * beneath would otherwise show through), and that ground replaces the row's tint, which lives on
 * the `<tr>`. So the tint is painted back over it as a background IMAGE: a flat gradient of the
 * same token, layered above the opaque colour, where a second background-colour could not be.
 *
 * The width is fixed and the text wraps inside it; a 320px phone has no room for a column that
 * grows to the longest description. 144px is the accounts grid's pinned width too, so the two
 * grids on the Ledger line up.
 */
const PIN =
  'max-md:sticky max-md:left-0 max-md:z-[1] max-md:w-36 max-md:min-w-36 max-md:max-w-36 max-md:whitespace-normal max-md:bg-[rgba(20,20,25,0.94)] max-md:backdrop-blur-md';

/** Rows with no tint of their own. */
export const PIN_PLAIN = PIN;
/** Rows tinted `bg-fill`: groups, spending groups, merchant rows. */
export const PIN_FILL = `${PIN} max-md:bg-[image:linear-gradient(var(--color-fill),var(--color-fill))]`;
/** The net total row, `bg-fill-2`. */
export const PIN_FILL_2 = `${PIN} max-md:bg-[image:linear-gradient(var(--color-fill-2),var(--color-fill-2))]`;
/** Exception and unmatched-transfer rows, the `bg-warn/10` flag. */
export const PIN_WARN = `${PIN} max-md:bg-[image:linear-gradient(color-mix(in_oklab,var(--color-warn)_10%,transparent),color-mix(in_oklab,var(--color-warn)_10%,transparent))]`;
