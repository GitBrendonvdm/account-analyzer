import { Card } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * The Savings Finder: one figure for what could be cancelled, and the list behind it.
 *
 * The old "standing commitments" total folded a bond in with a streaming service and invited you
 * to imagine cancelling a bond. This figure counts only things a phone call ends — optional
 * subscriptions, a price that crept, a second account's fee, a trial that converted — at high or
 * medium confidence, and says what share of the cycle's gap that covers. The behavioural items
 * (groceries drifting up, more trips to the same shop) are shown beside it, never inside it:
 * they are explanations of where the money went, not cuts anyone has agreed to. Card interest is
 * listed quietly at the foot for the same reason — it becomes a saving only once the balance is
 * paid down, which is the Debt view's subject.
 *
 * Every item is its ready sentence with the action as a chip, so the list can be read top to
 * bottom as a to-do rather than decoded from columns.
 */

const CONFIDENCE_CLASS = { high: 'bg-good', medium: 'border border-label-2', low: 'border border-dashed border-label-3' };
const KIND_LABEL = {
  subscription: 'subscription',
  ppi: 'payment protection',
  creep: 'price creep',
  consolidation: 'consolidation',
  'avoidable-fees': 'fees',
  'new-charge': 'new charge',
  minor: 'small/unproven',
  drift: 'drift',
  basket: 'trips',
  'card-interest': 'card interest',
};

/**
 * Below `sm` the row is sentence + amount on the first line and the chips on a line of their own
 * underneath: a 360px screen has no room for all three abreast, and the action chip's text must be
 * free to wrap rather than push the card wide. From `sm` up the row is the single wrapping line it
 * always was, so the desktop layout is untouched.
 */
function Item({ item }) {
  const kinds = item.kinds?.length ? item.kinds : [item.kind];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-3 first:border-t-0">
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${CONFIDENCE_CLASS[item.confidence] ?? CONFIDENCE_CLASS.low}`}
        title={`${item.confidence} confidence`}
      />
      <span className="min-w-0 flex-1 text-[14px] text-label-2 sm:flex-auto">
        {item.sentence ?? `${item.label}: ${formatCurrencyAbs(item.perCycle)} a cycle`}
      </span>
      <span className="order-last flex min-w-0 basis-full flex-wrap items-center gap-1.5 pl-5 sm:order-none sm:basis-auto sm:shrink-0 sm:pl-0">
        {kinds.map((k) => (
          <span key={k} className="rounded bg-fill px-1.5 py-0.5 text-[12px] text-label-3 sm:text-[10.5px]">
            {KIND_LABEL[k] ?? k}
          </span>
        ))}
        {item.bucket === 'behavioural' && (
          <span className="rounded bg-fill px-1.5 py-0.5 text-[12px] text-label-3 sm:text-[10.5px]">potential</span>
        )}
        {item.action && (
          <span className="glass-chip px-2.5 py-1 text-[12px] text-label sm:text-[11.5px]">{item.action}</span>
        )}
      </span>
      <span className={`num ml-auto shrink-0 text-right text-[14px] font-semibold sm:ml-0 sm:w-[92px] ${item.bucket === 'behavioural' ? 'text-label-2' : 'text-good'}`}>
        {formatCurrencyAbs(item.perCycle)}
      </span>
    </li>
  );
}

export function FindHero({ finder, className = '' }) {
  if (!finder) return null;
  const found = finder.found ?? 0;
  const pct = finder.cover == null ? null : Math.round(finder.cover * 100);
  const items = finder.items ?? [];
  const cancellable = items.filter((it) => it.bucket === 'cancellable');
  const behavioural = items.filter((it) => it.bucket === 'behavioural');
  const caption =
    finder.caption ??
    `${pct == null ? '' : `${pct}% of the ${formatCurrencyAbs(finder.deficit)} gap · `}${formatCurrencyAbs(finder.behaviouralPotential ?? 0)} more if the trips and drift below change`;

  return (
    <Card className={`materialize p-5 sm:p-8 ${className}`}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <div className="t-label">Savings finder</div>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3">
            <span className="t-title text-label-2">Found</span>
            <span className={`t-hero num ${found > 0 ? 'text-good' : 'text-label-2'}`}>{formatCurrencyAbs(found)}</span>
            <span className="t-title text-label-2">a cycle</span>
          </div>
          <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed text-label-2">{caption}</p>
          <p className="mt-1.5 text-[15px] text-label-2">
            {finder.realisedSentence ?? `Already saved ${formatCurrencyAbs(finder.realised ?? 0)} a cycle`}
          </p>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <div className="t-label">Cancellable</div>
              <div className="num mt-1 text-[17px] font-semibold text-good">{formatCurrencyAbs(found)}</div>
              <div className="t-caption">{cancellable.length} item{cancellable.length === 1 ? '' : 's'} · {formatCurrencyAbs(finder.foundPerYear ?? found * 12)} a year</div>
            </div>
            {/* The dividing rule only makes sense while the two sit side by side. */}
            <div className="sm:border-l sm:pl-8">
              <div className="t-label">Behavioural</div>
              <div className="num mt-1 text-[17px] font-semibold text-label-2">{formatCurrencyAbs(finder.behaviouralPotential ?? 0)}</div>
              <div className="t-caption">{behavioural.length} pattern{behavioural.length === 1 ? '' : 's'} · shown, never counted</div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          {items.length === 0 ? (
            <p className="t-caption">Nothing cancellable found yet — the finder needs a few complete cycles of standing charges.</p>
          ) : (
            <ol className="flex flex-col">
              {items.map((it) => (
                <Item key={it.id ?? `${it.kind}-${it.label}`} item={it} />
              ))}
            </ol>
          )}
          {finder.informational?.length > 0 && (
            <div className="mt-4 border-t pt-3">
              {finder.informational.map((it) => (
                <p key={it.id ?? it.label} className="t-caption">
                  {it.sentence ?? `${it.label}: ${formatCurrencyAbs(it.perCycle)} a cycle`}
                  {it.note ? ` — ${it.note}` : ' — becomes a saving only once the balance is paid down; see Debt.'}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      {finder.assumptions?.length > 0 && <p className="t-caption mt-5 border-t pt-4">{finder.assumptions.join(' ')}</p>}
    </Card>
  );
}
