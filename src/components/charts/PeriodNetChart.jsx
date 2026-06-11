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

const REMAINING_COLOR = '#2563eb';

function actualBarColor(value) {
  if (value > 0.01) return '#16a34a';
  if (value < -0.01) return '#dc2626';
  return '#94a3b8';
}

function PeriodTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-lg border bg-white p-3 text-sm shadow-md">
      <p className="mb-2 font-medium text-slate-700">{label}</p>
      {row.isCurrentMonth ? (
        <>
          <p className="text-slate-800">
            Actual: <span className="font-semibold">{formatCurrency(row.actual)}</span>
          </p>
          <p className="text-blue-600">
            Remaining: <span className="font-semibold">{formatCurrency(row.remaining)}</span>
          </p>
          <p className="mt-1 border-t pt-1 text-slate-800">
            Projected: <span className="font-semibold">{formatCurrency(row.display)}</span>
          </p>
        </>
      ) : (
        <p className="text-slate-800">
          Net: <span className="font-semibold">{formatCurrency(row.actual)}</span>
        </p>
      )}
    </div>
  );
}

export function PeriodNetChart({ chartData }) {
  if (!chartData?.points.length) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-slate-500">
        No chart data for the selected range.
      </div>
    );
  }

  const { points, netAvg } = chartData;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Net Per Month</h2>
          <p className="text-sm text-slate-500">
            Income minus expense per pay month · transfers excluded
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Weighted avg (excl. current):{' '}
          <span className="font-medium text-slate-700">{formatCurrency(netAvg)}</span>
        </p>
      </div>

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v) =>
                new Intl.NumberFormat('en-ZA', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(v)
              }
            />
            <Tooltip content={<PeriodTooltip />} />
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

      <p className="text-xs text-slate-500">
        Each bar is that month&apos;s net only (not cumulative). The current month stacks actual
        (green/red) with remaining (blue) to show the projected month-end net.
      </p>
    </div>
  );
}
