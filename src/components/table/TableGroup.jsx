import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatCurrencyAbs } from '../../utils/format';
import { sortTableItems } from '../../lib/tableSort';
import { Cell } from './Cell';
import { RowIcon } from './RowIcon';
import { getGroupIconConfig } from './rowIcons';
import { TableSpendingGroup } from './TableSpendingGroup';
import { TableSubcategory } from './TableSubcategory';
import { TransferPairSubcategory } from './TransferPairSubcategory';
import { WeekCells } from './WeekCells';

export function TableGroup({ group, months, sort, cycleWeeks }) {
  const [collapsed, setCollapsed] = useState(true);
  const groupIcon = getGroupIconConfig(group.name);
  const sortedSub = sortTableItems(group.sub, sort);

  return (
    <>
      <tr
        className={`cursor-pointer border-t font-bold ${
          group.isException ? 'bg-amber-100' : group.isTransfer ? 'bg-slate-100 text-slate-500' : 'bg-slate-100'
        }`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <td className="flex items-center gap-2 p-4">
          <ChevronRight size={16} className={`shrink-0 ${collapsed ? '' : 'rotate-90'}`} />
          <RowIcon config={groupIcon} size={16} />
          {group.name}
          {group.isTransfer && (
            <span className="text-xs font-normal text-slate-400">
              always 0 — money moving between your own accounts
            </span>
          )}
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`p-4 text-right ${
              m === months[months.length - 1] ? 'border-l-2 border-slate-300' : ''
            }`}
            title={
              group.isTransfer
                ? 'A transfer has two legs that cancel out, so it never adds to or subtracts from anything. The rows below show what moved.'
                : undefined
            }
          >
            <Cell val={group.totalsByMonth[m]} absolute neutral={group.isTransfer} />
          </td>
        ))}
        <WeekCells
          weekly={group.isException || group.isTransfer ? undefined : group.weeklyRemaining}
          weeks={cycleWeeks ?? []}
          pad="p-4"
        />
        <td className="p-4 text-right font-semibold text-blue-600">
          {group.isException || group.isTransfer ? '' : formatCurrencyAbs(group.expected)}
        </td>
        <td className="p-4 text-right">
          <Cell val={group.avg} absolute />
        </td>
      </tr>
      {!collapsed &&
        sortedSub.map((s) =>
          s.isTransferPair ? (
            <TransferPairSubcategory
              key={s.key ?? s.name}
              sub={s}
              months={months}
              sort={sort}
              cycleWeeks={cycleWeeks}
            />
          ) : s.isSpendingGroup ? (
            <TableSpendingGroup
              key={s.key ?? s.name}
              sub={s}
              months={months}
              parentGroup={group.name}
              sort={sort}
              cycleWeeks={cycleWeeks}
            />
          ) : (
            <TableSubcategory
              key={s.key ?? s.name}
              sub={s}
              months={months}
              parentGroup={group.name}
              sort={sort}
              cycleWeeks={cycleWeeks}
            />
          ),
        )}
    </>
  );
}
