import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Flag, Scissors, Target } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../utils/format';
import { suggestTarget } from '../lib/budgets';
import { Field } from './ui/Field';
import { DirectionTable } from './plan/DirectionTable';
import { STICKY_CELL, TableScroller } from './plan/TableScroller';
import {
  ChartFrame,
  ChartTooltip,
  LABEL,
  ZoomHint,
  axisStyle,
  compactNumber,
  cursorStyle,
  gridStyle,
  selectionStyle,
  useReducedMotion,
  useZoomDomain,
  yAxisStyle,
} from './charts/interactive';

const DAY_MONTH = { day: 'numeric', month: 'short' };
const MONTH_YEAR = { month: 'short', year: '2-digit' };

function Panel({ title, subtitle, children, right }) {
  return (
    <section className="glass overflow-hidden">
      {/* Static class: Tailwind can't see a class name assembled at runtime. Card padding steps
          down to 16px on a phone, where the card is already full-bleed. */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-4 md:px-6 md:py-5">
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

/* ------------------------------------------------------------------ targets */

const STATUS_STYLE = {
  over: 'bg-bad',
  tight: 'bg-warn',
  under: 'bg-good',
  none: 'bg-fill',
};

function TargetRow({ row, onSet }) {
  const [draft, setDraft] = useState(row.target == null ? '' : String(row.target));
  const pct = row.target ? Math.min(150, (row.projected / row.target) * 100) : 0;

  const commit = (value) => {
    const v = parseFloat(String(value).replace(/[^\d.]/g, ''));
    onSet?.(row.category, Number.isFinite(v) && v > 0 ? v : null);
  };

  return (
    <tr className="border-b last:border-0">
      <td className={`px-4 py-2.5 md:px-6 ${STICKY_CELL}`}>
        <span className="text-sm text-label">{row.category}</span>
        {row.isBill && (
          <span className="ml-2 rounded bg-fill px-1.5 py-0.5 text-[10px] text-label-2 max-md:text-[11px]">
            bill
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-label-2 tabular-nums">
        {formatCurrencyAbs(row.typical)}
      </td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums">{formatCurrencyAbs(row.spent)}</td>
      <td className="px-4 py-2.5 text-right text-sm font-medium tabular-nums">
        {formatCurrencyAbs(row.projected)}
      </td>
      <td className="px-4 py-2.5">
        {/* `width` is Field's input-class slot; the phone height rides along with the width. */}
        <Field
          prefix="R"
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          placeholder={String(suggestTarget(row.typical))}
          ariaLabel={`Target for ${row.category}`}
          width="w-24 max-md:h-11"
        />
      </td>
      <td className="px-4 py-2.5">
        {row.target ? (
          <div className="flex items-center gap-2">
            <span className="h-2 w-24 overflow-hidden rounded-full bg-fill">
              <span
                className={`block h-full rounded-full ${STATUS_STYLE[row.status]}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </span>
            <span
              className={`text-xs tabular-nums ${
                row.status === 'over' ? 'font-medium text-bad' : 'text-label-2'
              }`}
            >
              {row.status === 'over' ? `+${formatCurrencyAbs(row.over)}` : `${Math.round(pct)}%`}
            </span>
          </div>
        ) : (
          <span className="text-xs text-label-4">no target</span>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ trajectory */

const EMPTY = [];

/**
 * Net worth projected forward, with the interaction kit: drag to zoom, hover for the figure and
 * its change since the first visible cycle. Tone is the Aurora label tone.
 *
 * This used to plot assets and debt as their own stacked areas alongside net worth — but debt
 * balance over time is exactly the chart Debt already owns (BalanceChart, under whatever strategy
 * is selected there), and account balances over time are Accounts' job. Net worth is the one figure
 * that is genuinely this tab's own: what everything adds up to if nothing changes.
 */
function TrajectoryChart({ trajectory }) {
  const data = useMemo(
    () =>
      (trajectory?.points ?? EMPTY).map((p) => ({
        cycle: p.cycle,
        label: p.date ? p.date.toLocaleDateString('en-ZA', MONTH_YEAR) : `+${p.cycle}`,
        net: Math.round(p.net),
      })),
    [trajectory],
  );
  const zoom = useZoomDomain(data, 'label');
  const reduced = useReducedMotion();
  if (!data.length) return null;

  const { visibleData } = zoom;
  const first = visibleData[0];
  const last = visibleData[visibleData.length - 1];
  const summary = `Net worth projected over ${data.length} cycles, from ${formatCurrency(data[0].net)} to ${formatCurrency(
    data[data.length - 1].net,
  )}.${zoom.zoomed ? ` Zoomed to ${first.label} – ${last.label}.` : ''}`;

  return (
    <div className="px-2 py-4">
      <ChartFrame label={summary} zoom={zoom} unit="cycles" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={visibleData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }} {...zoom.chartProps}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" {...axisStyle} interval="preserveStartEnd" />
            <YAxis {...yAxisStyle} tickFormatter={compactNumber} />
            <Tooltip
              cursor={cursorStyle}
              isAnimationActive={false}
              {...zoom.tooltipProps}
              content={<ChartTooltip deltaFrom={first} />}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.22)" />
            <Line
              type="monotone"
              dataKey="net"
              name="Net worth"
              stroke={LABEL}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, stroke: '#08080a', strokeWidth: 2 }}
              isAnimationActive={!reduced}
            />
            {zoom.selection && (
              <ReferenceArea x1={zoom.selection.x1} x2={zoom.selection.x2} {...selectionStyle} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ZoomHint
        zoomed={zoom.zoomed}
        onReset={zoom.reset}
        label={zoom.zoomed ? `${first.label} – ${last.label}` : null}
        className="mt-2 px-4"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ the view */

/**
 * Plan — the direction, the targets, this cycle's shortfall, and the levers.
 *
 * Order is the order of the questions: which way things are going, how each category is doing
 * against where the cycle is heading, what would close the shortfall, what happens if nothing
 * changes, and the goals. Safe-to-spend lives on Today now and the debt-payoff solver lives on
 * Debt — both duplicated what those tabs already show, so neither is rendered here. The trajectory
 * chart is re-toned and given the interaction kit, with the inputs moved onto `Field`.
 */
export function PlanView({
  budgets,
  onSetTarget,
  trajectory,
  monthlySaving = 0,
  onMonthlySavingChange,
  gapClosers,
  goals,
  onAddGoal,
  onRemoveGoal,
  direction,
}) {
  const [showAll, setShowAll] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ name: '', target: '', saved: '' });

  const rows = budgets ? (showAll ? budgets.rows : budgets.rows.slice(0, 12)) : [];
  const goalList = goals?.goals ?? [];

  return (
    <div className="flex flex-col gap-5">
      <DirectionTable direction={direction} />

      {budgets && (
        <Panel
          title="Targets"
          subtitle="Judged against where the cycle is heading — spend so far plus what's still forecast — rather than against spend so far, which is meaningless on day three."
          right={
            budgets.withTargets?.length > 0 && (
              <div className="text-right">
                <div
                  className={`text-lg font-semibold tabular-nums ${
                    budgets.status === 'over' ? 'text-bad' : 'text-good'
                  }`}
                >
                  {formatCurrencyAbs(budgets.totalProjected)} / {formatCurrencyAbs(budgets.totalTarget)}
                </div>
                <div className="t-label">
                  {budgets.overBy > 0
                    ? `heading ${formatCurrencyAbs(budgets.overBy)} over`
                    : `${formatCurrencyAbs(-budgets.overBy)} of room`}
                </div>
              </div>
            )
          }
        >
          <TableScroller>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase max-md:text-xs">
                  <th className={`border-b px-4 py-2.5 md:px-6 ${STICKY_CELL}`}>Category</th>
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
          </TableScroller>
          {budgets.rows.length > 12 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="w-full border-t bg-fill py-2.5 text-xs text-label-2 hover:bg-fill max-md:min-h-11"
            >
              {showAll ? 'Show fewer' : `Show all ${budgets.rows.length} categories`}
            </button>
          )}
        </Panel>
      )}

      {gapClosers && (
        <Panel
          title="Cut categories to close this cycle's shortfall"
          subtitle="The categories that could close it, ranked by what each could plausibly give up rather than by size — the bond is the biggest line in the data and suggesting you cut it would be useless."
          right={
            <div className="text-right">
              <div className="text-lg font-semibold text-label tabular-nums">
                {formatCurrencyAbs(gapClosers.gap)}
              </div>
              <div className="t-label">shortfall to find each cycle</div>
            </div>
          }
        >
          <div className="p-4 md:p-6">
            {gapClosers.plan.length === 0 ? (
              <p className="text-sm text-label-2">Nothing discretionary large enough to matter.</p>
            ) : (
              <>
                <ul className="space-y-2.5 max-md:space-y-3.5">
                  {gapClosers.plan.map((c) => (
                    // One line on a desktop. On a phone the two fixed-width ends alone are wider
                    // than the screen, so it becomes a small grid: the name in full on the first
                    // line, the bar with its reading beside it on the second.
                    <li
                      key={c.name}
                      className="flex items-center gap-3 max-md:grid max-md:grid-cols-[auto_1fr_auto] max-md:gap-x-3 max-md:gap-y-1.5"
                    >
                      <Scissors size={13} className="shrink-0 text-label-3" />
                      <span className="min-w-0 truncate text-sm text-label max-md:col-span-2 md:w-48 md:shrink-0">{c.name}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-fill max-md:col-start-2 md:flex-1">
                        <span
                          className="block h-full rounded-full bg-info"
                          style={{ width: `${Math.min(100, c.cutPercent * 100)}%` }}
                        />
                      </span>
                      <span className="shrink-0 text-right text-xs text-label-2 tabular-nums md:w-44">
                        cut {formatCurrencyAbs(c.cut)} of {formatCurrencyAbs(c.typical)} (
                        {Math.round(c.cutPercent * 100)}%)
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t pt-3 text-xs text-label-2">
                  {gapClosers.closed ? (
                    <>
                      Those cuts come to{' '}
                      <b className="font-semibold text-label">
                        {formatCurrencyAbs(gapClosers.found)}
                      </b>{' '}
                      a cycle, which closes it.
                    </>
                  ) : (
                    <>
                      Even cutting all of these leaves{' '}
                      <b className="font-semibold text-bad">
                        {formatCurrencyAbs(gapClosers.shortfall)}
                      </b>{' '}
                      a cycle unaccounted for — the shortfall is structural, not discretionary.
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
            // On a phone the slider takes the card's full width on its own line, 44px tall, with
            // the label and the value above it: a 128px track is not something a thumb can set.
            <label className="flex flex-wrap items-center gap-2 text-xs text-label-2 max-md:w-full">
              Save per cycle
              <input
                type="range"
                min="0"
                max="20000"
                step="500"
                value={monthlySaving}
                onChange={(e) => onMonthlySavingChange?.(parseInt(e.target.value, 10))}
                className="w-32 accent-info max-md:order-3 max-md:h-11 max-md:w-full"
                aria-label="Extra saving per cycle"
              />
              <span className="w-20 text-right font-medium tabular-nums max-md:ml-auto">
                {formatCurrencyAbs(monthlySaving)}
              </span>
            </label>
          }
        >
          <TrajectoryChart trajectory={trajectory} />
          <div className="flex flex-wrap gap-x-8 gap-y-2 border-t bg-fill px-4 py-4 text-xs md:px-6">
            <div>
              <span className="text-label-2">Net worth in {trajectory.horizon} cycles: </span>
              <b className={`tabular-nums ${trajectory.endNet < 0 ? 'text-bad' : 'text-good'}`}>
                {formatCurrency(trajectory.endNet)}
              </b>
              <span className="text-label-3">
                {' '}
                ({trajectory.change >= 0 ? '+' : '−'}
                {formatCurrencyAbs(trajectory.change)})
              </span>
            </div>
            {(trajectory.events ?? []).map((e) => (
              <div key={`${e.type}-${e.account}`} className={e.type === 'limit' ? 'text-bad' : 'text-good'}>
                {e.account} {e.type === 'limit' ? 'hits its limit' : 'is cleared'} in {e.cycle} cycle
                {e.cycle === 1 ? '' : 's'}
                {e.date && ` (${e.date.toLocaleDateString('en-ZA', DAY_MONTH)})`}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {goals && (
        <Panel
          title="Goals"
          subtitle="Arrival dates come from what you actually keep each cycle. When that's negative the honest answer is that the goal doesn't arrive, and the app says how much would have to be found first."
        >
          <div className="p-4 md:p-6">
            {goalList.length > 0 && (
              <ul className="mb-5 space-y-3 max-md:space-y-4">
                {goalList.map((g) => (
                  // On a phone: name and Remove on the first line, the bar on its own, then the
                  // figures and the arrival — the `order`s do the re-flow, nothing is duplicated.
                  <li key={g.id} className="flex flex-wrap items-center gap-3 max-md:gap-y-1.5">
                    <Flag size={14} className="shrink-0 text-label-3" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-label md:w-40 md:flex-none">
                      {g.name}
                    </span>
                    <span className="h-2 min-w-24 overflow-hidden rounded-full bg-fill max-md:order-2 max-md:basis-full md:flex-1">
                      <span
                        className="block h-full rounded-full bg-good"
                        style={{ width: `${g.progress * 100}%` }}
                      />
                    </span>
                    <span className="shrink-0 text-xs text-label-2 tabular-nums max-md:order-3">
                      {formatCurrencyAbs(g.saved)} / {formatCurrencyAbs(g.target)}
                    </span>
                    <span
                      className={`shrink-0 text-xs max-md:order-3 ${g.reachable ? 'text-label-2' : 'text-warn'}`}
                    >
                      {g.reachable
                        ? g.cycles === 0
                          ? 'reached'
                          : `${g.cycles} cycles · ${g.eta.toLocaleDateString('en-ZA', MONTH_YEAR)}`
                        : 'not while the cycle closes negative'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveGoal?.(g.id)}
                      className="ml-auto shrink-0 rounded px-2 py-1 text-xs text-label-3 hover:bg-fill hover:text-label-2 max-md:order-1 max-md:min-h-11 max-md:px-3"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* The three fields and the button stack full-width on a phone, 44px tall each. */}
            <form
              className="flex flex-wrap items-end gap-3 max-md:flex-col max-md:items-stretch"
              onSubmit={(e) => {
                e.preventDefault();
                const target = parseFloat(goalDraft.target.replace(/[^\d.]/g, ''));
                if (!goalDraft.name.trim() || !(target > 0)) return;
                onAddGoal?.({
                  name: goalDraft.name.trim(),
                  target,
                  saved: parseFloat(goalDraft.saved.replace(/[^\d.]/g, '')) || 0,
                });
                setGoalDraft({ name: '', target: '', saved: '' });
              }}
            >
              <Field
                label="Goal"
                inputMode="text"
                value={goalDraft.name}
                onChange={(v) => setGoalDraft((d) => ({ ...d, name: v }))}
                placeholder="Emergency fund"
                width="w-48 max-md:h-11 max-md:w-full"
                className="[&_input]:text-left"
              />
              <Field
                label="Target"
                prefix="R"
                value={goalDraft.target}
                onChange={(v) => setGoalDraft((d) => ({ ...d, target: v }))}
                placeholder="50000"
                width="w-28 max-md:h-11 max-md:w-full"
              />
              <Field
                label="Already saved"
                prefix="R"
                value={goalDraft.saved}
                onChange={(v) => setGoalDraft((d) => ({ ...d, saved: v }))}
                placeholder="0"
                width="w-28 max-md:h-11 max-md:w-full"
              />
              <button
                type="submit"
                className="press flex items-center gap-1.5 rounded-xl bg-fill-2 px-3.5 py-2 text-sm text-label hover:brightness-125 max-md:min-h-11 max-md:justify-center"
              >
                <Target size={14} />
                Add goal
              </button>
            </form>
          </div>
        </Panel>
      )}
    </div>
  );
}
