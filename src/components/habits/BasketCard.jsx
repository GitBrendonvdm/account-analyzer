import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * More visits, or bigger baskets? — for the categories Drift already flagged, whether the change
 * came from going more often or paying more per visit.
 *
 * This card used to rank every tracked category on its own window (the last six cycles against
 * the six before), independently of what DriftCard flagged over ITS window (the last three against
 * a twelve-cycle baseline). Two windows meant two verdicts could disagree on the same category with
 * nothing on screen explaining why — Drift says groceries are up, Basket's own ranking says they
 * are roughly flat. Rather than reconcile the windows, this card now answers a narrower question:
 * of the categories Drift already called out as changed, which ones changed because of more trips
 * and which because of a bigger basket. `flaggedCategories` (the category names on DriftCard's
 * `flagged` rows) is the filter, so the two cards can no longer contradict each other — Basket only
 * ever drills into what Drift already said moved.
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

/**
 * The row is one button so the whole of it opens the family. From `sm` up it reads name · sparks ·
 * change on a line with the sentence beneath; below `sm` the change sits beside the name and the
 * two sparks take a line of their own, done with `order` so the markup stays in the desktop order.
 */
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
        className={`flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 text-left sm:px-6 ${canOpen ? 'transition-colors hover:bg-fill' : 'cursor-default'}`}
      >
        {/* Narrow: the name may wrap and the driver tag drops under it whole; wide: one truncating line. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[15px] font-medium sm:flex-auto sm:flex-nowrap">
          {canOpen && (open ? <ChevronDown size={14} className="text-label-3" /> : <ChevronRight size={14} className="text-label-3" />)}
          <span className="sm:truncate">{family.label}</span>
          <span className="rounded bg-fill px-1.5 py-0.5 text-[12px] font-normal whitespace-nowrap text-label-3 sm:text-[10.5px]">
            {DRIVER_LABEL[family.driver] ?? family.driver}
          </span>
        </span>
        <span className="order-2 flex basis-full items-center gap-5 sm:order-none sm:basis-auto">
          <span className="flex flex-col items-end gap-0.5">
            <Spark values={series.map((c) => c.visits)} lateCount={lateCount} tone="var(--color-info)" />
            <span className="text-[12px] text-label-4 sm:text-[10px]">trips</span>
          </span>
          <span className="flex flex-col items-end gap-0.5">
            <Spark values={series.map((c) => c.meanTicket)} lateCount={lateCount} tone="var(--color-mint)" />
            <span className="text-[12px] text-label-4 sm:text-[10px]">basket</span>
          </span>
        </span>
        <span className={`num order-1 ml-auto shrink-0 text-right text-[15px] font-semibold sm:order-none sm:ml-0 sm:w-[92px] ${up ? 'text-bad' : 'text-good'}`}>
          {up ? '+' : '−'}
          {formatCurrencyAbs(family.delta?.spend)}
        </span>
        <span className="order-3 w-full text-[13.5px] text-label-2 sm:order-none">{sentenceOf(family, windowNote)}</span>
      </button>
      {open && members.length > 0 && (
        <ul className="border-t bg-fill/50 px-4 py-2 sm:px-6">
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

export function BasketCard({ basket, flaggedCategories = [], className = '' }) {
  const [open, setOpen] = useState(() => new Set());
  if (!basket) return null;
  const families = basket.families ?? [];
  const flaggedSet = new Set(flaggedCategories);
  const allCategories = families.filter((f) => !f.merchantFamily);
  const categories = allCategories.filter((f) => flaggedSet.has(f.category));
  const membersOf = (cat) => families.filter((f) => f.merchantFamily && f.category === cat.category);
  const lateCount = basket.late?.cycles?.length ?? 0;
  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const emptyMessage =
    allCategories.length === 0
      ? 'Needs a few more complete cycles before trips and tickets can be told apart.'
      : flaggedSet.size === 0
        ? 'Nothing to drill into — What changed above found nothing outside its usual range this cycle.'
        : 'None of the categories What changed flagged are ones this breakdown tracks (groceries, fuel, eating out, coffee, personal care, pets, alcohol).';

  return (
    <Card className={`materialize overflow-hidden ${className}`}>
      <div className="border-b px-4 py-5 sm:px-6">
        <CardHead
          title="More visits, or bigger baskets?"
          subtitle={`Trips or tickets? For the categories What changed flagged above: whether the move was more visits or a bigger basket — ${basket.windowNote ?? 'recent cycles against earlier ones'}. The two parts add exactly to the change.`}
        />
      </div>
      {categories.length === 0 ? (
        <p className="t-caption px-4 py-5 sm:px-6">{emptyMessage}</p>
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
      {basket.assumptions?.length > 0 && <p className="t-caption border-t px-4 py-4 sm:px-6">{basket.assumptions.join(' ')}</p>}
    </Card>
  );
}
