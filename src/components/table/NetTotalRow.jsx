import { formatCurrency } from '../../utils/format';
import { NET_TOTAL_ICON, RowIcon } from './rowIcons';

export function NetTotalRow({ months, netByMonth, netExpected, netAvg }) {
  return (
    <tr className="bg-slate-800 font-bold text-white">
      <td className="p-4">
        <span className="flex items-center gap-2">
          <RowIcon config={NET_TOTAL_ICON} size={16} />
          Net Total
        </span>
      </td>
      {months.map((m, i) => {
        const isCurrentMonth = i === months.length - 1;
        const val = isCurrentMonth ? netByMonth[i] + netExpected : netByMonth[i];
        return (
          <td
            key={m}
            className={`p-4 text-right ${isCurrentMonth ? 'border-l-2 border-slate-500' : ''}`}
          >
            {formatCurrency(val)}
          </td>
        );
      })}
      <td className="p-4 text-right">{formatCurrency(netExpected)}</td>
      <td className="p-4 text-right">{formatCurrency(netAvg)}</td>
    </tr>
  );
}
