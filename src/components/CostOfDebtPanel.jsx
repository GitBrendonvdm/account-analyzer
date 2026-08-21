import { formatCurrencyAbs } from '../utils/format';

/**
 * What the debt costs — the largest thing happening to this money, and the one figure the spending
 * table structurally cannot show.
 *
 * The table drops loan accounts on purpose: the interest, fees and credit insurance charged inside
 * a loan are already contained in the instalment leaving the bank, so counting both would bill the
 * same money twice. Correct, but it means the cost of carrying the debt is invisible. This panel
 * reads those same rows as analysis. Nothing here feeds a flow, a total or a forecast.
 */
export function CostOfDebtPanel({ cost }) {
  if (!cost || cost.total <= 0) return null;
  const max = cost.accounts[0]?.total ?? 1;
  const worsening = cost.trend > 50;

  return (
    <div className="glass p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-label">What the debt costs</h2>
          <p className="mt-1 max-w-prose text-xs text-label-2">
            Interest, fees and credit insurance across every account, including the loans. Kept out
            of the spending table because it is already inside the instalments — counting it there
            would bill the same money twice.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-bad tabular-nums">
            {formatCurrencyAbs(cost.perCycle)}
          </div>
          <div className="text-xs text-label-2">
            per cycle · {formatCurrencyAbs(cost.perYear)} a year
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {cost.accounts.map((a) => (
          <div key={a.account} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-label-2" title={a.account}>
              {a.account}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-fill">
              <span
                className="block h-full rounded-full bg-bad"
                style={{ width: `${Math.max(1, (a.total / max) * 100)}%` }}
              />
            </span>
            <span className="text-xs font-medium text-label-2 tabular-nums">
              {formatCurrencyAbs(a.perCycle)}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 border-t pt-3 text-xs text-label-2">
        {worsening ? (
          <>
            Rising: the second half of the window costs{' '}
            <b className="font-semibold text-bad">
              {formatCurrencyAbs(cost.trend)} more a cycle
            </b>{' '}
            than the first.
          </>
        ) : cost.trend < -50 ? (
          <>
            Easing: {formatCurrencyAbs(cost.trend)} a cycle cheaper than the first half of the
            window.
          </>
        ) : (
          <>Steady across the window.</>
        )}
      </p>
    </div>
  );
}
