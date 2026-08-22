import { ArrowDown, ArrowRight, ArrowUp, GitMerge } from 'lucide-react';
import { CardHead } from '../ui/Surface';
import { Field } from '../ui/Field';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * The plan's dials: which order, how much extra, whether freed instalments roll on, a lump, the
 * prime rate.
 *
 * The extra slider's MINIMUM is the floor — the deficit when there is one, the surplus already
 * available otherwise — rather than zero, because a plan cannot spend money that is not there.
 * Below the deficit line nothing reaches a debt (it is stopping the bleed), and the caption says
 * exactly how much does. Anything above what the cycles already give has to be found by cuts, and
 * the link to Plan is where those cuts are listed. Every control here persists through settings so
 * the choice survives a reload and the next browser.
 */

const SEGMENT = 'press rounded-full px-3.5 py-1.5 text-[12.5px]';

export function PlanControls({
  strategies,
  strategy,
  onStrategy,
  extra,
  floor,
  available,
  deficit,
  max,
  step = 500,
  onExtra,
  cascade,
  onCascade,
  lump,
  onLump,
  primeRate,
  onPrimeRate,
  onOpenPlan,
  order = [],
  onOrder,
  labelsById = {},
  debts = [],
}) {
  const toDebts = deficit > 0 ? Math.max(0, extra - deficit) : extra;
  const cuts = Math.max(0, extra - available);
  const minimum = strategy === 'minimum';
  const custom = strategy === 'custom';
  const ids = order.filter((id) => debts.some((d) => d.id === id));

  const move = (index, dir) => {
    const next = ids.slice();
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onOrder?.(next);
  };

  return (
    <div>
      <CardHead
        title="Plan"
        subtitle="Where the extra goes first, and how much of it there is. Every figure below moves with these."
        right={
          <div className="glass-chip flex flex-wrap gap-1 p-1" role="group" aria-label="Payoff strategy">
            {strategies.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onStrategy(s.id)}
                aria-pressed={strategy === s.id}
                title={s.blurb}
                className={`${SEGMENT} ${strategy === s.id ? 'bg-fill-2 font-semibold' : 'text-label-2 hover:text-label'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <label className="flex flex-col gap-2">
            <span className="flex items-baseline justify-between gap-3">
              <span className="t-label">Extra a cycle</span>
              <span className="num text-[15px] font-semibold text-label">{formatCurrencyAbs(extra)}</span>
            </span>
            <input
              type="range"
              min={floor}
              max={max}
              step={step}
              value={extra}
              disabled={minimum}
              onChange={(e) => onExtra(Number(e.target.value))}
              className="w-full accent-info disabled:opacity-40"
              aria-label="Extra payment per cycle"
            />
          </label>
          <p className="t-caption mt-2">
            {minimum
              ? 'Paying only the minimums — the slider is idle under this strategy.'
              : deficit > 0
                ? `The first ${formatCurrencyAbs(deficit)} stops the bleed; ${formatCurrencyAbs(toDebts)} reaches your debts.`
                : available > 0
                  ? `${formatCurrencyAbs(available)} of it is already there each cycle.`
                  : 'Nothing is left over at the moment; all of this has to be found.'}
          </p>
          {!minimum && cuts > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-warn">
              needs {formatCurrencyAbs(cuts)} of cuts
              {onOpenPlan && (
                <button
                  type="button"
                  onClick={onOpenPlan}
                  className="press inline-flex items-center gap-1 text-info hover:brightness-125"
                >
                  <ArrowRight size={12} />
                  Plan
                </button>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <button
            type="button"
            onClick={() => onCascade(!cascade)}
            aria-pressed={cascade}
            disabled={minimum}
            className={`press glass-chip flex items-center gap-2 px-4 py-2 text-[13px] disabled:opacity-40 ${
              cascade ? 'text-label' : 'text-label-2'
            }`}
          >
            <GitMerge size={14} className={cascade ? 'text-good' : 'text-label-3'} />
            {cascade ? 'Freed instalments roll on' : 'Freed instalments come back to you'}
          </button>

          <Field
            label="Lump sum"
            value={lump > 0 ? lump : ''}
            onCommit={(raw) => {
              const n = Number(String(raw).replace(/[^\d.]/g, ''));
              onLump(Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
            }}
            prefix="R"
            placeholder="0"
            width="w-28"
          />

          <Field
            label="Prime rate"
            value={primeRate ?? ''}
            onCommit={(raw) => {
              const s = String(raw).replace(/[^\d.]/g, '');
              if (!s) return onPrimeRate(null);
              const n = Number(s);
              return onPrimeRate(Number.isFinite(n) && n >= 0 && n <= 40 ? n : null);
            }}
            suffix="%"
            placeholder="not set"
            width="w-20"
          />
        </div>
      </div>

      {custom && ids.length > 0 && (
        <ol className="mt-5 flex flex-wrap gap-2" aria-label="Custom payoff order">
          {ids.map((id, i) => (
            <li key={id} className="glass-chip flex items-center gap-2 py-1 pr-1 pl-3 text-[13px]">
              <span className="num text-label-3">{i + 1}</span>
              <span className="text-label">{labelsById[id] ?? id}</span>
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${labelsById[id] ?? id} earlier`}
                className="press rounded-full p-1 text-label-3 hover:bg-fill hover:text-label disabled:opacity-30"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === ids.length - 1}
                aria-label={`Move ${labelsById[id] ?? id} later`}
                className="press rounded-full p-1 text-label-3 hover:bg-fill hover:text-label disabled:opacity-30"
              >
                <ArrowDown size={12} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
