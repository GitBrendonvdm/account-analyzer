import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrencyAbs } from '../../utils/format';
import {
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  GOOD,
  LABEL,
  LABEL_3,
  ZoomHint,
  axisStyle,
  compactNumber,
  cursorStyle,
  gridStyle,
  selectionStyle,
  useReducedMotion,
  useSeriesToggle,
  useZoomDomain,
  yAxisStyle,
} from '../charts/interactive';
import { LEGEND_TAP, useNarrowViewport } from './narrow';

/**
 * The cash committed to instalments each month, and when it comes back.
 *
 * A payoff is felt as money freed, not as a balance reaching zero, so this draws the committed
 * total as a step line and the relief — what is back in your pocket — as a dashed one. Under a
 * cascade the relief stays at zero until the last debt clears (every freed instalment rolls onto
 * the next target) and then everything returns at once; without it each payoff is a step down.
 * The pins say which debt freed what and where it went. The timeline comes from the engine when
 * it is wired and is derived from the plan's own schedule otherwise, so the line never waits on it.
 */

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const fmtMonthYear = (d) => {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-ZA', MONTH_YEAR) : '—';
};
const round = (v) => Math.round(Number.isFinite(v) ? v : 0);
const DASHED_SWATCH = `repeating-linear-gradient(90deg, ${GOOD} 0 4px, transparent 4px 7px)`;

/** What the engine's cascadeTimeline would say, read off the plan itself. */
function deriveTimeline(plan, debts, cascade) {
  const committedByMonth = [0];
  const reliefByMonth = [0];
  const finalRelief = debts.reduce((s, d) => s + (d.instalment ?? d.plannedPayment ?? 0), 0);
  const freed = plan.freedTimeline ?? [];
  const cleared = (plan.events ?? []).filter((e) => e.type === 'cleared');
  const rolled = (plan.events ?? []).filter((e) => e.type === 'rolled');
  let cumulative = 0;
  let fi = 0;
  for (const s of plan.schedule ?? []) {
    const k = s.month;
    committedByMonth[k] = Object.values(s.byDebt ?? {}).reduce((sum, b) => sum + (b.payment ?? 0), 0);
    while (fi < freed.length && freed[fi].month <= k) cumulative = freed[fi++].cumulativeFreed ?? cumulative;
    reliefByMonth[k] = cascade ? (k >= (plan.months ?? Infinity) && !plan.reachedCap ? finalRelief : 0) : cumulative;
  }
  const steps = cleared.map((e) => {
    const f = freed.find((x) => x.month === e.month);
    const r = rolled.find((x) => (x.from ?? x.id) === e.id && x.month === e.month);
    return {
      month: e.month,
      date: e.date,
      id: e.id,
      freed: e.freed ?? e.amount ?? 0,
      cumulativeFreed: f?.cumulativeFreed ?? null,
      rolledTo: r?.to ?? (cascade ? (f?.rolledTo ?? null) : null),
    };
  });
  return { steps, committedByMonth, reliefByMonth, finalRelief };
}

const SERIES = ['committed', 'relief'];
/** What Recharts would hand the legend, for drawing it outside the frame on a phone. */
const LEGEND_PAYLOAD = [
  { dataKey: 'committed', value: 'Committed to instalments', color: LABEL, type: 'line' },
  { dataKey: 'relief', value: 'Back to you', color: GOOD, type: 'line' },
];

