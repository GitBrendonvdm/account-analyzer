import { formatCurrency, formatCurrencyAbs } from '../../utils/format';

/**
 * `neutral` is for amounts that aren't a flow — transfer volume moved between the user's own
 * accounts. Green would read as income arriving when nothing was earned.
 */
export function Cell({ val, absolute = false, highlight = false, neutral = false }) {
  const flowColor = val > 0.01 ? 'text-good' : val < -0.01 ? 'text-bad' : 'text-label-3';
  return (
    <span
      className={`tabular-nums ${
        neutral ? (Math.abs(val || 0) > 0.01 ? 'text-label-2' : 'text-label-3') : flowColor
      } ${
        highlight && Math.abs(val || 0) > 0.001
          ? 'rounded bg-amber-100 px-1.5 py-0.5 ring-1 ring-amber-300'
          : ''
      }`}
    >
      {absolute ? formatCurrencyAbs(val) : formatCurrency(val)}
    </span>
  );
}
