import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../../utils/format';
import {
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  INFO,
  LABEL,
  ZoomHint,
  axisStyle,
  compactNumber,
  cursorStyle,
  gridStyle,
  selectionStyle,
  useReducedMotion,
  useSeriesToggle,
  useTooltipPosition,
  useZoomDomain,
  yAxisStyle,
} from './interactive';

/**
 * The running net total, bucketed, with the projection to next pay drawn on after today.
 *
 * Two lines, two colours: the history in the label white, the projection in blue and DASHED, so
 * what has happened and what is expected to happen never read as one line. The projection starts
 * at the today point so the two meet rather than overlap.
 *
 * Hovering reads both lines plus the change since the first visible point, which is the figure the
 * chart exists to give: zoom to a stretch and the delta is the net for that stretch. The today
 * point carries the reconciliation underneath — prior cycles, this cycle, the remaining estimate —
 * because that is the join where the chart and the table have to agree.
 */

const EMPTY = [];
const SERIES = ['actual', 'expectedProjected'];
/** The legend swatch for the projection is dashed like the line it names. */
const DASHED_SWATCH = `repeating-linear-gradient(90deg, ${INFO} 0 4px, transparent 4px 7px)`;

const granularityLabel = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
};
const granularityUnit = {
  day: 'days',
  week: 'weeks',
  month: 'months',
};

export function NetTotalChart({ chartData }) {
  const points = chartData?.points ?? EMPTY;
  const zoom = useZoomDomain(points, 'label');
  const toggles = useSeriesToggle(SERIES);
  const reduced = useReducedMotion();
  const tooltipPosition = useTooltipPosition();

  if (!points.length) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-label-2">
        No chart data for the selected range.
      </div>
    );
  }

  const {
    granularity,
    netAvg,
    netExpected,
    incomeRemaining,
    expenseRemaining,
    tableMonthNet,
    signedRemaining,
    priorRunning,
    monthEndProjectedRunning,
    todayRunning,
  } = chartData;

  const { visibleData } = zoom;
  const first = visibleData[0];
  const last = visibleData[visibleData.length - 1];
  const summary = `Net total over time, ${granularityLabel[granularity]} buckets. Running total ${formatCurrency(
    todayRunning,
  )} today, projected ${formatCurrency(monthEndProjectedRunning)} at next pay.${
    zoom.zoomed ? ` Zoomed to ${first.label} – ${last.label}.` : ''
  }`;

  // The today point is where the chart and the table meet; show the sum that gets from one to the
  // other so a disagreement is visible at the join rather than discovered later.
  const todayFooter = (row) =>
    row?.isToday ? (
      <div className="space-y-0.5">
        <p>Prior cycles: {formatCurrency(priorRunning)}</p>
        <p>
          This cycle: {formatCurrency(tableMonthNet)} + remaining {formatCurrency(signedRemaining)}
        </p>
        <p className="text-label">Next pay: {formatCurrency(monthEndProjectedRunning)}</p>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="t-head">Net total over time</h2>
          <p className="t-label mt-1.5">
            Running net total ({granularityLabel[granularity]} buckets) · transfers excluded
          </p>
        </div>
        <p className="t-label">
          Avg monthly net (excl. current):{' '}
          <span className="font-medium text-label-2">{formatCurrency(netAvg)}</span>
        </p>
      </div>

      <ChartFrame label={summary} zoom={zoom} unit={granularityUnit[granularity]} className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={visibleData}
            margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            {...zoom.chartProps}
          >
            <CartesianGrid {...gridStyle} />
            <XAxis
              dataKey="label"
              {...axisStyle}
              interval="preserveStartEnd"
              angle={granularity === 'day' ? -35 : 0}
              textAnchor={granularity === 'day' ? 'end' : 'middle'}
              height={granularity === 'day' ? 60 : 30}
            />
            <YAxis {...yAxisStyle} tickFormatter={compactNumber} />
            <Tooltip
              cursor={cursorStyle}
              isAnimationActive={false}
              {...zoom.tooltipProps}
              position={tooltipPosition}
              content={<ChartTooltip deltaFrom={first} footer={todayFooter} />}
            />
            <Legend
              content={
                <ChartLegend
                  toggle={toggles.toggle}
                  isHidden={toggles.isHidden}
                  swatch={{ expectedProjected: DASHED_SWATCH }}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="actual"
              name="Running total"
              stroke={LABEL}
              strokeWidth={2.5}
              dot={{ r: 2.5, fill: LABEL, strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: '#08080a', strokeWidth: 2 }}
              connectNulls={false}
              hide={toggles.isHidden('actual')}
              isAnimationActive={!reduced}
            />
            <Line
              type="monotone"
              dataKey="expectedProjected"
              name="Projected"
              stroke={INFO}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 2.5, fill: INFO, strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: '#08080a', strokeWidth: 2 }}
              connectNulls
              hide={toggles.isHidden('expectedProjected')}
              isAnimationActive={!reduced}
            />
            {zoom.selection && (
              <ReferenceArea x1={zoom.selection.x1} x2={zoom.selection.x2} {...selectionStyle} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ZoomHint
        zoomed={zoom.zoomed}
        onReset={zoom.reset}
        label={zoom.zoomed ? `${first.label} – ${last.label}` : null}
      />

      <div className="space-y-1 text-xs text-label-2">
        <p>
          Running total uses base transactions through each bucket. The dashed line projects from
          today ({formatCurrency(todayRunning)}) to next pay ({formatCurrency(monthEndProjectedRunning)}
          ): current cycle ({formatCurrency(tableMonthNet)}) + remaining ({formatCurrency(netExpected)}
          ).
        </p>
        <p>
          Table remaining: income {formatCurrency(incomeRemaining)} + expense{' '}
          {formatCurrency(expenseRemaining)} = {formatCurrency(netExpected)}.
        </p>
      </div>
    </div>
  );
}
