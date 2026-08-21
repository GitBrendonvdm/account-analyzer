import { useState } from 'react';
import { ArrowDown, ArrowUp, Repeat, Store } from 'lucide-react';
import { formatCurrencyAbs } from '../utils/format';

const DAY_MONTH = { day: 'numeric', month: 'short' };
const fmtDate = (d) => (d ? d.toLocaleDateString('en-ZA', DAY_MONTH) : '—');

function Panel({ title, subtitle, children, right }) {
  return (
    <section className="glass overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-6 py-5">
        <div>
          <h2 className="t-head">{title}</h2>
          {subtitle && <p className="t-label mt-1.5 max-w-prose">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A merchant's spend across the visible cycles, as a bar per cycle. */
function Spark({ values }) {
  const max = Math.max(...values, 1);
  return (
    <span className="inline-flex h-6 items-end gap-0.5" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-sm bg-fill-2"
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

function MerchantTable({ merchants, months }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-transparent">
          <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase">
            <th className="border-b px-6 py-2.5">Merchant</th>
            <th className="border-b px-4 py-2.5">Category</th>
            <th className="border-b px-4 py-2.5 text-right">Per cycle</th>
            <th className="border-b px-4 py-2.5 text-right">Times</th>
            <th className="border-b px-4 py-2.5 text-right">Cycles</th>
            <th className="border-b px-4 py-2.5">Pattern</th>
            <th className="border-b px-4 py-2.5 text-right">Last</th>
          </tr>
        </thead>
        <tbody>
          {merchants.map((m) => (
            <tr key={m.key} className="border-b last:border-0 hover:bg-fill">
              <td className="px-6 py-2.5 font-medium text-label">{m.label}</td>
              <td className="px-4 py-2.5 text-xs text-label-2">{m.category}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrencyAbs(m.perCycle)}</td>
              <td className="px-4 py-2.5 text-right text-label-2 tabular-nums">{m.count}</td>
              <td className="px-4 py-2.5 text-right text-label-2 tabular-nums">
                {m.cyclesPresent}/{months.length}
              </td>
              <td className="px-4 py-2.5">
                <Spark values={m.perCycleTotals} />
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-label-2">{fmtDate(m.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Spending habits: who gets the money, what bills you every cycle, what's shifting, and when in the
 * week it happens. All of it was already in the data — none of it had anywhere to appear.
 */
export function HabitsView({ habits }) {
  const [sortBy, setSortBy] = useState('spend');
  if (!habits) return null;

  const { subscriptions, movers, weekday, busiest, quietest, months } = habits;
  const merchants = sortBy === 'spend' ? habits.topMerchants : habits.byFrequency;
  const weekMax = Math.max(...weekday.map((w) => w.perCycle), 1);
  const up = movers.filter((m) => m.delta > 0).slice(0, 6);
  const down = movers.filter((m) => m.delta < 0).slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Where the money goes"
        subtitle="Grouped by merchant rather than category — descriptions are stripped of card masks, references, billing dates and the trailing town so the same shop reads as one line."
        right={
          <div className="flex gap-1 glass-tile p-0.5 text-xs">
            {[
              { id: 'spend', label: 'By amount' },
              { id: 'count', label: 'By frequency' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                className={`rounded-md px-3 py-1.5 ${
                  sortBy === opt.id ? 'bg-fill-2 text-white' : 'text-label-2 hover:bg-fill'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      >
        <MerchantTable merchants={merchants} months={months} />
      </Panel>

      <Panel
        title="Standing commitments"
        subtitle="Merchants that billed in nearly every cycle. The instalments and policies are separated out, because a total that folds a bond in with a streaming service invites you to imagine cancelling a bond."
        right={
          <div className="text-right">
            <div className="text-xl font-semibold text-label tabular-nums">
              {formatCurrencyAbs(subscriptions.total)}
            </div>
            <div className="t-label">
              per cycle · {formatCurrencyAbs(subscriptions.total * 12)} a year
            </div>
          </div>
        }
      >
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-b px-6 py-5">
          {subscriptions.byGroup.map((g) => (
            <div key={g.group}>
              <div className="text-[11px] tracking-wide text-label-2 uppercase">{g.group}</div>
              <div className="text-sm font-medium text-label tabular-nums">
                {formatCurrencyAbs(g.perCycle)}
              </div>
            </div>
          ))}
          <div className="border-l pl-8">
            <div className="flex items-center gap-1.5 text-[11px] tracking-wide text-good uppercase">
              <Repeat size={11} /> Optional services
            </div>
            <div className="text-sm font-medium text-good tabular-nums">
              {formatCurrencyAbs(subscriptions.cancellableTotal)} · {subscriptions.cancellable.length} merchants
            </div>
          </div>
        </div>
        <MerchantTable merchants={subscriptions.items.slice(0, 25)} months={months} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="What's changing"
          subtitle={`The last ${Math.ceil(months.length / 2)} cycles against the ${Math.floor(months.length / 2)} before them.`}
        >
          <div className="grid gap-px bg-fill sm:grid-cols-2">
            <div className="bg-transparent p-5">
              <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-bad">
                <ArrowUp size={13} /> Rising
              </div>
              <ul className="space-y-2">
                {up.length === 0 && <li className="text-xs text-label-3">Nothing rising.</li>}
                {up.map((m) => (
                  <li key={m.category} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-label-2">{m.category}</span>
                    <span className="shrink-0 font-medium text-bad tabular-nums">
                      +{formatCurrencyAbs(m.delta)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-transparent p-5">
              <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-good">
                <ArrowDown size={13} /> Falling
              </div>
              <ul className="space-y-2">
                {down.length === 0 && <li className="text-xs text-label-3">Nothing falling.</li>}
                {down.map((m) => (
                  <li key={m.category} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-label-2">{m.category}</span>
                    <span className="shrink-0 font-medium text-good tabular-nums">
                      −{formatCurrencyAbs(m.delta)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>

        <Panel
          title="When you spend"
          subtitle={`${busiest.day} is the heaviest day of the week, ${quietest.day} the lightest.`}
        >
          <div className="p-6">
            <div className="flex h-40 items-end gap-3">
              {weekday.map((w) => (
                <div key={w.day} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-[11px] text-label-2 tabular-nums">
                    {Math.round(w.perCycle / 1000)}k
                  </span>
                  <div
                    className={`w-full rounded-t ${w.day === busiest.day ? 'bg-info' : 'bg-fill'}`}
                    style={{ height: `${Math.max(4, (w.perCycle / weekMax) * 100)}%` }}
                    title={`${w.day}: ${formatCurrencyAbs(w.perCycle)} a cycle over ${w.count} transactions`}
                  />
                  <span className="text-[11px] font-medium text-label-2">{w.day}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 flex items-start gap-1.5 border-t pt-3 text-xs text-label-2">
              <Store size={13} className="mt-0.5 shrink-0" />
              Average spend per cycle by day of week, transfers and loan-internal rows excluded.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
