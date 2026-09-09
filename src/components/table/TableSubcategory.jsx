import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useGroupedTransactions } from '../../hooks/useGroupedTransactions';
import { sortTableItems } from '../../lib/tableSort';
import { Cell } from './Cell';
import { GroupedTransactionRow } from './GroupedTransactionRow';
import { RowIcon } from './RowIcon';
import { getSubcategoryIconConfig } from './rowIcons';
import { WeekCells } from './WeekCells';
import { ForecastCell, RemainingCell } from './ForecastCell';
import { RowOverrideEditor } from './RowOverrideEditor';
import { overrideBadge, sharedOverride } from '../../lib/txnOverrides';
import { EditToggle } from './EditToggle';
import { PIN_PLAIN, PIN_WARN } from './stickyColumn';

export function TableSubcategory({ sub, months, parentGroup, sort, cycleWeeks, columns, txnOverrides, onSetTxnOverride, labelChoices }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  // Every payment in this category, so one correction moves the lot.
  const keys = (sub.items ?? []).map((t) => t.key).filter(Boolean);
  const canEdit = Boolean(onSetTxnOverride && keys.length && !sub.isVolume);
  const shared = canEdit ? sharedOverride(keys, txnOverrides) : null;
  const badge = overrideBadge(shared);
  // The parent's forecast is split across these rows, so the tree adds up.
  const groupedItems = useGroupedTransactions(sub.items, months, sub.skipExpected, sub);
  const sortedGroupedItems = sortTableItems(groupedItems, sort);
  const subIcon = getSubcategoryIconConfig(parentGroup, sub.name);
  const highlightUnmatchedTransfer = Boolean(sub.isUnmatchedTransfer);

  return (
    <>
      <tr
        className={`cursor-pointer border-t text-label-2 hover:bg-fill ${
          highlightUnmatchedTransfer ? 'bg-warn/10' : ''
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Indents halve on a phone: the tree still reads, and the name keeps its room. */}
        <td className={`p-3 pl-12 font-medium max-md:pl-6 ${highlightUnmatchedTransfer ? PIN_WARN : PIN_PLAIN}`}>
          <span className="flex items-center gap-2">
            <ChevronRight size={14} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            <RowIcon config={subIcon} />
            {sub.name}
            {badge && (
              <span className="rounded bg-fill-2 px-1.5 py-0.5 text-[10px] font-normal text-info">{badge}</span>
            )}
            {canEdit && <EditToggle open={editing} label={sub.name} onClick={() => setEditing((v) => !v)} />}
          </span>
        </td>
        {months.map((m) => (
          <td
            key={m}
            className={`p-3 text-right ${
              m === months[months.length - 1] ? 'border-l-2 border-hair' : ''
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
        <td className="p-3 text-right font-semibold text-info">
          {sub.skipExpected ? '' : <RemainingCell item={sub} months={months} />}
        </td>
        <td className="p-3 text-right font-semibold">
          {sub.isVolume ? '' : <ForecastCell item={sub} months={months} />}
        </td>
        <td className="p-3 text-right">
          <Cell val={sub.avg} absolute />
        </td>
      </tr>
      {editing && (
        <RowOverrideEditor
          columns={columns}
          label={sub.name}
          keys={keys}
          flag={shared?.flag}
          category={shared?.category}
          spendingGroup={shared?.spendingGroup}
          choices={labelChoices}
          onChange={onSetTxnOverride}
          isException={sub.isException}
        />
      )}
      {expanded &&
        sortedGroupedItems.map((g) => (
          <GroupedTransactionRow
            key={g.description}
            group={g}
            months={months}
            highlightCells={highlightUnmatchedTransfer}
            sort={sort}
            cycleWeeks={cycleWeeks}
            columns={columns}
            txnOverrides={txnOverrides}
            onSetTxnOverride={onSetTxnOverride}
            labelChoices={labelChoices}
          />
        ))}
    </>
  );
}
