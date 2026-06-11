import { useMemo, useState } from 'react';
import { ChevronRight, Undo2 } from 'lucide-react';
import { sortTableItems } from '../../lib/tableSort';
import { Cell } from './Cell';
import { getGroupIconConfig, RowIcon } from './rowIcons';
import { TransferMatchRow, groupMatches } from './TransferMatchRow';

function transferVolumeByMonth(matches, months) {
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  matches.forEach((match) => {
    if (months.includes(match.month)) {
      totals[match.month] = (totals[match.month] || 0) + Math.abs(match.amount);
    }
  });
  return totals;
}

export function TransferPairSubcategory({ sub, months, sort }) {
  const [expanded, setExpanded] = useState(false);
  const pairIcon = getGroupIconConfig('Transfers');
  const matchGroups = useMemo(
    () => sortTableItems(groupMatches(sub.matches || [], months), sort),
    [sub.matches, months, sort],
  );
  const volumeByMonth = useMemo(
    () => transferVolumeByMonth(sub.matches || [], months),
    [sub.matches, months],
  );

  return (
    <>
      <tr
        className="cursor-pointer border-t border-violet-100 bg-violet-50/60 text-slate-700 hover:bg-violet-50"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3 pl-12">
          <span className="flex items-center gap-2 font-medium">
            <ChevronRight size={14} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            <RowIcon config={pairIcon} />
            {sub.isReversal ? (
              <>
                <span className="text-slate-700">{sub.fromAccount}</span>
                <span className="flex items-center gap-1 text-xs font-normal text-amber-600">
                  <Undo2 size={12} />
                  Reversed
                </span>
              </>
            ) : (
              <>
                <span className="text-slate-500">{sub.fromAccount}</span>
                <span className="text-violet-400">→</span>
                <span className="text-slate-700">{sub.toAccount}</span>
              </>
            )}
            <span className="text-xs font-normal text-slate-400">
              ({matchGroups.length} match{matchGroups.length === 1 ? '' : 'es'})
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
            <Cell val={volumeByMonth[m] || null} />
          </td>
        ))}
        <td />
        <td />
      </tr>
      {expanded &&
        matchGroups.map((group) => (
          <TransferMatchRow key={`${group.creditLabel}-${group.debitLabel}`} group={group} months={months} />
        ))}
    </>
  );
}
