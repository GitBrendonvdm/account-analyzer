import { useState } from 'react';
import { ArrowDown, ArrowUp, Repeat } from 'lucide-react';
import { formatCurrencyAbs } from '../utils/format';
import { Card, CardHead } from './ui/Surface';

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
          className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t px-6 py-3.5 transition-colors hover:bg-fill sm:grid-cols-[26px_minmax(0,14rem)_minmax(0,1fr)_auto]"
        >
          <span className="num text-[13px] text-label-4">{i + 1}</span>

          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium">{m.label}</div>
            <div className="t-caption truncate">
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

function Movers({ items, direction }) {
  const rising = direction === 'up';
  const rows = items.filter((m) => (rising ? m.delta > 0 : m.delta < 0)).slice(0, 6);
  const max = Math.max(...rows.map((m) => Math.abs(m.delta)), 1);

  return (
    <div className="p-6">
      <div
        className={`mb-4 flex items-center gap-2 text-[13px] font-semibold ${rising ? 'text-bad' : 'text-good'}`}
      >
        {rising ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        {rising ? 'Rising' : 'Falling'}
      </div>
      <ul className="flex flex-col gap-4">
        {rows.length === 0 && (
          <li className="t-caption">Nothing {rising ? 'rising' : 'falling'}.</li>
        )}
        {rows.map((m) => (
          <li key={m.category} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="truncate text-label-2">{m.category}</span>
              <span className={`num shrink-0 font-semibold ${rising ? 'text-bad' : 'text-good'}`}>
                {rising ? '+' : '−'}
                {formatCurrencyAbs(m.delta)}
              </span>
            </div>
            <span className="block h-1 overflow-hidden rounded-full bg-fill">
              <span
                className={`block h-full rounded-full ${rising ? 'bg-bad' : 'bg-good'}`}
                style={{ width: `${Math.max(3, (Math.abs(m.delta) / max) * 100)}%` }}
              />
            </span>
            <span className="t-caption">
              {formatCurrencyAbs(m.early)} → {formatCurrencyAbs(m.late)} a cycle
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Spending habits: who gets the money, what bills you every cycle, what is shifting, and when in
 * the week it happens. All of it was in the data long before it had anywhere to appear.
 */
export function HabitsView({ habits }) {
  const [sortBy, setSortBy] = useState('spend');
  if (!habits) return null;

  const { subscriptions, movers, weekday, busiest, quietest, months } = habits;
  const merchants = (sortBy === 'spend' ? habits.topMerchants : habits.byFrequency).slice(0, 15);
  const weekMax = Math.max(...weekday.map((w) => w.perCycle), 1);

  return (
    <div className="flex flex-col gap-5">
      <Card className="materialize overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
          <CardHead
            title="Where the money goes"
            subtitle="By merchant rather than category — descriptions are stripped of card masks, references, billing dates and the trailing town so one shop reads as one line."
          />
          <div className="glass-chip flex shrink-0 gap-1 p-1">
            {[
              { id: 'spend', label: 'By amount' },
              { id: 'count', label: 'By frequency' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                aria-pressed={sortBy === opt.id}
                className={`press rounded-full px-3.5 py-1.5 text-[12.5px] ${
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

      <Card className="materialize overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
          <CardHead
            title="Standing commitments"
            subtitle="Merchants that billed in nearly every cycle. Instalments and policies stay separate, because a total folding a bond in with a streaming service invites you to imagine cancelling a bond."
          />
          <div className="shrink-0 text-right">
            <div className="t-title num">{formatCurrencyAbs(subscriptions.total)}</div>
            <div className="t-caption">
              a cycle · {formatCurrencyAbs(subscriptions.total * 12)} a year
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-9 gap-y-4 border-b px-6 py-5">
          {subscriptions.byGroup.map((g) => (
            <div key={g.group}>
              <div className="text-[10px] font-medium tracking-[0.08em] text-label-3 uppercase">
                {g.group}
              </div>
              <div className="num mt-1 text-[15px] font-semibold">
                {formatCurrencyAbs(g.perCycle)}
              </div>
            </div>
          ))}
          <div className="border-l pl-9">
            <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.08em] text-good uppercase">
              <Repeat size={11} /> Optional services
            </div>
            <div className="num mt-1 text-[15px] font-semibold text-good">
              {formatCurrencyAbs(subscriptions.cancellableTotal)}
              <span className="ml-2 text-[12px] font-normal text-label-3">
                {subscriptions.cancellable.length} merchants
              </span>
            </div>
          </div>
        </div>

        <MerchantList merchants={subscriptions.items.slice(0, 12)} months={months} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="materialize overflow-hidden">
          <div className="border-b px-6 py-5">
            <CardHead
              title="What's changing"
              subtitle={`The last ${Math.ceil(months.length / 2)} cycles against the ${Math.floor(months.length / 2)} before them.`}
            />
          </div>
          <div className="grid gap-px bg-hair sm:grid-cols-2">
            <div style={{ background: 'rgba(255,255,255,0.012)' }}>
              <Movers items={movers} direction="up" />
            </div>
            <div style={{ background: 'rgba(255,255,255,0.012)' }}>
              <Movers items={movers} direction="down" />
            </div>
          </div>
        </Card>

        <Card className="materialize overflow-hidden">
          <div className="border-b px-6 py-5">
            <CardHead
              title="When you spend"
              subtitle={`${busiest.day} is the heaviest day of the week, ${quietest.day} the lightest.`}
            />
          </div>
          <div className="p-6">
            <div className="flex h-44 items-end gap-3">
              {weekday.map((w) => (
                <div key={w.day} className="flex flex-1 flex-col items-center gap-2">
                  <span className="num text-[11px] text-label-3">
                    {Math.round(w.perCycle / 1000)}k
                  </span>
                  <div
                    className="w-full rounded-t-md"
                    style={{
                      height: `${Math.max(4, (w.perCycle / weekMax) * 100)}%`,
                      background:
                        w.day === busiest.day ? 'var(--color-info)' : 'var(--color-fill-2)',
                      transition: 'height 700ms var(--ease-out)',
                    }}
                    title={`${w.day}: ${formatCurrencyAbs(w.perCycle)} a cycle over ${w.count} transactions`}
                  />
                  <span className="text-[11px] font-medium text-label-2">{w.day}</span>
                </div>
              ))}
            </div>
            <p className="t-caption mt-5 border-t pt-4">
              Average spend per cycle by day of week. Transfers and loan-internal rows excluded.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
