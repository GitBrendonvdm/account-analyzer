import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Flag, Scissors, Target, Wallet } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../utils/format';
import { suggestTarget } from '../lib/budgets';

const DAY_MONTH = { day: 'numeric', month: 'short' };
const MONTH_YEAR = { month: 'short', year: '2-digit' };

function Panel({ title, subtitle, children, right }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
      {/* Static class: Tailwind can't see a class name assembled at runtime. */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b bg-slate-50 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="mt-1 max-w-prose text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ safe to spend */

function SafeToSpend({ safe, summary }) {
  if (!safe) return null;
  const negative = safe.safe <= 0;
  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <Wallet size={13} /> Safe to spend
          </div>
          <div
            className={`mt-1 text-4xl font-semibold tabular-nums ${negative ? 'text-red-600' : 'text-emerald-600'}`}
          >
            {formatCurrency(safe.safe)}
          </div>
          <p className="mt-1.5 max-w-md text-xs text-slate-500">
            {negative ? (
              <>
                The bills still due before payday come to more than what's left. This isn't a budget
                to spend — it's the size of the hole.
              </>
            ) : (
              <>
                {formatCurrencyAbs(safe.perDay)} a day across {safe.daysLeft} day
                {safe.daysLeft === 1 ? '' : 's'} to payday, after every bill still due is set aside.
              </>
            )}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">In so far</dt>
            <dd className="mt-0.5 font-medium text-slate-800 tabular-nums">
              {formatCurrencyAbs(summary.income.received)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Out so far</dt>
            <dd className="mt-0.5 font-medium text-slate-800 tabular-nums">
              {formatCurrencyAbs(summary.expense.spent)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Still expected in</dt>
            <dd className="mt-0.5 font-medium text-emerald-600 tabular-nums">
              {formatCurrencyAbs(safe.incomeStillExpected)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Bills still due</dt>
            <dd className="mt-0.5 font-medium text-red-600 tabular-nums">
              −{formatCurrencyAbs(safe.committed)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Forecast to spend</dt>
            <dd className="mt-0.5 font-medium text-slate-600 tabular-nums">
              {formatCurrencyAbs(safe.discretionaryForecast)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">If you follow it</dt>
            <dd
              className={`mt-0.5 font-medium tabular-nums ${safe.forecastGap < 0 ? 'text-red-600' : 'text-emerald-600'}`}
            >
              {formatCurrency(safe.forecastGap)}
            </dd>
          </div>
        </dl>
      </div>

      {safe.bills.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4 text-xs">
          <span className="font-medium text-slate-600">Set aside for:</span>
          {safe.bills.slice(0, 8).map((b) => (
            <span key={b.name} className="rounded bg-slate-100 px-2 py-1 text-slate-700">
              {b.name} · {formatCurrencyAbs(b.amount)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ targets */

const STATUS_STYLE = {
  over: 'bg-red-500',
  tight: 'bg-amber-400',
  under: 'bg-emerald-500',
  none: 'bg-slate-200',
};

function TargetRow({ row, onSet }) {
  const [draft, setDraft] = useState(row.target == null ? '' : String(row.target));
  const pct = row.target ? Math.min(150, (row.projected / row.target) * 100) : 0;

  const commit = () => {
    const v = parseFloat(draft.replace(/[^\d.]/g, ''));
    onSet(row.category, Number.isFinite(v) && v > 0 ? v : null);
  };

  return (
    <tr className="border-b last:border-0">
      <td className="px-6 py-2.5">
        <span className="text-sm text-slate-800">{row.category}</span>
        {row.isBill && (
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            bill
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-slate-500 tabular-nums">
        {formatCurrencyAbs(row.typical)}
      </td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums">{formatCurrencyAbs(row.spent)}</td>
      <td className="px-4 py-2.5 text-right text-sm font-medium tabular-nums">
        {formatCurrencyAbs(row.projected)}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">R</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            inputMode="decimal"
            placeholder={String(suggestTarget(row.typical))}
            aria-label={`Target for ${row.category}`}
            className="w-24 rounded border px-2 py-1 text-right text-sm tabular-nums focus:border-blue-400 focus:outline-none"
          />
        </div>
      </td>
      <td className="px-4 py-2.5">
        {row.target ? (
          <div className="flex items-center gap-2">
            <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
              <span
                className={`block h-full rounded-full ${STATUS_STYLE[row.status]}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </span>
            <span
              className={`text-xs tabular-nums ${
                row.status === 'over' ? 'font-medium text-red-600' : 'text-slate-500'
              }`}
            >
              {row.status === 'over' ? `+${formatCurrencyAbs(row.over)}` : `${Math.round(pct)}%`}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-300">no target</span>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ trajectory */

function TrajectoryChart({ trajectory }) {
  const data = useMemo(
    () =>
      (trajectory?.points ?? []).map((p) => ({
        cycle: p.cycle,
        label: p.date ? p.date.toLocaleDateString('en-ZA', MONTH_YEAR) : `+${p.cycle}`,
        net: Math.round(p.net),
        debt: Math.round(-p.debt),
        assets: Math.round(p.assets),
      })),
    [trajectory],
  );
  if (!data.length) return null;

  return (
    <div className="h-72 w-full px-2 py-4">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          />
          <Tooltip
            formatter={(v, name) => [formatCurrency(v), name]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Area type="monotone" dataKey="assets" name="Held" stroke="#10b981" fill="#d1fae5" strokeWidth={1.5} />
          <Area type="monotone" dataKey="debt" name="Owed" stroke="#ef4444" fill="#fee2e2" strokeWidth={1.5} />
          <Line type="monotone" dataKey="net" name="Net worth" stroke="#1e293b" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ the view */

export function PlanView({
  safe,
  summary,
  budgets,
  onSetTarget,
  trajectory,
  monthlySaving,
  onMonthlySavingChange,
  gapClosers,
  goals,
  onAddGoal,
  onRemoveGoal,
}) {
  const [showAll, setShowAll] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ name: '', target: '', saved: '' });

  const rows = budgets ? (showAll ? budgets.rows : budgets.rows.slice(0, 12)) : [];

  return (
    <div className="space-y-6">
      <SafeToSpend safe={safe} summary={summary} />

      <Panel
        title="Targets"
        subtitle="Judged against where the cycle is heading — spend so far plus what's still forecast — rather than against spend so far, which is meaningless on day three."
        right={
          budgets?.withTargets.length > 0 && (
            <div className="text-right">
              <div
                className={`text-lg font-semibold tabular-nums ${
                  budgets.status === 'over' ? 'text-red-600' : 'text-emerald-600'
                }`}
              >
                {formatCurrencyAbs(budgets.totalProjected)} / {formatCurrencyAbs(budgets.totalTarget)}
              </div>
              <div className="text-xs text-slate-500">
                {budgets.overBy > 0
                  ? `heading ${formatCurrencyAbs(budgets.overBy)} over`
                  : `${formatCurrencyAbs(-budgets.overBy)} of room`}
              </div>
            </div>
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="border-b px-6 py-2.5">Category</th>
                <th className="border-b px-4 py-2.5 text-right">Typical</th>
                <th className="border-b px-4 py-2.5 text-right">So far</th>
                <th className="border-b px-4 py-2.5 text-right">Heading for</th>
                <th className="border-b px-4 py-2.5">Target</th>
                <th className="border-b px-4 py-2.5">Against target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <TargetRow key={r.category} row={r} onSet={onSetTarget} />
              ))}
            </tbody>
          </table>
        </div>
        {budgets && budgets.rows.length > 12 && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="w-full border-t bg-slate-50 py-2.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            {showAll ? 'Show fewer' : `Show all ${budgets.rows.length} categories`}
          </button>
        )}
      </Panel>

      {gapClosers && (
        <Panel
          title="Closing the gap"
          subtitle="Ranked by what a category could plausibly give up, not by size — the bond is the biggest line in the data and suggesting you cut it would be useless."
          right={
            <div className="text-right">
              <div className="text-lg font-semibold text-slate-900 tabular-nums">
                {formatCurrencyAbs(gapClosers.gap)}
              </div>
              <div className="text-xs text-slate-500">to find each cycle</div>
            </div>
          }
        >
          <div className="p-6">
            {gapClosers.plan.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing discretionary large enough to matter.</p>
            ) : (
              <>
                <ul className="space-y-2.5">
                  {gapClosers.plan.map((c) => (
                    <li key={c.name} className="flex items-center gap-3">
                      <Scissors size={13} className="shrink-0 text-slate-400" />
                      <span className="w-48 shrink-0 truncate text-sm text-slate-800">{c.name}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.min(100, c.cutPercent * 100)}%` }}
                        />
                      </span>
                      <span className="w-44 shrink-0 text-right text-xs text-slate-600 tabular-nums">
                        cut {formatCurrencyAbs(c.cut)} of {formatCurrencyAbs(c.typical)} (
                        {Math.round(c.cutPercent * 100)}%)
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t pt-3 text-xs text-slate-500">
                  {gapClosers.closed ? (
                    <>
                      Those cuts come to{' '}
                      <b className="font-semibold text-slate-800">
                        {formatCurrencyAbs(gapClosers.found)}
                      </b>{' '}
                      a cycle, which closes it.
                    </>
                  ) : (
                    <>
                      Even cutting all of these leaves{' '}
                      <b className="font-semibold text-red-600">
                        {formatCurrencyAbs(gapClosers.shortfall)}
                      </b>{' '}
                      a cycle unaccounted for — the gap is structural, not discretionary.
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        </Panel>
      )}

      {trajectory && (
        <Panel
          title="If nothing changes"
          subtitle={`Every account continued at the pace it has actually been moving over the visible window. A projection of the recent past, not a prediction.${trajectory.absorber ? ` The shortfall lands on the ${trajectory.absorber}.` : ''}`}
          right={
            <label className="flex items-center gap-2 text-xs text-slate-600">
              Save per cycle
              <input
                type="range"
                min="0"
                max="20000"
                step="500"
                value={monthlySaving}
                onChange={(e) => onMonthlySavingChange(parseInt(e.target.value, 10))}
                className="w-32 accent-blue-600"
                aria-label="Extra saving per cycle"
              />
              <span className="w-20 text-right font-medium tabular-nums">
                {formatCurrencyAbs(monthlySaving)}
              </span>
            </label>
          }
        >
          <TrajectoryChart trajectory={trajectory} />
          <div className="flex flex-wrap gap-x-8 gap-y-2 border-t bg-slate-50 px-6 py-4 text-xs">
            <div>
              <span className="text-slate-500">Net worth in {trajectory.horizon} cycles: </span>
              <b className={`tabular-nums ${trajectory.endNet < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {formatCurrency(trajectory.endNet)}
              </b>
              <span className="text-slate-400">
                {' '}
                ({trajectory.change >= 0 ? '+' : '−'}
                {formatCurrencyAbs(trajectory.change)})
              </span>
            </div>
            {trajectory.events.map((e) => (
              <div key={`${e.type}-${e.account}`} className={e.type === 'limit' ? 'text-red-600' : 'text-emerald-600'}>
                {e.account} {e.type === 'limit' ? 'hits its limit' : 'is cleared'} in {e.cycle} cycle
                {e.cycle === 1 ? '' : 's'}
                {e.date && ` (${e.date.toLocaleDateString('en-ZA', DAY_MONTH)})`}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Goals"
        subtitle="Arrival dates come from what you actually keep each cycle. When that's negative the honest answer is that the goal doesn't arrive, and the app says how much would have to be found first."
      >
        <div className="p-6">
          {goals.goals.length > 0 && (
            <ul className="mb-5 space-y-3">
              {goals.goals.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-3">
                  <Flag size={14} className="shrink-0 text-slate-400" />
                  <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-800">
                    {g.name}
                  </span>
                  <span className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-emerald-500"
                      style={{ width: `${g.progress * 100}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-xs text-slate-600 tabular-nums">
                    {formatCurrencyAbs(g.saved)} / {formatCurrencyAbs(g.target)}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${g.reachable ? 'text-slate-600' : 'text-amber-700'}`}
                  >
                    {g.reachable
                      ? g.cycles === 0
                        ? 'reached'
                        : `${g.cycles} cycles · ${g.eta.toLocaleDateString('en-ZA', MONTH_YEAR)}`
                      : 'not while the cycle closes negative'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveGoal(g.id)}
                    className="ml-auto shrink-0 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const target = parseFloat(goalDraft.target.replace(/[^\d.]/g, ''));
              if (!goalDraft.name.trim() || !(target > 0)) return;
              onAddGoal({
                name: goalDraft.name.trim(),
                target,
                saved: parseFloat(goalDraft.saved.replace(/[^\d.]/g, '')) || 0,
              });
              setGoalDraft({ name: '', target: '', saved: '' });
            }}
          >
            <label className="text-xs text-slate-500">
              <span className="mb-1 block">Goal</span>
              <input
                value={goalDraft.name}
                onChange={(e) => setGoalDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Emergency fund"
                className="w-48 rounded border px-2.5 py-1.5 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-500">
              <span className="mb-1 block">Target</span>
              <input
                value={goalDraft.target}
                onChange={(e) => setGoalDraft((d) => ({ ...d, target: e.target.value }))}
                placeholder="50000"
                inputMode="decimal"
                className="w-28 rounded border px-2.5 py-1.5 text-right text-sm tabular-nums focus:border-blue-400 focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-500">
              <span className="mb-1 block">Already saved</span>
              <input
                value={goalDraft.saved}
                onChange={(e) => setGoalDraft((d) => ({ ...d, saved: e.target.value }))}
                placeholder="0"
                inputMode="decimal"
                className="w-28 rounded border px-2.5 py-1.5 text-right text-sm tabular-nums focus:border-blue-400 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-sm text-white hover:bg-slate-700"
            >
              <Target size={14} />
              Add goal
            </button>
          </form>
        </div>
      </Panel>
    </div>
  );
}
