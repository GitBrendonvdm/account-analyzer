import { SlidersHorizontal } from 'lucide-react';

/**
 * The control that opens a row's corrections.
 *
 * It is an icon rather than a word because it sits inside a name cell that is already carrying a
 * chevron, a row icon, the description and sometimes a variant count — and it is deliberately not
 * an ✕ or a ⋯, both of which read as "close" or "more options" rather than "change what this is".
 * Quiet until hovered, so sixty of them down a column do not compete with the figures.
 */
export function EditToggle({ open, label, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={`Correct ${label}`}
      title={`Mark ${label} expected or unexpected, or move it to another category`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`press ml-1 inline-flex shrink-0 items-center justify-center rounded-full p-1 max-md:min-h-11 max-md:min-w-11 ${
        open ? 'bg-fill-2 text-info' : 'text-label-4 hover:text-label'
      }`}
    >
      <SlidersHorizontal size={12} />
    </button>
  );
}
