import { formatCurrency, formatCurrencyAbs } from '../../utils/format';

export function Cell({ val, absolute = false, highlight = false }) {
  return (
    <span
      className={`tabular-nums ${
        val > 0.01 ? 'text-green-600' : val < -0.01 ? 'text-red-600' : 'text-slate-400'
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
