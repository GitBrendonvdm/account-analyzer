import { formatCurrencyAbs } from '../../utils/format';

/**
 * Renders one <td> per cycle-week (the "Remaining, split by week" columns). `weekly` is a
 * per-week remaining array aligned to `weeks`; rows without a weekly split (transfers, exceptions,
 * drill-down rows) pass nothing and get muted placeholders so the columns stay aligned.
 */
export function WeekCells({ weekly, weeks, pad = 'p-3' }) {
  return (
    <>
      {weeks.map((wk, i) => {
        const val = weekly?.[wk.index];
        const show = val != null && Math.abs(val) > 0.001;
        return (
          <td
            key={wk.index}
            className={`${pad} text-right ${wk.isCurrent ? 'bg-blue-100/50' : 'bg-blue-50/40'} ${
              i === 0 ? 'border-l-2 border-blue-200' : ''
            }`}
          >
            {show ? (
              <span className="tabular-nums text-blue-600">{formatCurrencyAbs(val)}</span>
            ) : (
              <span className="text-slate-300">–</span>
            )}
          </td>
        );
      })}
    </>
  );
}
