import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatCurrencyAbs } from '../../utils/format';
import { sortTableItems } from '../../lib/tableSort';
import { Cell } from './Cell';
import { RowIcon } from './RowIcon';
import { getSpendingGroupIconConfig } from './rowIcons';
import { TableSubcategory } from './TableSubcategory';
import { WeekCells } from './WeekCells';

/**
 * The Spending Group level — the export's own taxonomy sitting between a flow and its categories.
 * It carries no model of its own: every figure here is the sum of the categories beneath it.
 */
export function TableSpendingGroup({ sub, months, parentGroup, sort, cycleWeeks }) {
  const [expanded, setExpanded] = useState(false);
  const sortedCategories = sortTableItems(sub.sub ?? [], sort);
  const icon = getSpendingGroupIconConfig(sub.name);

  return (
    <>
      <tr
        className="cursor-pointer border-t bg-slate-50 font-medium text-slate-700 hover:bg-slate-100"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3 pl-8">
          <span className="flex items-center gap-2">
            <ChevronRight size={14} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            <RowIcon config={icon} size={14} />
            {sub.name}
            <span className="text-[10px] font-normal text-slate-400">
              {sortedCategories.length}
            </span>
          </span>
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`p-3 text-right ${
              m === months[months.length - 1] ? 'border-l-2 border-slate-300' : ''
            }`}
          >
            <Cell val={sub.totalsByMonth[m]} absolute />
          </td>
        ))}
        <WeekCells
          weekly={sub.skipExpected ? undefined : sub.weeklyRemaining}
          weeks={cycleWeeks ?? []}
        />
        <td className="p-3 text-right font-semibold text-blue-600">
          {sub.skipExpected ? '' : formatCurrencyAbs(sub.expected)}
        </td>
        <td className="p-3 text-right">
          <Cell val={sub.avg} absolute />
        </td>
      </tr>
      {expanded &&
        sortedCategories.map((c) => (
          <TableSubcategory
            key={c.key ?? c.name}
            sub={c}
            months={months}
            parentGroup={parentGroup}
            sort={sort}
            cycleWeeks={cycleWeeks}
          />
        ))}
    </>
  );
}
