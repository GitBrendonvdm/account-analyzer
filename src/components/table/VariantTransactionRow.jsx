import { formatCurrency } from '../../utils/format';
import { RowIcon, VARIANT_ICON } from './rowIcons';

export function VariantTransactionRow({ variant, months }) {
  return (
    <tr className="border-t bg-white text-[11px] text-slate-500">
      <td className="p-1.5 pl-28">
        <span className="flex items-center gap-1.5">
          <RowIcon config={VARIANT_ICON} size={11} />
          {variant.description}
        </span>
      </td>
      {months.map((m) => {
        const val = variant.amountsByMonth[m];
        return (
          <td
            key={m}
            className={`p-1.5 text-right ${
              m === months[months.length - 1] ? 'border-l-2 border-slate-300' : ''
            }`}
          >
            {val != null && Math.abs(val) > 0.001 ? (
              <span
                className={val > 0 ? 'text-green-600' : 'text-red-600'}
                title={variant.datesByMonth[m]}
              >
                {formatCurrency(val)}
              </span>
            ) : (
              ''
            )}
          </td>
        );
      })}
      <td />
      <td />
    </tr>
  );
}
