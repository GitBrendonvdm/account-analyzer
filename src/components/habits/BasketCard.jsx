import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * Trips or tickets? — whether a category grew because you went more often or paid more per visit.
 *
 * "Groceries are up R2 800 a cycle" has two completely different fixes depending on the answer:
 * more trips is a habit (the top-up shop on the way home), a bigger basket is prices or what goes
 * in it. The basket library splits the change exactly — frequency × old ticket plus visits × ticket
 * change — so the two figures add to the whole and neither is a guess. The card shows the two
 * sparks (visits, mean ticket) so the eye can see which one moved, and the sentence states the
 * split in rand.
 *
 * The frequency figure is an explanation and is never counted as a saving: the finder shows it
 * under "behavioural" for that reason. A family row opens to its merchant families — one grocer's
 * branches pooled — because "more trips" is usually one shop's doing.
 */

const DRIVER_LABEL = { frequency: 'more trips', ticket: 'bigger basket', both: 'both' };
const trips = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0');

function Spark({ values, lateCount, tone }) {
  const nums = (values ?? []).map((v) => (Number.isFinite(v) ? v : 0));
  if (!nums.length) return null;
  const max = Math.max(...nums, 1e-9);
  const lateFrom = nums.length - (lateCount ?? 0);
  return (
    <span className="inline-flex h-6 items-end gap-0.5" aria-hidden="true">
      {nums.map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-sm"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            background: i >= lateFrom ? tone : 'var(--color-fill-2)',
          }}
        />
      ))}
    </span>
  );
}

function sentenceOf(f, windowNote) {
  const freq = f.delta?.frequency ?? 0;
  return (
    f.sentence ??
    `${f.label}: ${trips(f.early?.visitsPerCycle)} → ${trips(f.late?.visitsPerCycle)} trips a cycle, basket ${formatCurrencyAbs(f.early?.meanTicket)} → ${formatCurrencyAbs(f.late?.meanTicket)}. ${freq >= 0 ? 'More' : 'Fewer'} trips explain ${formatCurrencyAbs(freq)} of the ${formatCurrencyAbs(f.delta?.spend)} change (${windowNote}).`
  );
}

function FamilyRow({ family, members, windowNote, lateCount, open, onToggle }) {
  const series = family.seriesByCycle ?? [];
  const up = (family.delta?.spend ?? 0) > 0;
  const canOpen = members.length > 0;
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        onClick={canOpen ? onToggle : undefined}
        aria-expanded={canOpen ? open : undefined}
        className={`flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4 text-left ${canOpen ? 'transition-colors hover:bg-fill' : 'cursor-default'}`}
      >
        <span className="flex min-w-0 flex-grow items-center gap-2 text-[15px] font-medium">
          {canOpen && (open ? <ChevronDown size={14} className="text-label-3" /> : <ChevronRight size={14} className="text-label-3" />)}
          <span className="truncate">{family.label}</span>
          <span className="rounded bg-fill px-1.5 py-0.5 text-[10.5px] font-normal text-label-3">
            {DRIVER_LABEL[family.driver] ?? family.driver}
          </span>
        </span>
        <span className="flex items-center gap-5">
          <span className="flex flex-col items-end gap-0.5">
            <Spark values={series.map((c) => c.visits)} lateCount={lateCount} tone="var(--color-info)" />
            <span className="text-[10px] text-label-4">trips</span>
          </span>
          <span className="flex flex-col items-end gap-0.5">
            <Spark values={series.map((c) => c.meanTicket)} lateCount={lateCount} tone="var(--color-mint)" />
            <span className="text-[10px] text-label-4">basket</span>
          </span>
        </span>
        <span className={`num w-[92px] shrink-0 text-right text-[15px] font-semibold ${up ? 'text-bad' : 'text-good'}`}>
          {up ? '+' : '−'}
          {formatCurrencyAbs(family.delta?.spend)}
        </span>
        <span className="w-full text-[13.5px] text-label-2">{sentenceOf(family, windowNote)}</span>
      </button>
      {open && members.length > 0 && (
        <ul className="border-t bg-fill/50 px-6 py-2">
          {members.map((m) => (
            <li key={m.merchantFamily ?? m.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5 text-[13px]">
              <span className="text-label-2">{sentenceOf(m, windowNote)}</span>
              <span className="t-caption">{DRIVER_LABEL[m.driver] ?? m.driver}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function BasketCard({ basket, className = '' }) {
  const [open, setOpen] = useState(() => new Set());
  if (!basket) return null;
  const families = basket.families ?? [];
  const categories = families.filter((f) => !f.merchantFamily);
  const membersOf = (cat) => families.filter((f) => f.merchantFamily && f.category === cat.category);
  const lateCount = basket.late?.cycles?.length ?? 0;
  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card className={`materialize overflow-hidden ${className}`}>
      <div className="border-b px-6 py-5">
        <CardHead
          title="Trips or tickets?"
          subtitle={`Whether each family of spend changed because of more visits or a bigger basket — ${basket.windowNote ?? 'recent cycles against earlier ones'}. The two parts add exactly to the change.`}
        />
      </div>
      {categories.length === 0 ? (
        <p className="t-caption px-6 py-5">Needs a few more complete cycles before trips and tickets can be told apart.</p>
      ) : (
        <ol className="flex flex-col">
          {categories.map((f) => (
            <FamilyRow
              key={f.category}
              family={f}
              members={membersOf(f)}
              windowNote={basket.windowNote}
              lateCount={lateCount}
              open={open.has(f.category)}
              onToggle={() => toggle(f.category)}
            />
          ))}
        </ol>
      )}
      {basket.assumptions?.length > 0 && <p className="t-caption border-t px-6 py-4">{basket.assumptions.join(' ')}</p>}
    </Card>
  );
}
