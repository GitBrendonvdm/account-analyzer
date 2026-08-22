/**
 * A quiet label over a small numeric input, committed on blur and on Enter.
 *
 * PlanView's target column and the balances editor grew the same input independently — the same
 * class string, the same "Enter blurs, blur commits" wiring, the same `R` prefix — and the debt
 * and accounts views were about to add a dozen more. One component keeps the typing feel (the
 * parent sees every keystroke through `onChange`, nothing is saved until the field is left) and
 * the look (right-aligned tabular figures, a hairline border that warms to the info tone on
 * focus) in one place.
 *
 * Controlled when `onChange` is given: the parent owns the draft and `onCommit` receives it on
 * blur or Enter. Without `onChange` the input is uncontrolled — `value` seeds it and re-seeds it
 * whenever the parent's value changes — and `onCommit` receives whatever was typed. Either way the
 * commit hands back the raw string; parsing is the caller's business, because what a blank means
 * (clear the target, leave the rate alone) differs by field.
 */

const INPUT_CLASS =
  'rounded border px-2 py-1 text-right text-sm tabular-nums focus:border-info/30 focus:outline-none max-md:min-h-11 max-md:w-full max-md:min-w-0 max-md:text-base';

export function Field({
  label,
  value,
  onChange,
  onCommit,
  inputMode = 'decimal',
  suffix,
  prefix,
  width = 'w-24',
  type = 'text',
  placeholder,
  ariaLabel,
  disabled = false,
  className = '',
  ...rest
}) {
  const controlled = typeof onChange === 'function';
  const shown = value == null ? '' : String(value);
  const commit = (e) => onCommit?.(controlled ? shown : e.currentTarget.value);

  const input = (
    <input
      // A re-seed from the parent (a save landing, a statement upload) must replace what the
      // uncontrolled input shows; remounting on the seed is the only way to do that without state.
      key={controlled ? undefined : shown}
      type={type}
      inputMode={inputMode}
      value={controlled ? shown : undefined}
      defaultValue={controlled ? undefined : shown}
      onChange={controlled ? (e) => onChange(e.target.value) : undefined}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      placeholder={placeholder}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      className={`${width} ${INPUT_CLASS} disabled:opacity-50`}
      {...rest}
    />
  );

  return (
    <label className={`inline-flex flex-col gap-1.5 ${className}`}>
      {label && <span className="t-label">{label}</span>}
      <span className="flex items-center gap-1.5 max-md:w-full">
        {prefix && <span className="text-xs whitespace-nowrap text-label-3">{prefix}</span>}
        {input}
        {suffix && <span className="text-xs whitespace-nowrap text-label-3">{suffix}</span>}
      </span>
    </label>
  );
}
