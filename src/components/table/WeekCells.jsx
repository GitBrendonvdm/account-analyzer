import { formatCurrency, formatCurrencyAbs } from '../../utils/format';

/**
 * Renders one <td> per cycle-week (the"Remaining, split by week" columns). `weekly` is a
 * per-week remaining array aligned to `weeks`; rows without a weekly split (transfers, exceptions,
 * drill-down rows) pass nothing and get muted placeholders so the columns stay aligned.
 *
 * Category rows are single-direction, so their magnitude reads fine on its own. `signed` is for the
 * net row, where the week can go either way and an unsigned figure hides which.
 */
export function WeekCells({ weekly, weeks, pad = 'p-3', signed = false }) {
  return (
    <>
      {weeks.map((wk, i) => {
        const val = weekly?.[wk.index];
        const show = val != null && Math.abs(val) > 0.001;
        return (
          <td
            key={wk.index}
            className={`${pad} text-right ${wk.isCurrent ? 'bg-info/15' : 'bg-info/8'} ${
              i === 0 ? 'border-l-2 border-info/30' : ''
            }`}
          >
            {show ? (
              <span
                className={`tabular-nums ${
                  signed ? (val > 0 ? 'text-good' : 'text-bad') : 'text-info'
                }`}
              >
                {signed ? formatCurrency(val) : formatCurrencyAbs(val)}
              </span>
            ) : (
              <span className="text-label-4">–</span>
            )}
          </td>
        );
      })}
    </>
  );
}
