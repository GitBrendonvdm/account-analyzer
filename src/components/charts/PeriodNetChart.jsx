import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../../utils/format';
import {
  BAD,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  DEEP,
  GOOD,
  INFO,
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
 * Net per pay month, one bar each, the current month stacked with what is still expected.
 *
 * Completed months are coloured by sign — a good month green, a bad one red — because the question
 * a bar chart of nets answers is "which months went wrong", and sign is faster to read than height
 * against a zero line. The current month's remaining estimate stacks on in blue, the projection
 * colour everywhere else in the app, and the legend swatch for the actuals is split the same way
 * the bars are.
 */

const EMPTY = [];
const SERIES = ['actual', 'remaining'];
const SPLIT_SWATCH = `linear-gradient(90deg, ${GOOD} 0 50%, ${BAD} 50% 100%)`;

function actualBarColor(value) {
  if (value > 0.01) return GOOD;
  if (value < -0.01) return BAD;
  return 'rgba(235,235,245,0.4)';
}

/** The remaining estimate is only a thing for the current month; past months carry a zero. */
const onlyCurrentRemaining = (entry, row) => entry.dataKey !== 'remaining' || row?.isCurrentMonth;
const barColour = (entry, row) => (entry.dataKey === 'actual' ? actualBarColor(row?.actual) : entry.color);
const projectedFooter = (row) =>
  row?.isCurrentMonth ? (
    <p>
      Projected month-end: <span className="font-semibold text-label">{formatCurrency(row.display)}</span>
    </p>
  ) : null;

export function PeriodNetChart({ chartData }) {
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

  const { netAvg } = chartData;
  const { visibleData } = zoom;
  const first = visibleData[0];
  const last = visibleData[visibleData.length - 1];
  const current = points.find((p) => p.isCurrentMonth);
  const summary = `Net per month, ${points.length} pay months. Weighted average ${formatCurrency(netAvg)}.${
    current ? ` Current month ${formatCurrency(current.actual)} so far, projected ${formatCurrency(current.display)}.` : ''
  }${zoom.zoomed ? ` Zoomed to ${first.label} – ${last.label}.` : ''}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="t-head">Net Per Month</h2>
          <p className="text-sm text-label-2">
            Income minus expense per pay month · transfers excluded
          </p>
        </div>
        <p className="t-label">
          Weighted avg (excl. current):{' '}
          <span className="font-medium text-label-2">{formatCurrency(netAvg)}</span>
        </p>
      </div>

      {/* The bars take no pointer events, so a finger that lands on one is anchored to the SVG and not
          to the bar: Recharts remounts every bar rectangle on each tooltip change, and a touch sequence
          whose start target leaves the document loses its moves — the drag would stall. The readout and
          the highlight are axis-driven from the chart surface and do not need the bars to be hittable. */}
      <ChartFrame
        label={summary}
        zoom={zoom}
        unit="months"
        className="h-80 w-full [&_.recharts-bar-rectangle]:pointer-events-none"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={visibleData}
            margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            {...zoom.chartProps}
          >
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" {...axisStyle} />
            <YAxis {...yAxisStyle} tickFormatter={compactNumber} />
            <Tooltip
              cursor={cursorStyle}
              isAnimationActive={false}
              {...zoom.tooltipProps}
              position={tooltipPosition}
              content={
                <ChartTooltip filterEntry={onlyCurrentRemaining} colorOf={barColour} footer={projectedFooter} />
              }
            />
            <Legend
              content={
                <ChartLegend
                  toggle={toggles.toggle}
                  isHidden={toggles.isHidden}
                  swatch={{ actual: SPLIT_SWATCH }}
                />
              }
            />
            <ReferenceLine
              y={netAvg}
              stroke={DEEP}
              strokeDasharray="4 4"
              label={{ value: 'Avg', position: 'insideTopRight', fill: DEEP, fontSize: 11 }}
            />
            <Bar
              dataKey="actual"
              name="Actual"
              stackId="month"
              fill={GOOD}
              hide={toggles.isHidden('actual')}
              isAnimationActive={!reduced}
            >
              {visibleData.map((point) => (
                <Cell key={`actual-${point.label}`} fill={actualBarColor(point.actual)} />
              ))}
            </Bar>
            <Bar
              dataKey="remaining"
              name="Remaining"
              stackId="month"
              fill={INFO}
              radius={[4, 4, 0, 0]}
              hide={toggles.isHidden('remaining')}
              isAnimationActive={!reduced}
            />
            {zoom.selection && (
              <ReferenceArea x1={zoom.selection.x1} x2={zoom.selection.x2} {...selectionStyle} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ZoomHint
        zoomed={zoom.zoomed}
        onReset={zoom.reset}
        label={zoom.zoomed ? `${first.label} – ${last.label}` : null}
      />

      <p className="t-label">
        Each bar is that month&apos;s net only (not cumulative). The current month stacks actual
        (green/red) with remaining (blue) to show the projected month-end net.
      </p>
    </div>
  );
}
