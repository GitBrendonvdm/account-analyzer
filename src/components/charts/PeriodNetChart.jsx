import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../../utils/format';

const REMAINING_COLOR = '#0a84ff';

function actualBarColor(value) {
  if (value > 0.01) return '#30d158';
  if (value < -0.01) return '#ff453a';
  return 'rgba(235,235,245,0.4)';
}

function PeriodTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="glass-tile p-3 text-sm shadow-md">
      <p className="mb-2 font-medium text-label-2">{label}</p>
      {row.isCurrentMonth ? (
        <>
          <p className="text-label">
            Actual: <span className="font-semibold">{formatCurrency(row.actual)}</span>
          </p>
          <p className="text-info">
            Remaining: <span className="font-semibold">{formatCurrency(row.remaining)}</span>
          </p>
          <p className="mt-1 border-t pt-1 text-label">
            Projected: <span className="font-semibold">{formatCurrency(row.display)}</span>
          </p>
        </>
      ) : (
        <p className="text-label">
          Net: <span className="font-semibold">{formatCurrency(row.actual)}</span>
        </p>
      )}
    </div>
  );
}

export function PeriodNetChart({ chartData }) {
  if (!chartData?.points.length) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-label-2">
        No chart data for the selected range.
      </div>
    );
  }

  const { points, netAvg } = chartData;

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

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgba(235,235,245,0.46)' }} />
            <YAxis
              tick={{ fontSize: 11, fill: 'rgba(235,235,245,0.46)' }}
              tickFormatter={(v) =>
                new Intl.NumberFormat('en-ZA', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(v)
              }
            />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, background: '#16161c', border: '1px solid rgba(255,255,255,0.1)', color: '#f5f5f7' }} itemStyle={{ color: '#f5f5f7' }} labelStyle={{ color: 'rgba(235,235,245,0.6)' }} content={<PeriodTooltip />} />
            <Legend />
            <ReferenceLine
              y={netAvg}
              stroke="#6366f1"
              strokeDasharray="4 4"
              label={{
                value: 'Avg',
                position: 'insideTopRight',
                fill: '#6366f1',
                fontSize: 11,
              }}
            />
            <Bar dataKey="actual" name="Actual" stackId="month" radius={[0, 0, 0, 0]}>
              {points.map((point) => (
                <Cell key={`actual-${point.label}`} fill={actualBarColor(point.actual)} />
              ))}
            </Bar>
            <Bar
              dataKey="remaining"
              name="Remaining"
              stackId="month"
              fill={REMAINING_COLOR}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="t-label">
        Each bar is that month&apos;s net only (not cumulative). The current month stacks actual
        (green/red) with remaining (blue) to show the projected month-end net.
      </p>
    </div>
  );
}
