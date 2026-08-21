import { formatCurrency } from '../../utils/format';
import { RowIcon } from './RowIcon';
import { VARIANT_ICON } from './rowIcons';
import { WeekCells } from './WeekCells';

export function VariantTransactionRow({ variant, months, cycleWeeks }) {
  return (
    <tr className="border-t bg-transparent text-[11px] text-label-2">
      <td className="p-1.5 pl-28">
        <span className="flex items-center gap-1.5">
          <RowIcon config={VARIANT_ICON} size={11} />
          {variant.description}
        </span>
      </td>
      {months.map((m) => {
        const val = variant.amountsByMonth[m];
        return (
          <td
            key={m}
            className={`p-1.5 text-right ${
              m === months[months.length - 1] ? 'border-l-2 border-hair' : ''
            }`}
          >
            {val != null && Math.abs(val) > 0.001 ? (
              <span
                className={val > 0 ? 'text-good' : 'text-bad'}
                title={variant.datesByMonth[m]}
              >
                {formatCurrency(val)}
              </span>
            ) : (
              ''
            )}
          </td>
        );
      })}
      <WeekCells weekly={undefined} weeks={cycleWeeks ?? []} pad="p-1.5" />
      <td />
      <td />
    </tr>
  );
}
