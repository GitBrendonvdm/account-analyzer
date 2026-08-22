import { Card, CardHead } from '../ui/Surface';
import { StepChart } from './StepChart';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * The same things, costing more.
 *
 * A subscription's price never moves in the spending table — the category total absorbs it — so
 * a R449 → R519 → R609 line is invisible until someone compares two bills a year apart. The
 * recurring engine already knows each line's price regimes; this card lists the ones that stepped
 * up, what the step costs a year, and the step chart so the timing is visible. Falling lines are
 * listed quietly (the rate cut that lowered the bond instalment is not a price drop, and the
 * library keeps it out of the total for the same reason it keeps instalments out of the creep).
 *
 * "Vary too much to compare" names the pharmacy and the fuel station honestly rather than
 * reporting a step where there is only a spread.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pctLabel = (pct) => `${pct >= 0 ? '+' : '−'}${Math.round(Math.abs(pct) * 100)}%`;

/**
 * From `sm` up: name, old → new, percentage, step chart, extra a year, in five columns. Below `sm`
 * the amount is pinned beside the name, the old → new and percentage share the next line, and the
 * chart spans the row; the pair's wrapper is `display: contents` on the desktop grid so the column
 * order there is exactly what it was.
 */
function CreepRow({ item, tone }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t px-4 py-3 sm:grid-cols-[minmax(0,13rem)_auto_auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-6">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium">{item.label}</div>
        <div className="t-caption truncate">
          {item.kind}
          {item.countsInTotal === false && ' · listed, not counted'}
          {item.steps?.length > 0 && ` · ${plural(item.steps.length, 'step')} over ${plural(item.cyclesObserved ?? item.steps.length, 'cycle')}`}
        </div>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
        <span className="num text-[13px] text-label-2">
          {formatCurrencyAbs(item.first?.amount)} → {formatCurrencyAbs(item.last?.amount)}
        </span>
        <span className={`num text-[13px] font-semibold ${tone}`}>{pctLabel(item.totalPct ?? 0)}</span>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <StepChart first={item.first} last={item.last} steps={item.steps} />
      </div>
      <div className="col-start-2 row-start-1 text-right sm:col-auto sm:row-auto">
        <div className={`num text-[15px] font-semibold ${tone}`}>
          {item.extraPerYear >= 0 ? '+' : '−'}
          {formatCurrencyAbs(item.extraPerYear)}
        </div>
        <div className="t-caption">a year</div>
      </div>
    </li>
  );
}

export function PriceCreepCard({ priceCreep, className = '' }) {
  if (!priceCreep) return null;
  const rising = priceCreep.rising ?? [];
  const falling = priceCreep.falling ?? [];
  const variable = priceCreep.variable ?? [];
  const sentence =
    priceCreep.sentence ??
    `The same things cost ${formatCurrencyAbs(priceCreep.extraPerCycle ?? 0)} more a cycle than when you started — ${formatCurrencyAbs(priceCreep.extraPerYear ?? 0)} a year.`;

  return (
    <Card className={`materialize overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-5 sm:px-6">
        <CardHead
          title="Price increases"
          subtitle="Standing charges whose price stepped up, from their first settled price to the latest. A step needs the new amount to repeat; one odd charge is not a price."
        />
        <div className="shrink-0 text-right">
          <div className="t-title num text-warn">{formatCurrencyAbs(priceCreep.extraPerYear ?? 0)}</div>
          <div className="t-caption">a year more than at the start</div>
        </div>
      </div>
      <p className="t-sub border-b px-4 py-4 sm:px-6">{sentence}</p>

      {rising.length === 0 ? (
        <p className="t-caption px-4 py-5 sm:px-6">No standing charge has stepped up since the data began.</p>
      ) : (
        <ol className="flex flex-col">
          {rising.map((item) => (
            <CreepRow key={item.lineId ?? item.label} item={item} tone="text-warn" />
          ))}
        </ol>
      )}

      {falling.length > 0 && (
        <>
          <div className="border-t bg-fill px-4 py-2.5 text-[12px] font-semibold tracking-wide text-label-3 uppercase sm:px-6 sm:text-[11px]">
            Got cheaper
          </div>
          <ol className="flex flex-col">
            {falling.map((item) => (
              <CreepRow key={item.lineId ?? item.label} item={item} tone="text-good" />
            ))}
          </ol>
        </>
      )}

      <div className="border-t px-4 py-4 sm:px-6">
        {variable.length > 0 && (
          <p className="text-[13px] text-label-2" title={variable.map((v) => v.label).join(', ')}>
            {priceCreep.variableSentence ?? `${plural(variable.length, 'line')} vary too much to compare`}
            {' — '}
            <span className="text-label-3">{variable.slice(0, 4).map((v) => v.label).join(', ')}{variable.length > 4 ? '…' : ''}</span>
          </p>
        )}
        {priceCreep.assumptions?.length > 0 && <p className="t-caption mt-1">{priceCreep.assumptions.join(' ')}</p>}
      </div>
    </Card>
  );
}
