import { formatCurrency } from '../../utils/format';
import { RowIcon } from './RowIcon';
import { TRANSFER_MATCH_ICON } from './rowIcons';
import { WeekCells } from './WeekCells';

export function TransferMatchRow({ group, months, cycleWeeks }) {
  return (
    <tr className="border-t bg-white text-xs text-slate-600">
      <td className="p-2 pl-16">
        <div className="flex items-start gap-2">
          <span className="mt-0.5">
            <RowIcon config={TRANSFER_MATCH_ICON} size={12} />
          </span>
          <div className="flex flex-col gap-0.5">
            {group.isReversal && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">
                Reversed pair
              </span>
            )}
          <span className="text-green-700">
            <span className="text-slate-400">+ </span>
            {group.creditLabel}
          </span>
          <span className="text-red-700">
            <span className="text-slate-400">− </span>
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
              m === months[months.length - 1] ? 'border-l-2 border-slate-300' : ''
            }`}
          >
            {val != null && Math.abs(val) > 0.001 ? (
              <span className="font-medium text-violet-700">{formatCurrency(Math.abs(val))}</span>
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
