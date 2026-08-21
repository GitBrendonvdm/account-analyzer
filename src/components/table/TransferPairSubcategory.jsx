import { useMemo, useState } from 'react';
import { ChevronRight, Undo2 } from 'lucide-react';
import { sortTableItems } from '../../lib/tableSort';
import { Cell } from './Cell';
import { RowIcon } from './RowIcon';
import { getGroupIconConfig } from './rowIcons';
import { TransferMatchRow } from './TransferMatchRow';
import { groupMatches } from './groupMatches';
import { WeekCells } from './WeekCells';

export function TransferPairSubcategory({ sub, months, sort, cycleWeeks }) {
  const [expanded, setExpanded] = useState(false);
  const pairIcon = getGroupIconConfig('Transfers');
  const matchGroups = useMemo(
    () => sortTableItems(groupMatches(sub.matches || [], months), sort),
    [sub.matches, months, sort],
  );
  // Gross volume, computed once in processTransactionData so sorting by a month column orders by
  // the number actually on screen.
  const volumeByMonth = sub.totalsByMonth ?? {};

  return (
    <>
      <tr
        className="cursor-pointer border-t border-deep/25 bg-deep/12/60 text-label-2 hover:bg-deep/12"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3 pl-12">
          <span className="flex items-center gap-2 font-medium">
            <ChevronRight size={14} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            <RowIcon config={pairIcon} />
            {sub.isReversal ? (
              <>
                <span className="text-label-2">{sub.fromAccount}</span>
                <span className="flex items-center gap-1 text-xs font-normal text-warn">
                  <Undo2 size={12} />
                  Reversed
                </span>
              </>
            ) : (
              <>
                <span className="text-label-2">{sub.fromAccount}</span>
                <span className="text-deep">→</span>
                <span className="text-label-2">{sub.toAccount}</span>
              </>
            )}
            <span className="text-xs font-normal text-label-3">
              ({matchGroups.length} match{matchGroups.length === 1 ? '' : 'es'})
            </span>
          </span>
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`p-3 text-right ${
              m === months[months.length - 1] ? 'border-l-2 border-hair' : ''
            }`}
          >
            <Cell val={volumeByMonth[m] || null} neutral />
          </td>
        ))}
        <WeekCells weekly={undefined} weeks={cycleWeeks ?? []} />
        <td />
        <td />
      </tr>
      {expanded &&
        matchGroups.map((group) => (
          <TransferMatchRow
            key={`${group.creditLabel}-${group.debitLabel}`}
            group={group}
            months={months}
            cycleWeeks={cycleWeeks}
          />
        ))}
    </>
  );
}
