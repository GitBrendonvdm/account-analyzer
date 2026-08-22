import { formatCurrencyAbs } from '../../utils/format';

/**
 * One tile per strategy, all measured against the same baseline: paying only the minimums.
 *
 * A debt-free date on its own is not a decision; what decides is how much sooner and how much less
 * interest than doing nothing, and which debt goes first (the first payoff is the first relief).
 * The selected tile is the one the charts below draw; the others are one click away, so the cost
 * of comparing is nothing. The sentence under the tiles says the selected plan in words, because a
 * plan you cannot repeat to someone is a plan you will not follow.
 */

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const fmtMonthYear = (d) => {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-ZA', MONTH_YEAR) : null;
};
const yearsMonths = (months) => {
  if (!Number.isFinite(months) || months <= 0) return null;
  const y = Math.floor(months / 12);
  const m = Math.round(months % 12);
  const parts = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
};

function narrative(strategyLabel, strategy, plan, row, extra, labelsById) {
  if (!plan) return null;
  const name = (id) => labelsById[id] ?? id;
  const first = plan.order?.[0];
  const second = plan.order?.[1];
  const firstCleared = first ? fmtMonthYear(plan.perDebt?.[first]?.clearedDate) : null;
  const free = fmtMonthYear(plan.debtFreeDate);

  if (plan.reachedCap) {
    const stuck = plan.neverClears?.[0]?.id ?? plan.order?.find((id) => plan.perDebt?.[id]?.clearedMonth == null);
    return `${strategyLabel}: the ${name(stuck)} does not clear within 50 years at today's instalment.`;
  }
  if (strategy === 'minimum') {
    return `Minimum: only the contractual payments; everything is gone by ${free ?? 'the end of the plan'}.`;
  }
  const sooner = yearsMonths(row?.monthsSavedVsMinimum);
  const saved = row?.interestSavedVsMinimum;
  const target = second
    ? `goes to the ${name(first)} first, then the ${name(second)}${firstCleared ? ` from ${firstCleared}` : ''}`
    : `goes to the ${name(first)}`;
  const tail =
    sooner || Number.isFinite(saved)
      ? ` — ${sooner ? `${sooner} sooner` : 'no sooner'}${Number.isFinite(saved) ? ` and ${formatCurrencyAbs(saved)} less interest` : ''} than paying only the minimums.`
      : '.';
  return `${strategyLabel}: ${formatCurrencyAbs(extra)} extra a month ${target}; everything is gone by ${free ?? 'the end of the plan'}${tail}`;
}

export function StrategyTiles({ strategies, table = [], best, selected, onSelect, plan, plans, extra = 0, labelsById = {} }) {
  const rows = Object.fromEntries(table.map((r) => [r.strategy, r]));
  const shown = strategies.filter((s) => rows[s.id] || s.id === selected);
  const current = strategies.find((s) => s.id === selected);
  const sentence = narrative(current?.label ?? selected, selected, plan, rows[selected], extra, labelsById);

  const badges = (id) => {
    const out = [];
    if (best?.byInterest === id) out.push('least interest');
    if (best?.byDate === id) out.push('soonest');
    if (best?.byFirstRelief === id) out.push('first relief');
    return out;
  };

  return (
    <div className="mt-7 border-t pt-6">
      <h3 className="t-sub">Strategies</h3>
      <p className="t-caption mt-1">Each against paying only the minimums. Click one to draw it below.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((s) => {
          const r = rows[s.id];
          const active = s.id === selected;
          const free = r?.debtFreeDate ? fmtMonthYear(r.debtFreeDate) : null;
          const sooner = yearsMonths(r?.monthsSavedVsMinimum);
          const firstLabel = r?.firstPayoffId ? (labelsById[r.firstPayoffId] ?? r.firstPayoffId) : null;
          const own = plans?.[s.id] ?? (plan?.strategy === s.id ? plan : null);
          const firstDate = r?.firstPayoffId ? fmtMonthYear(own?.perDebt?.[r.firstPayoffId]?.clearedDate) : null;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-pressed={active}
              className="glass-tile press p-5 text-left"
              style={active ? { borderColor: 'rgba(10,132,255,0.55)', borderTopColor: 'rgba(10,132,255,0.7)' } : undefined}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-[14.5px] font-semibold ${active ? 'text-info' : 'text-label'}`}>{s.label}</span>
                <span className="flex flex-wrap gap-1">
                  {badges(s.id).map((b) => (
                    <span key={b} className="rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-good max-md:text-xs">
                      {b}
                    </span>
                  ))}
                </span>
              </div>
              <div className="t-caption">{s.blurb}</div>

              {r ? (
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <div className="t-label">Debt-free</div>
                    <div className="num mt-1 text-[15px] font-semibold text-label">{free ?? 'not within 50 years'}</div>
                  </div>
                  <div>
                    <div className="t-label">Total interest</div>
                    <div className="num mt-1 text-[15px] font-semibold text-label">{formatCurrencyAbs(r.totalInterest)}</div>
                  </div>
                  <div className="col-span-2 text-[13px] text-label-2">
                    {s.id === 'minimum'
                      ? 'The baseline every saving is measured against.'
                      : `saves ${formatCurrencyAbs(r.interestSavedVsMinimum)}${sooner ? ` and ${sooner}` : ''} vs paying only the minimums`}
                  </div>
                  {firstLabel && (
                    <div className="col-span-2 t-caption">
                      first payoff: {firstLabel}
                      {firstDate ? `, ${firstDate}` : r.firstPayoffMonth ? `, month ${r.firstPayoffMonth}` : ''}
                    </div>
                  )}
                </div>
              ) : (
                <div className="t-caption mt-4">
                  {s.id === 'custom' ? 'Set an order above to compare it.' : 'Not computed.'}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {sentence && <p className="mt-5 max-w-[78ch] text-[15px] leading-relaxed text-label">{sentence}</p>}
      {plan?.assumptions?.length > 0 && (
        <ul className="t-caption mt-3 flex flex-col gap-0.5">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
