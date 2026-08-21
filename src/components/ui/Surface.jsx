/**
 * The material vocabulary, in three weights.
 *
 * Surfaces are translucent so that the colour on the ground shows through and does the work of
 * separating regions — the borders are a lip catching light, not the structure. Weight encodes
 * hierarchy: a Card is a big surface and reads thicker (more blur, deeper shadow) than a Tile,
 * which reads thicker than a Chip. Never nest one of these directly inside another; stacking
 * translucency on translucency turns both to mud.
 */

export function Card({ className = '', children, ...rest }) {
  return (
    <section className={`glass ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function Tile({ className = '', children, ...rest }) {
  return (
    <div className={`glass-tile ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Chip({ className = '', children, ...rest }) {
  return (
    <span className={`glass-chip inline-flex items-center gap-2 px-4 py-2 text-[13px] ${className}`} {...rest}>
      {children}
    </span>
  );
}

/** A card's heading row: title left, anything you like right. */
export function CardHead({ title, subtitle, right, className = '' }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="t-head">{title}</h2>
        {subtitle && <p className="t-label mt-1.5 max-w-prose">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/**
 * A labelled figure. The label is quiet, the number is not — hierarchy comes from weight and size
 * rather than from a box around each one.
 */
export function Figure({ label, value, tone = 'text-label', note, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="t-label">{label}</div>
      <div className={`t-title num mt-2 truncate ${tone}`}>{value}</div>
      {note && <div className="t-caption mt-1.5">{note}</div>}
    </div>
  );
}
