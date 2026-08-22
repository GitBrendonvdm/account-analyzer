import { formatCurrency } from '../../utils/format';
import { RowIcon } from './RowIcon';
import { TRANSFER_MATCH_ICON } from './rowIcons';
import { WeekCells } from './WeekCells';
import { PIN_PLAIN } from './stickyColumn';

export function TransferMatchRow({ group, months, cycleWeeks }) {
  return (
    <tr className="border-t bg-transparent text-xs text-label-2">
      <td className={`p-2 pl-16 max-md:pl-8 ${PIN_PLAIN}`}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5">
            <RowIcon config={TRANSFER_MATCH_ICON} size={12} />
          </span>
          <div className="flex flex-col gap-0.5">
            {group.isReversal && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-warn">
                Reversed pair
              </span>
            )}
          <span className="text-good">
            <span className="text-label-3">+ </span>
            {group.creditLabel}
          </span>
          <span className="text-bad">
            <span className="text-label-3">− </span>
            {group.debitLabel}
          </span>
          </div>
        </div>
      </td>
      {months.map((m) => {
        const val = group.amountsByMonth[m];
        return (
          <td
            key={m}
            className={`p-2 text-right align-top ${
              m === months[months.length - 1] ? 'border-l-2 border-hair' : ''
            }`}
          >
            {val != null && Math.abs(val) > 0.001 ? (
              <span className="font-medium text-deep">{formatCurrency(Math.abs(val))}</span>
            ) : (
              ''
            )}
          </td>
        );
      })}
      <WeekCells weekly={undefined} weeks={cycleWeeks ?? []} pad="p-2" />
      <td />
      <td />
    </tr>
  );
}
