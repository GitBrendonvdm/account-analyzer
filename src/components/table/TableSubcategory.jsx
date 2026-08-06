import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatCurrencyAbs } from '../../utils/format';
import { useGroupedTransactions } from '../../hooks/useGroupedTransactions';
import { sortTableItems } from '../../lib/tableSort';
import { Cell } from './Cell';
import { GroupedTransactionRow } from './GroupedTransactionRow';
import { getSubcategoryIconConfig, RowIcon } from './rowIcons';
import { WeekCells } from './WeekCells';

export function TableSubcategory({ sub, months, parentGroup, sort, cycleWeeks }) {
  const [expanded, setExpanded] = useState(false);
  // The parent's forecast is split across these rows, so the tree adds up.
  const groupedItems = useGroupedTransactions(sub.items, months, sub.skipExpected, sub);
  const sortedGroupedItems = sortTableItems(groupedItems, sort);
  const subIcon = getSubcategoryIconConfig(parentGroup, sub.name);
  const highlightUnmatchedTransfer = Boolean(sub.isUnmatchedTransfer);

  return (
    <>
      <tr
        className={`cursor-pointer border-t text-slate-700 hover:bg-slate-50 ${
          highlightUnmatchedTransfer ? 'bg-amber-50' : ''
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3 pl-12 font-medium">
          <span className="flex items-center gap-2">
            <ChevronRight size={14} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            <RowIcon config={subIcon} />
            {sub.name}
          </span>
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`p-3 text-right ${
              m === months[months.length - 1] ? 'border-l-2 border-slate-300' : ''
            }`}
          >
            <Cell
              val={sub.totalsByMonth[m]}
              absolute
              neutral={Boolean(sub.isVolume)}
              highlight={highlightUnmatchedTransfer}
            />
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
        sortedGroupedItems.map((g) => (
          <GroupedTransactionRow
            key={g.description}
            group={g}
            months={months}
            highlightCells={highlightUnmatchedTransfer}
            sort={sort}
            cycleWeeks={cycleWeeks}
          />
        ))}
    </>
  );
}
