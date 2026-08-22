import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
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
 * Every debt's balance over the plan, stacked, with a pin where each one vanishes.
 *
 * Stacked rather than overlaid because the question is "when is it all gone", and the top edge of
 * a stack IS the total. The first target sits on top so it visibly disappears first — a cascade
 * you can see — and the dashed rule at each payoff month names the debt, which is the moment the
 * plan promises. Interactive like the rest of the charts: hover reads every balance at that month,
 * a drag zooms to a stretch (a bond's thirty years squash the first two, where everything happens),
 * the legend hides a series, Escape or a double-click puts it back.
 */

const TONES = ['#0a84ff', '#ff9f0a', '#63e6e2', '#ff375f', '#5e5ce6', '#30d158', '#ff453a'];
const MONTH_YEAR = { month: 'short', year: 'numeric' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const fmtMonthYear = (d) => {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-ZA', MONTH_YEAR) : '—';
};
const round = (v) => Math.round(Number.isFinite(v) ? v : 0);

export function BalanceChart({ plan, debts = [], labelsById = {} }) {
  // The stack is drawn bottom-up, so the LAST target is rendered first and the first target last.
  const ids = useMemo(() => {
    const order = plan?.order ?? [];
    const known = order.filter((id) => debts.some((d) => d.id === id));
    const rest = debts.map((d) => d.id).filter((id) => !known.includes(id));
    return [...known, ...rest];
  }, [plan, debts]);

  const data = useMemo(() => {
    if (!plan?.schedule?.length) return [];
    const opening = { payMonth: 'now', label: 'Today', total: 0 };
    for (const d of debts) {
      opening[d.id] = round(d.balance);
      opening.total += round(d.balance);
    }
    const rows = plan.schedule.map((s) => {
      const row = { payMonth: s.payMonth ?? String(s.month), label: fmtMonthYear(s.date), month: s.month, total: round(s.debtTotal) };
      for (const id of ids) row[id] = round(s.byDebt?.[id]?.close);
      return row;
    });
    return [opening, ...rows];
  }, [plan, debts, ids]);

  const pins = useMemo(() => {
    if (!plan?.events) return [];
    const byMonth = new Map(data.map((r) => [r.month, r.payMonth]));
    return plan.events
      .filter((e) => e.type === 'cleared')
      .map((e) => ({ id: e.id, x: byMonth.get(e.month), label: labelsById[e.id] ?? e.id, date: fmtMonthYear(e.date) }))
      .filter((p) => p.x);
  }, [plan, data, labelsById]);

  const zoom = useZoomDomain(data, 'payMonth');
  const toggles = useSeriesToggle(ids);
  const reduced = useReducedMotion();
  // On a phone the legend moves out of the frame (below) and the pins drop their labels: four of
  // them collide across a 300px plot, and the list under the chart names them anyway.
  const narrow = useNarrowViewport();

  if (!data.length) return null;

  const { visibleData } = zoom;
  const visible = new Set(visibleData.map((r) => r.payMonth));
  const januaries = visibleData.filter((r) => /-01$/.test(r.payMonth)).map((r) => r.payMonth);
  const every = Math.max(1, Math.ceil(januaries.length / 12));
  const ticks = januaries.length >= 2 ? januaries.filter((_, i) => i % every === 0) : undefined;
  const first = visibleData[0];
  const last = visibleData[visibleData.length - 1];
  const summary = `Balances over the plan, ${plan.strategy ?? ''} strategy. ${formatCurrencyAbs(first.total)} today${
    plan.debtFreeDate ? `, debt-free ${fmtMonthYear(plan.debtFreeDate)}` : ', not debt-free within the horizon'
  }.${zoom.zoomed ? ` Zoomed to ${first.label} – ${last.label}.` : ''}`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="t-head">Balances over the plan</h2>
          <p className="t-label mt-1.5">
            Each debt stacked; the first target on top. A dashed rule marks each payoff.
          </p>
        </div>
        <p className="t-label">
          Debt-free:{' '}
          <span className="font-medium text-label-2">
            {plan.debtFreeDate ? fmtMonthYear(plan.debtFreeDate) : 'not within 50 years'}
          </span>
        </p>
      </div>

      <ChartFrame label={summary} zoom={zoom} unit="months" className="mt-5 h-80 w-full">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 320 }}>
          <AreaChart data={visibleData} margin={{ top: 12, right: 16, left: 8, bottom: 4 }} {...zoom.chartProps}>
            <CartesianGrid {...gridStyle} />
            <XAxis
              dataKey="payMonth"
              {...axisStyle}
              ticks={ticks}
              interval={ticks ? 0 : 'preserveStartEnd'}
              tickFormatter={(v) => {
                const row = data.find((r) => r.payMonth === v);
                return row ? (ticks ? row.label.slice(-4) : row.label) : v;
              }}
            />
            <YAxis {...yAxisStyle} tickFormatter={compactNumber} width={56} />
            <Tooltip
              cursor={cursorStyle}
              isAnimationActive={false}
              {...zoom.tooltipProps}
              content={
                <ChartTooltip
                  filterEntry={(e) => e.value > 0}
                  footer={(row) => (row ? <span>Total {formatCurrencyAbs(row.total)}</span> : null)}
                />
              }
            />
            {!narrow && <Legend content={<ChartLegend toggle={toggles.toggle} isHidden={toggles.isHidden} />} />}
            {ids
              .slice()
              .reverse()
              .map((id) => {
                const tone = TONES[ids.indexOf(id) % TONES.length];
                return (
                  <Area
                    key={id}
                    type="monotone"
                    dataKey={id}
                    name={labelsById[id] ?? id}
                    stackId="debt"
                    stroke={tone}
                    strokeWidth={1.5}
                    fill={tone}
                    fillOpacity={0.35}
                    dot={false}
                    activeDot={{ r: 4, stroke: '#08080a', strokeWidth: 2 }}
                    hide={toggles.isHidden(id)}
                    isAnimationActive={!reduced}
                  />
                );
              })}
            {pins
              .filter((p) => visible.has(p.x))
              .map((p) => (
                <ReferenceLine
                  key={p.id}
                  x={p.x}
                  stroke={LABEL_3}
                  strokeDasharray="4 3"
                  label={narrow ? undefined : { value: p.label, position: 'insideTopRight', fill: LABEL_3, fontSize: 11 }}
                />
              ))}
            {zoom.selection && <ReferenceArea x1={zoom.selection.x1} x2={zoom.selection.x2} {...selectionStyle} />}
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>

      {narrow && (
        <ChartLegend
          payload={ids.map((id) => ({ dataKey: id, value: labelsById[id] ?? id, color: TONES[ids.indexOf(id) % TONES.length], type: 'line' }))}
          toggle={toggles.toggle}
          isHidden={toggles.isHidden}
          className={LEGEND_TAP}
        />
      )}

      <ZoomHint
        zoomed={zoom.zoomed}
        onReset={zoom.reset}
        label={zoom.zoomed ? `${first.label} – ${last.label}` : null}
        className={`mt-3 ${LEGEND_TAP}`}
      />

      {pins.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-label-2">
          {pins.map((p) => (
            <li key={p.id}>
              <span className="text-label">{p.label}</span> · {p.date}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
