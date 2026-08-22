import { useState } from 'react';
import { Card, CardHead } from '../ui/Surface';
import { StepChart } from './StepChart';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * Standing charges — every line the recurring engine found, with the user's say over each.
 *
 * This replaces "standing commitments", which counted merchants present in most cycles and so
 * listed the bond beside Netflix under one total. Here the lines come from recurring.js with a
 * kind on each, the totals are by kind with the optional services first, and instalments and
 * repayments sit at the bottom under their own heading so that a "cancel" verb never lands near
 * them.
 *
 * The override chips are how the user corrects the engine without touching the data: "keep" takes
 * a line out of the savings total (it is wanted), "not a subscription" removes it from the audit
 * altogether (the engine mistook a habit for a contract), "cancelled" moves it to the wins as of
 * today so that the saving is counted before the bank has stopped charging. They persist through
 * settings.lineOverrides, so a decision survives the next import.
 *
 * Sixty lines with a step chart each made the page twelve thousand pixels tall, so the card opens on
 * the top STANDING_CHARGES_SHOWN lines by per-cycle cost (the engine's order) and a "Show all" strip
 * expands it. The header figure and the per-kind totals come from the engine's aggregates, so they
 * cover every line whether or not it is shown, and a caption says so. Nothing is persisted: every
 * load starts folded.
 */

/** Lines shown before "Show all"; the Plan table uses the same cut. */
export const STANDING_CHARGES_SHOWN = 12;

const DAY_MS = 86400000;
const KIND_ORDER = ['optional', 'insurance', 'utility', 'fee', 'person', 'other', 'instalment', 'repayment'];
const KIND_LABEL = {
  optional: 'Optional services',
  insurance: 'Insurance',
  utility: 'Utilities',
  fee: 'Bank fees',
  person: 'People',
  other: 'Other',
  instalment: 'Instalments',
  repayment: 'Card repayments',
};
const DEBT_KINDS = new Set(['instalment', 'repayment']);
const OVERRIDES = [
  { value: 'keep', label: 'keep' },
  { value: 'ignore', label: 'not a subscription' },
  { value: 'cancelled', label: 'cancelled' },
];
const STATUS_TONE = { landed: 'text-good', due: 'text-label-3', overdue: 'text-warn', unobservable: 'text-label-3' };
const STATUS_LABEL = { landed: 'landed', due: 'due', overdue: 'overdue', unobservable: 'not yet in the data' };

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const relative = (v, asOf) => {
  const d = toDate(v);
  if (!d || !asOf) return null;
  const n = Math.round((midnight(d) - midnight(asOf)) / DAY_MS);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
};
const monthLabel = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }) : key ?? '';
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function OverrideControl({ line, value, onSet }) {
  if (!onSet) return null;
  return (
    <span className="glass-chip flex shrink-0 gap-0.5 p-0.5" role="group" aria-label={`Override for ${line.label}`}>
      {OVERRIDES.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onSet(line.id, on ? null : o.value)}
            className={`press rounded-full px-2.5 py-1 text-[11px] ${on ? 'bg-fill-2 font-semibold text-label' : 'text-label-3 hover:text-label'}`}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

function LineRow({ line, override, onSet, asOf }) {
  const due = relative(line.nextDate, asOf);
  const status = line.cycleStatus;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t px-6 py-3 sm:grid-cols-[minmax(0,14rem)_auto_auto_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium">{line.label}</div>
        <div className="t-caption truncate">
          {line.category ?? line.kind}
          {line.priceChange && (
            <span className={`ml-2 ${line.priceChange.pct > 0 ? 'text-warn' : 'text-good'}`}>
              {line.priceChange.pct > 0 ? '+' : '−'}
              {Math.round(Math.abs(line.priceChange.pct) * 100)}% since {monthLabel(line.priceChange.since)}
            </span>
          )}
        </div>
      </div>
      <span className="rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-label-2">{line.cadence}</span>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-label-3 sm:col-span-1">
        {due && <span>next {due}</span>}
        {status && <span className={STATUS_TONE[status] ?? 'text-label-3'}>{STATUS_LABEL[status] ?? status}</span>}
        {line.level && line.level !== 'high' && <span>{line.level} confidence</span>}
      </div>
      <div className="hidden sm:block">
        <StepChart regimes={line.regimes} />
      </div>
      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
        {!DEBT_KINDS.has(line.kind) && <OverrideControl line={line} value={override} onSet={onSet} />}
        <div className="text-right">
          <div className="num text-[15px] font-semibold">{formatCurrencyAbs(line.amount)}</div>
          <div className="t-caption num">{formatCurrencyAbs(line.perCycle * 12)} a year</div>
        </div>
      </div>
    </li>
  );
}

export function SubscriptionsCard({ subscriptions, lineOverrides, onSetLineOverride, asOf, className = '' }) {
  const [showAll, setShowAll] = useState(false);
  if (!subscriptions) return null;
  const today = toDate(asOf) ?? new Date();
  const lines = subscriptions.lines ?? [];
  const overrideOf = (line) => lineOverrides?.[line.id] ?? line.override ?? null;
  const kinds = KIND_ORDER.map((k) => ({ kind: k, ...(subscriptions.byKind?.[k] ?? {}) })).filter((k) => k.count > 0);
  // recurring.js sorts lines by perCycle descending, so the first N are the biggest.
  const collapsible = lines.length > STANDING_CHARGES_SHOWN;
  const shown = collapsible && !showAll ? lines.slice(0, STANDING_CHARGES_SHOWN) : lines;
  const services = shown.filter((l) => !DEBT_KINDS.has(l.kind));
  const debt = shown.filter((l) => DEBT_KINDS.has(l.kind));
  const anyServices = lines.some((l) => !DEBT_KINDS.has(l.kind));
  const optionalCount = subscriptions.byKind?.optional?.count ?? 0;
  const sentence =
    subscriptions.sentence ??
    `${plural(optionalCount, 'optional service')} cost ${formatCurrencyAbs(subscriptions.optionalPerCycle ?? 0)} a cycle — ${formatCurrencyAbs(subscriptions.optionalPerYear ?? 0)} a year.`;

  return (
    <Card className={`materialize overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
        <CardHead
          title="Standing charges"
          subtitle="Every line that repeats, from the recurring engine: one merchant, one account, one price. Instalments and card repayments are listed but never totalled as subscriptions."
        />
        <div className="shrink-0 text-right">
          <div className="t-title num">{formatCurrencyAbs(subscriptions.optionalPerYear ?? 0)}</div>
          <div className="t-caption">a year on optional services</div>
        </div>
      </div>

      <p className="t-sub border-b px-6 py-4">{sentence}</p>

      {kinds.length > 0 && (
        <div className="flex flex-wrap gap-x-9 gap-y-4 border-b px-6 py-5">
          {kinds.map((k) => (
            <div key={k.kind}>
              <div className={`text-[10px] font-medium tracking-[0.08em] uppercase ${k.kind === 'optional' ? 'text-good' : 'text-label-3'}`}>
                {KIND_LABEL[k.kind] ?? k.kind}
              </div>
              <div className="num mt-1 text-[15px] font-semibold">
                {formatCurrencyAbs(k.perYear ?? (k.perCycle ?? 0) * 12)}
                <span className="ml-1.5 text-[11px] font-normal text-label-3">a year</span>
              </div>
              <div className="t-caption">
                {plural(k.count, 'line')} · {formatCurrencyAbs(k.perCycle ?? 0)} a cycle
              </div>
            </div>
          ))}
        </div>
      )}

      {!anyServices && (
        <p className="t-caption px-6 py-5">No standing charges found yet — the engine needs a few complete cycles.</p>
      )}

      {services.length > 0 && (
        <ol className="flex flex-col">
          {services.map((line) => (
            <LineRow key={line.id} line={line} override={overrideOf(line)} onSet={onSetLineOverride} asOf={today} />
          ))}
        </ol>
      )}

      {debt.length > 0 && (
        <>
          <div className="border-t bg-fill px-6 py-2.5 text-[11px] font-semibold tracking-wide text-label-3 uppercase">
            Instalments and repayments — debt, not subscriptions
          </div>
          <ol className="flex flex-col">
            {debt.map((line) => (
              <LineRow key={line.id} line={line} override={null} onSet={null} asOf={today} />
            ))}
          </ol>
        </>
      )}

      {collapsible && (
        <>
          {!showAll && (
            <p className="t-caption px-6 py-2.5 text-center">{`${shown.length} of ${lines.length} shown · totals cover all`}</p>
          )}
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="press w-full border-t bg-fill py-2.5 text-xs text-label-2 hover:text-label"
          >
            {showAll ? 'Show fewer' : `Show all ${lines.length} standing charges`}
          </button>
        </>
      )}

      {subscriptions.annualItems?.length > 0 && (
        <div className="border-t px-6 py-4">
          <div className="t-label">Once a year</div>
          <ul className="mt-2 flex flex-col gap-1 text-[13.5px] text-label-2">
            {subscriptions.annualItems.map((a) => (
              <li key={a.id}>
                {a.label}: {formatCurrencyAbs(a.amount)} — set aside{' '}
                <b className="num font-semibold text-label">{formatCurrencyAbs(a.setAsidePerCycle)}</b> a cycle
                {a.nextDate && ` · next ${relative(a.nextDate, today)}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {subscriptions.assumptions?.length > 0 && (
        <p className="t-caption border-t px-6 py-4">{subscriptions.assumptions.join(' ')}</p>
      )}
    </Card>
  );
}
