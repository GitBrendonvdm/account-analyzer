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
        className="flex w-full items-center gap-3 rounded-[22px] border border-dashed border-hair bg-transparent p-5 text-left transition-colors hover:border-info/30 hover:bg-info/8"
      >
        <Landmark size={20} className="shrink-0 text-label-3" />
        <div>
          <p className="text-sm font-medium text-label">Add your balances to see net worth</p>
          <p className="mt-0.5 text-xs text-label-2">
            One number per account — what it holds today. Everything else, including every past
            cycle, is worked out from there.
          </p>
        </div>
      </button>
    );
  }

  const Trend = change >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="glass p-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-wrap items-end gap-8">
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-label-3 uppercase">
              Net worth
            </div>
            <div
              className={`mt-1 text-3xl font-semibold tabular-nums ${net < 0 ? 'text-bad' : 'text-label'}`}
            >
              {formatCurrency(net)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-label-3 uppercase">Held</div>
            <div className="mt-1 text-xl font-semibold text-good tabular-nums">
              {formatCurrencyAbs(assets)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-label-3 uppercase">Owed</div>
            <div className="mt-1 text-xl font-semibold text-bad tabular-nums">
              {formatCurrencyAbs(debt)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-label-3 uppercase">
              Over the window
            </div>
            <div
              className={`mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums ${
                change >= 0 ? 'text-good' : 'text-bad'
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
            className="flex items-center gap-1.5 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-xs text-warn hover:bg-warn/20"
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
