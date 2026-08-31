import { formatCurrencyAbs } from '../utils/format';
import { FeesAudit } from './accounts/FeesAudit';

/**
 * What the debt costs — the largest thing happening to this money, and the one figure the spending
 * table structurally cannot show.
 *
 * The table drops loan accounts on purpose: the interest, fees and credit insurance charged inside
 * a loan are already contained in the instalment leaving the bank, so counting both would bill the
 * same money twice. Correct, but it means the cost of carrying the debt is invisible. This panel
 * reads those same rows as analysis. Nothing here feeds a flow, a total or a forecast.
 *
 * The fees audit sits under the per-account bars because it is the same money read the other way
 * — by what kind of charge it is rather than which account it hit — and the two together answer
 * "how much" and "which of it can I do something about" in one place.
 */
export function CostOfDebtPanel({ cost, fees }) {
  const hasCost = cost && cost.total > 0;
  if (!hasCost && !fees) return null;
  const max = cost?.accounts?.[0]?.total ?? 1;
  const worsening = (cost?.trend ?? 0) > 50;

  return (
    <div className="glass p-4 md:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="t-head">What the debt costs</h2>
          <p className="t-label mt-1.5 max-w-prose">
            What's actually been charged, read off the ledger itself — every account, including the
            loans. Kept out of the spending table because it is already inside the instalments —
            counting it there would bill the same money twice. Debt shows what today's rate and
            balance imply, which can differ from what actually posted.
          </p>
        </div>
        {hasCost && (
          <div className="text-right">
            <div className="text-2xl font-semibold text-bad tabular-nums">
              {formatCurrencyAbs(cost.perCycle)}
            </div>
            <div className="t-label">
              per cycle · {formatCurrencyAbs(cost.perYear)} a year
            </div>
          </div>
        )}
      </div>

      {hasCost && (
        <>
          {/* Below `md` the bar takes a line of its own under the name and figure; three columns
              across a phone left a 60px track, which is no bar at all. */}
          <div className="mt-5 space-y-2 max-md:space-y-3">
            {cost.accounts.map((a) => (
              <div
                key={a.account}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,11rem)_1fr_auto]"
              >
                <span className="truncate text-xs text-label-2" title={a.account}>
                  {a.account}
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-fill max-md:order-3 max-md:col-span-2">
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
        </>
      )}

      <FeesAudit fees={fees} className={hasCost ? 'mt-5 border-t pt-5' : 'mt-5'} />
    </div>
  );
}
