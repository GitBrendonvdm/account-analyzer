import { Landmark, TrendingDown, TrendingUp, HelpCircle } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../utils/format';

/**
 * Assets against debt, and which way it's going.
 *
 * Only accounts with a balance are counted, and the strip says so when some are missing — a net
 * worth that silently treats an un-entered bond as zero is worse than no net worth at all.
 */
export function NetWorthStrip({ netWorth, onAddBalances }) {
  if (!netWorth) return null;
  const { assets, debt, net, change, complete, knownCount, totalCount, missing } = netWorth;

  if (knownCount === 0) {
    return (
      <button
        type="button"
        onClick={onAddBalances}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50/40"
      >
        <Landmark size={20} className="shrink-0 text-slate-400" />
        <div>
          <p className="text-sm font-medium text-slate-800">Add your balances to see net worth</p>
          <p className="mt-0.5 text-xs text-slate-500">
            One number per account — what it holds today. Everything else, including every past
            cycle, is worked out from there.
          </p>
        </div>
      </button>
    );
  }

  const Trend = change >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-wrap items-end gap-8">
          <div>
            <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Net worth
            </div>
            <div
              className={`mt-1 text-3xl font-semibold tabular-nums ${net < 0 ? 'text-red-600' : 'text-slate-900'}`}
            >
              {formatCurrency(net)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">Held</div>
            <div className="mt-1 text-xl font-semibold text-emerald-600 tabular-nums">
              {formatCurrencyAbs(assets)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">Owed</div>
            <div className="mt-1 text-xl font-semibold text-red-600 tabular-nums">
              {formatCurrencyAbs(debt)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Over the window
            </div>
            <div
              className={`mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums ${
                change >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              <Trend size={18} />
              {change >= 0 ? '+' : '−'}
              {formatCurrencyAbs(change)}
            </div>
          </div>
        </div>

        {!complete && (
          <button
            type="button"
            onClick={onAddBalances}
            className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 hover:bg-amber-100"
          >
            <HelpCircle size={13} />
            {knownCount} of {totalCount} accounts valued — add {missing.slice(0, 2).join(', ')}
            {missing.length > 2 && ` +${missing.length - 2}`}
          </button>
        )}
      </div>
    </div>
  );
}
