import { formatCurrency } from '../../utils/format';
import { NET_TOTAL_ICON, RowIcon } from './rowIcons';
import { WeekCells } from './WeekCells';

/**
 * On the dark row a plain white number gives no read on direction — a leading minus is the only
 * signal, and it's one glyph wide. These are the lighter 400 shades because the 600s used elsewhere
 * don't carry against slate-800.
 */
function NetAmount({ val }) {
  const v = val || 0;
  const tone = v > 0.01 ? 'text-green-400' : v < -0.01 ? 'text-red-400' : 'text-slate-400';
  return <span className={`tabular-nums ${tone}`}>{formatCurrency(v)}</span>;
}

export function NetTotalRow({ months, netByMonth, netExpected, netAvg, cycleWeeks, weeklyRemaining }) {
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
        return (
          <td
            key={m}
            className={`p-4 text-right ${isCurrentMonth ? 'border-l-2 border-slate-500' : ''}`}
            title={
              isCurrentMonth
                ? 'Income minus expenses so far this cycle — actual, like every other row in this column. Add "Left to payday" for the projected close.'
                : undefined
            }
          >
            {/* Actual, including the current cycle. This cell used to add the forecast on top, which
                put a projected number under the "Actual" header and stopped the row reconciling
                with the Income and Expense rows directly beneath it. */}
            <NetAmount val={netByMonth[i]} />
          </td>
        );
      })}
      <WeekCells weekly={weeklyRemaining} weeks={cycleWeeks ?? []} pad="p-4" signed />
      <td className="p-4 text-right">
        <NetAmount val={netExpected} />
      </td>
      <td className="p-4 text-right">
        <NetAmount val={netAvg} />
      </td>
    </tr>
  );
}
