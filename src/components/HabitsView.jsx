import { useState } from 'react';
import { formatCurrencyAbs } from '../utils/format';
import { Card, CardHead } from './ui/Surface';
import { FindHero } from './habits/FindHero';
import { SubscriptionsCard } from './habits/SubscriptionsCard';
import { DriftCard } from './habits/DriftCard';
import { WinsCard } from './habits/WinsCard';
import { BasketCard } from './habits/BasketCard';

const DAY_MONTH = { day: 'numeric', month: 'short' };
const fmtDate = (d) => (d ? d.toLocaleDateString('en-ZA', DAY_MONTH) : '—');

/** A merchant's spend across the visible cycles — shape, not values. */
function Spark({ values }) {
  const max = Math.max(...values, 1);
  return (
    <span className="hidden h-6 items-end gap-0.5 sm:inline-flex" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-sm bg-fill-2"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * Merchants as ranked rows rather than a spreadsheet.
 *
 * The previous version was eight columns of small figures, which is a lot of ink to answer "who do
 * I pay the most". A rank, a name, a share bar and one number answer it at a glance; cadence and
 * last visit are supporting detail and sit quieter.
 */
function MerchantList({ merchants, months }) {
  const max = Math.max(...merchants.map((m) => m.perCycle ?? 0), 1);
  return (
    <ol className="flex flex-col">
      {merchants.map((m, i) => (
        <li
          key={m.key}
          className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t px-4 py-3.5 transition-colors hover:bg-fill sm:grid-cols-[26px_minmax(0,14rem)_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-6"
        >
          <span className="num text-[13px] text-label-4">{i + 1}</span>

          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium">{m.label}</div>
            {/* Narrow screens let the cadence wrap: a truncated "Groceries · 103× · 23/2…" loses the point. */}
            <div className="t-caption sm:truncate">
              {m.category} · {m.count}× · {m.cyclesPresent}/{months.length} cycles
            </div>
          </div>

          <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
            <span className="block h-1.5 flex-grow overflow-hidden rounded-full bg-fill">
              <span
                className="block h-full rounded-full bg-info"
                style={{
                  width: `${Math.max(2, ((m.perCycle ?? 0) / max) * 100)}%`,
                  transition: 'width 600ms var(--ease-out)',
                }}
              />
            </span>
            <Spark values={m.perCycleTotals} />
          </div>

          <div className="text-right">
            <div className="num text-[15px] font-semibold">{formatCurrencyAbs(m.perCycle)}</div>
            <div className="t-caption">{fmtDate(m.lastSeen)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Spending habits: what could be cancelled, what bills you every cycle, what is new and what you
 * stopped, what changed, and — for what changed — whether it was more visits or a bigger basket;
 * then who gets the money and when in the week it goes.
 *
 * The order is the order of usefulness. The finder comes first because it is the one block with
 * a figure that can be acted on this week; the merchant ranking and the weekday chart are context
 * and sit last. The "standing commitments" and "what's changing" blocks of the previous version are
 * replaced by the standing-charges audit and the drift card, which answer the same questions from
 * the recurring engine and a robust statistic rather than from presence counts and half-window
 * means (see SubscriptionsCard and DriftCard for why that mattered).
 *
 * Price creep no longer gets a card of its own: every line's price step already shows inline on
 * the standing-charges audit, so a second card listing the same lines just repeated the same fact
 * (see SubscriptionsCard for the one thing that card added that the audit didn't). And the basket
 * card no longer ranks categories on its own window — it now drills into exactly the categories
 * the drift card flagged on drift's window, so the two can no longer print two different verdicts
 * for the same category (see BasketCard).
 *
 * Every analytics block is optional: the view renders whichever of its inputs have arrived and
 * leaves the others out, so a missing library never blanks the page.
 */
export function HabitsView({
  habits,
  finder,
  subscriptions,
  priceCreep,
  drift,
  basket,
  lineOverrides,
  onSetLineOverride,
  asOf,
}) {
  const [sortBy, setSortBy] = useState('spend');
  const anyAnalytics = Boolean(finder || subscriptions || priceCreep || drift || basket);
  if (!habits && !anyAnalytics) return null;

  const months = habits?.months ?? [];
  const merchants = habits
    ? (sortBy === 'spend' ? habits.topMerchants : habits.byFrequency).slice(0, 15)
    : [];
  const weekday = habits?.weekday ?? [];
  const weekMax = Math.max(...weekday.map((w) => w.perCycle), 1);
  // Basket's drill-down is scoped to exactly what Drift flagged, so the two cards read as one
  // explanation instead of two independent — and occasionally contradicting — rankings.
  const driftFlaggedCategories = drift?.flagged?.map((row) => row.category) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <FindHero finder={finder} />
      <SubscriptionsCard
        subscriptions={subscriptions}
        priceCreep={priceCreep}
        lineOverrides={lineOverrides}
        onSetLineOverride={onSetLineOverride}
        asOf={asOf}
      />
      <WinsCard subscriptions={subscriptions} />
      <DriftCard drift={drift} />
      <BasketCard basket={basket} flaggedCategories={driftFlaggedCategories} />

      {habits && (
        <Card className="materialize overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-5 sm:px-6">
            <CardHead
              title="Where the money goes"
              subtitle="By merchant rather than category — descriptions are stripped of card masks, references, billing dates and the trailing town so one shop reads as one line."
            />
            {/* Below `sm` the sort control spans the card and its two halves are 44px tall. */}
            <div className="glass-chip flex w-full shrink-0 gap-1 p-1 sm:w-auto">
              {[
                { id: 'spend', label: 'By amount' },
                { id: 'count', label: 'By frequency' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSortBy(opt.id)}
                  aria-pressed={sortBy === opt.id}
                  className={`press min-h-11 flex-1 rounded-full px-3.5 py-1.5 text-[12.5px] sm:min-h-0 sm:flex-none ${
                    sortBy === opt.id ? 'bg-fill-2 font-semibold' : 'text-label-2 hover:text-label'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <MerchantList merchants={merchants} months={months} />
        </Card>
      )}

      {habits && weekday.length > 0 && (
        <Card className="materialize overflow-hidden">
          <div className="border-b px-4 py-5 sm:px-6">
            <CardHead
              title="When you spend"
              subtitle={`${habits.busiest.day} is the heaviest day of the week, ${habits.quietest.day} the lightest.`}
            />
          </div>
          <div className="p-4 sm:p-6">
            {/*
              Each column is the full height of the strip and the bar is absolutely positioned at
              its foot: a percentage height on a block inside an auto-height flex column resolves
              to nothing, which is how the bars went missing. The strip is 7 × (gap + column) wide
              at 360px — the gap is the narrow one there so the label "Wed" never wraps.
            */}
            <div className="flex h-44 items-stretch gap-2 sm:gap-3">
              {weekday.map((w) => (
                <div key={w.day} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <span className="num text-[12px] text-label-3 sm:text-[11px]">
                    {Math.round(w.perCycle / 1000)}k
                  </span>
                  <div className="relative w-full flex-1">
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-t-md"
                      style={{
                        height: `${Math.max(4, (w.perCycle / weekMax) * 100)}%`,
                        background:
                          w.day === habits.busiest.day ? 'var(--color-info)' : 'var(--color-fill-2)',
                        transition: 'height 700ms var(--ease-out)',
                      }}
                      title={`${w.day}: ${formatCurrencyAbs(w.perCycle)} a cycle over ${w.count} transactions`}
                    />
                  </div>
                  <span className="text-[12px] font-medium text-label-2 sm:text-[11px]">{w.day}</span>
                </div>
              ))}
            </div>
            <p className="t-caption mt-5 border-t pt-4">
              Average spend per cycle by day of week. Transfers and loan-internal rows excluded.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
