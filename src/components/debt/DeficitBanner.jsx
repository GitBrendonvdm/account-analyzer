import { AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import { Card } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * The deficit, said once and said first.
 *
 * A debt plan that quietly assumes extra payments while the cycles close short is fiction, so the
 * banner puts the gap above everything: what it is, which card it lands on, what that costs in a
 * year, and that the plans below assume NOTHING extra until it closes. The second line is the rule
 * the extra slider is built on — the first R{deficit} of anything found stops the bleed and reaches
 * no debt at all. When the cycles close with something left over, the same slot says how much of
 * it is available for extra payments after the saving already planned.
 */

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const fmtMonthYear = (d) => {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-ZA', MONTH_YEAR) : null;
};

function Assumptions({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="t-caption mt-3 flex flex-col gap-0.5">
      {items.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
}

export function DeficitBanner({ debtBudget, onOpenPlan }) {
  if (!debtBudget) return null;

  const deficit = Math.max(0, debtBudget.deficitPerCycle ?? 0);
  const adjusted = debtBudget.adjusted ?? 0;
  const surplus = debtBudget.surplus ?? adjusted;
  const planned = Math.max(0, adjusted - surplus);
  // With no card balance typed nobody can say WHICH card absorbs the gap, only that one does.
  const absorber = debtBudget.absorberLabel ? `the ${debtBudget.absorberLabel}` : 'a credit card';
  const breakEven = debtBudget.breakEvenExtra ?? deficit;
  const limitMonth = fmtMonthYear(debtBudget.limitDate);

  if (deficit > 0) {
    return (
      <Card
        className="materialize p-6 sm:p-7"
        style={{ borderColor: 'rgba(255,69,58,0.38)', borderTopColor: 'rgba(255,69,58,0.5)' }}
        aria-live="polite"
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 flex-grow gap-4">
            <AlertTriangle size={22} className="mt-0.5 shrink-0 text-bad" />
            <div className="min-w-0">
              <p className="t-sub text-bad">
                You are {formatCurrencyAbs(deficit)} a cycle short.
              </p>
              <p className="mt-1.5 max-w-[64ch] text-[14.5px] leading-relaxed text-label-2">
                That lands on {absorber} and costs about {formatCurrencyAbs(debtBudget.deficitCost12)}{' '}
                in interest over the next year. The plans below assume no extra payments until the
                gap closes.
              </p>
              <p className="mt-2 max-w-[64ch] text-[14.5px] leading-relaxed text-label-2">
                The first {formatCurrencyAbs(breakEven)} of anything extra you find stops the bleed;
                only what is above it reaches a debt.
                {limitMonth && ` At this pace ${absorber} reaches its limit in ${limitMonth}.`}
              </p>
              <Assumptions items={debtBudget.assumptions} />
            </div>
          </div>
          {onOpenPlan && (
            <button
              type="button"
              onClick={onOpenPlan}
              className="press glass-chip flex shrink-0 items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-info hover:brightness-125"
            >
              Close it
              <ArrowRight size={13} />
              Plan
            </button>
          )}
        </div>
      </Card>
    );
  }

  if (adjusted > 0) {
    return (
      <Card
        className="materialize p-6 sm:p-7"
        style={{ borderColor: 'rgba(48,209,88,0.3)', borderTopColor: 'rgba(48,209,88,0.42)' }}
      >
        <div className="flex gap-4">
          <Sparkles size={22} className="mt-0.5 shrink-0 text-good" />
          <div className="min-w-0">
            <p className="t-sub text-good">
              {planned > 0
                ? `After the ${formatCurrencyAbs(planned)} you plan to save, ${formatCurrencyAbs(adjusted)} a cycle is available for extra payments.`
                : `${formatCurrencyAbs(adjusted)} a cycle is available for extra payments.`}
            </p>
            <p className="mt-1.5 max-w-[64ch] text-[14.5px] leading-relaxed text-label-2">
              That is the extra slider's starting point; everything above it has to come from cuts.
            </p>
            <Assumptions items={debtBudget.assumptions} />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="materialize p-6 sm:p-7">
      <p className="t-sub">Your cycles close level.</p>
      <p className="mt-1.5 max-w-[64ch] text-[14.5px] leading-relaxed text-label-2">
        Nothing is available for extra payments until spending changes; the plans below start from
        the contractual instalments alone.
      </p>
      <Assumptions items={debtBudget.assumptions} />
    </Card>
  );
}
