import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';
import { sortTableItems } from '../../lib/tableSort';
import { DESCRIPTION_ICON, EXCEPTION_DESCRIPTION_ICON, RowIcon } from './rowIcons';
import { VariantTransactionRow } from './VariantTransactionRow';

export function GroupedTransactionRow({ group, months, parentGroup, highlightCells = false, sort }) {
  const [expanded, setExpanded] = useState(false);
  const hasVariants = group.variants.length > 1;
  const rowIcon = group.isException ? EXCEPTION_DESCRIPTION_ICON : DESCRIPTION_ICON;
  const sortedVariantRows = sortTableItems(group.variantRows, sort);

  return (
    <>
      <tr
        className={`border-t text-xs ${
          group.isException ? 'bg-amber-50 text-slate-700' : 'bg-slate-50 text-slate-600'
        } ${hasVariants ? 'cursor-pointer hover:brightness-95' : ''}`}
        onClick={() => hasVariants && setExpanded(!expanded)}
      >
        <td className="p-2 pl-20">
          <span className="flex items-center gap-1.5">
            {hasVariants && (
              <ChevronRight size={12} className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            )}
            <RowIcon config={rowIcon} size={12} />
            <span>
              {group.description}
              {hasVariants && (
                <span className="ml-1 text-[10px] text-slate-400">({group.variants.length} variants)</span>
              )}
            </span>
          </span>
          {group.isException && (
            <span className="ml-2 text-[10px] font-medium text-amber-600">
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
                m === months[months.length - 1] ? 'border-l-2 border-slate-300' : ''
              }`}
            >
              {val != null && Math.abs(val) > 0.001 ? (
                <span
                  className={`${
                    val > 0 ? 'text-green-600' : 'text-red-600'
                  } ${
                    highlightCells
                      ? 'rounded bg-amber-100 px-1.5 py-0.5 ring-1 ring-amber-300'
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
        <td className="p-2 text-right">
          {!group.isException && (
            <span className="font-semibold text-blue-600" title="Remaining vs prior-month average">
              {formatCurrency(group.expected)}
            </span>
          )}
        </td>
        <td />
      </tr>
      {expanded &&
        sortedVariantRows.map((variant) => (
          <VariantTransactionRow key={variant.description} variant={variant} months={months} />
        ))}
    </>
  );
}