export function CommittedLine({ plan, timeline, debts = [], labelsById = {}, cascade = true, strategy }) {
  const tl = useMemo(
    () => (plan ? (timeline ?? deriveTimeline(plan, debts, cascade)) : null),
    [plan, timeline, debts, cascade],
  );

  const data = useMemo(() => {
    if (!plan?.schedule?.length || !tl) return [];
    return plan.schedule.map((s) => ({
      payMonth: s.payMonth ?? String(s.month),
      label: fmtMonthYear(s.date),
      month: s.month,
      committed: round(tl.committedByMonth?.[s.month]),
      relief: round(tl.reliefByMonth?.[s.month]),
    }));
  }, [plan, tl]);

  const zoom = useZoomDomain(data, 'payMonth');
  const toggles = useSeriesToggle(SERIES);
  const reduced = useReducedMotion();
  // On a phone the legend moves out of the frame, below it, so the plot keeps its height.
  const narrow = useNarrowViewport();

  if (!data.length) return null;

  const { visibleData } = zoom;
  const visible = new Set(visibleData.map((r) => r.payMonth));
  const byMonth = new Map(data.map((r) => [r.month, r.payMonth]));
  const first = visibleData[0];
  const last = visibleData[visibleData.length - 1];
  const name = (id) => labelsById[id] ?? id;
  const steps = (tl.steps ?? []).map((s) => ({ ...s, x: byMonth.get(s.month), label: name(s.id) }));
  const summary = `Committed cash over the plan: ${formatCurrencyAbs(first.committed)} a month now, ${formatCurrencyAbs(
    tl.finalRelief,
  )} back when everything clears.${zoom.zoomed ? ` Zoomed to ${first.label} – ${last.label}.` : ''}`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="t-head">Freed cash</h2>
          <p className="t-label mt-1.5">
            What the instalments commit each month, and what comes back as each one clears.
          </p>
        </div>
        <p className="t-label">
          When it is all gone:{' '}
          <span className="font-medium text-label-2">{formatCurrencyAbs(tl.finalRelief)} a month back</span>
        </p>
      </div>

      <ChartFrame label={summary} zoom={zoom} unit="months" className="mt-5 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 256 }}>
          <LineChart data={visibleData} margin={{ top: 12, right: 16, left: 8, bottom: 4 }} {...zoom.chartProps}>
            <CartesianGrid {...gridStyle} />
            <XAxis
              dataKey="payMonth"
              {...axisStyle}
              interval="preserveStartEnd"
              tickFormatter={(v) => data.find((r) => r.payMonth === v)?.label ?? v}
            />
            <YAxis {...yAxisStyle} tickFormatter={compactNumber} width={56} />
            <Tooltip
              cursor={cursorStyle}
              isAnimationActive={false}
              {...zoom.tooltipProps}
              content={<ChartTooltip />}
            />
            {!narrow && (
              <Legend
                content={
                  <ChartLegend toggle={toggles.toggle} isHidden={toggles.isHidden} swatch={{ relief: DASHED_SWATCH }} />
                }
              />
            )}
            <Line
              type="stepAfter"
              dataKey="committed"
              name="Committed to instalments"
              stroke={LABEL}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, stroke: '#08080a', strokeWidth: 2 }}
              hide={toggles.isHidden('committed')}
              isAnimationActive={!reduced}
            />
            <Line
              type="stepAfter"
              dataKey="relief"
              name="Back to you"
              stroke={GOOD}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4, stroke: '#08080a', strokeWidth: 2 }}
              hide={toggles.isHidden('relief')}
              isAnimationActive={!reduced}
            />
            {steps
              .filter((s) => s.x && visible.has(s.x))
              .map((s) => (
                <ReferenceLine key={`${s.id}-${s.month}`} x={s.x} stroke={LABEL_3} strokeDasharray="4 3" />
              ))}
            {zoom.selection && <ReferenceArea x1={zoom.selection.x1} x2={zoom.selection.x2} {...selectionStyle} />}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      {narrow && (
        <ChartLegend
          payload={LEGEND_PAYLOAD}
          toggle={toggles.toggle}
          isHidden={toggles.isHidden}
          swatch={{ relief: DASHED_SWATCH }}
          className={LEGEND_TAP}
        />
      )}

      <ZoomHint
        zoomed={zoom.zoomed}
        onReset={zoom.reset}
        label={zoom.zoomed ? `${first.label} – ${last.label}` : null}
        className={`mt-3 ${LEGEND_TAP}`}
      />

      {steps.length > 0 ? (
        <ol className="mt-4 flex flex-col gap-1.5 text-[13.5px] text-label-2">
          {steps.map((s) => (
            <li key={`${s.id}-${s.month}`}>
              <span className="num text-label">{fmtMonthYear(s.date)}</span> — {s.label} cleared,{' '}
              <span className="num">{formatCurrencyAbs(s.freed)}</span>/month{' '}
              {strategy === 'minimum' || !cascade || !s.rolledTo
                ? 'back to you'
                : `rolls to the ${name(s.rolledTo)}`}
            </li>
          ))}
        </ol>
      ) : (
        <p className="t-caption mt-4">Nothing clears inside the horizon at these settings.</p>
      )}
    </div>
  );
}
