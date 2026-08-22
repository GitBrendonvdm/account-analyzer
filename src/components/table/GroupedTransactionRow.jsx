import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';
import { sortTableItems } from '../../lib/tableSort';
import { RowIcon } from './RowIcon';
import { DESCRIPTION_ICON, EXCEPTION_DESCRIPTION_ICON } from './rowIcons';
import { VariantTransactionRow } from './VariantTransactionRow';
import { WeekCells } from './WeekCells';
import { PIN_FILL, PIN_WARN } from './stickyColumn';

export function GroupedTransactionRow({ group, months, highlightCells = false, sort, cycleWeeks }) {
  const [expanded, setExpanded] = useState(false);
  const hasVariants = group.variants.length > 1;
  const rowIcon = group.isException ? EXCEPTION_DESCRIPTION_ICON : DESCRIPTION_ICON;
  const sortedVariantRows = sortTableItems(group.variantRows, sort);

  return (
    <>
      <tr
        // Taller on a phone: a row that opens on tap needs 44px under the finger.
        className={`border-t text-xs max-md:[&>td]:py-3.5 ${
          group.isException ? 'bg-warn/10 text-label-2' : 'bg-fill text-label-2'
        } ${hasVariants ? 'cursor-pointer hover:brightness-95' : ''}`}
        onClick={() => hasVariants && setExpanded(!expanded)}
      >
        <td className={`p-2 pl-20 max-md:pl-8 ${group.isException ? PIN_WARN : PIN_FILL}`}>
          <span className="flex items-center gap-1.5">
            {hasVariants && (
              <ChevronRight size={12} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            )}
            <RowIcon config={rowIcon} size={12} />
            <span>
              {group.description}
              {hasVariants && (
                <span className="ml-1 text-[10px] text-label-3">({group.variants.length} variants)</span>
              )}
            </span>
          </span>
          {group.isException && (
            <span className="ml-2 text-[10px] font-medium text-warn">
              {group.monthCount}/{group.totalMonths} months
            </span>
          )}
        </td>
        {months.map((m) => {
          const val = group.amountsByMonth[m];
          return (
            <td
              key={m}
              className={`p-2 text-right ${
                m === months[months.length - 1] ? 'border-l-2 border-hair' : ''
              }`}
            >
              {val != null && Math.abs(val) > 0.001 ? (
                <span
                  className={`${
                    val > 0 ? 'text-good' : 'text-bad'
                  } ${
                    highlightCells
                      ? 'rounded bg-warn/15 px-1.5 py-0.5 ring-1 ring-warn/40'
                      : ''
                  }`}
                  title={group.datesByMonth[m]}
                >
                  {highlightCells ? formatCurrencyAbs(val) : formatCurrency(val)}
                </span>
              ) : (
                ''
              )}
            </td>
          );
        })}
        <WeekCells
          weekly={group.isException ? undefined : group.weeklyRemaining}
          weeks={cycleWeeks ?? []}
          pad="p-2"
        />
        <td className="p-2 text-right">
          {!group.isException && (
            <span
              className="font-semibold text-info"
              title="This row's share of its category's forecast to payday"
            >
              {formatCurrency(group.expected)}
            </span>
          )}
        </td>
        <td />
      </tr>
      {expanded &&
        sortedVariantRows.map((variant) => (
          <VariantTransactionRow
            key={variant.description}
            variant={variant}
            months={months}
            cycleWeeks={cycleWeeks}
          />
        ))}
    </>
  );
}
