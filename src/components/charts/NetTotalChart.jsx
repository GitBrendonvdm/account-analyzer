import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../../utils/format';

function ChartTooltip({ active, payload, label, chartData }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-lg border bg-white p-3 text-sm shadow-md">
      <p className="mb-2 font-medium text-slate-700">{label}</p>
      {row?.actual != null && (
        <p className="text-slate-800">
          Running total: <span className="font-semibold">{formatCurrency(row.actual)}</span>
        </p>
      )}
      {row?.expectedProjected != null && row.isFuture && (
        <p className="text-blue-600">
          Projected: <span className="font-semibold">{formatCurrency(row.expectedProjected)}</span>
        </p>
      )}
      {row?.isToday && chartData && (
        <div className="mt-2 space-y-1 border-t pt-2 text-xs text-slate-500">
          <p>Prior months: {formatCurrency(chartData.priorRunning)}</p>
          <p>This month (table): {formatCurrency(chartData.tableMonthNet)}</p>
          <p>Running today: {formatCurrency(chartData.todayRunning)}</p>
          <p>
            This month projected: {formatCurrency(chartData.tableMonthNet)} + remaining{' '}
            {formatCurrency(chartData.signedRemaining)} ={' '}
            {formatCurrency(chartData.currentMonthProjected)}
          </p>
          <p>
            Next-pay target: {formatCurrency(chartData.priorRunning)} + this cycle projected ={' '}
            {formatCurrency(chartData.monthEndProjectedRunning)}
          </p>
          <p>
            Table remaining: income {formatCurrency(chartData.incomeRemaining)} + expense{' '}
            {formatCurrency(chartData.expenseRemaining)} = {formatCurrency(chartData.netExpected)}
          </p>
        </div>
      )}
    </div>
  );
}

const granularityLabel = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
};

export function NetTotalChart({ chartData }) {
  if (!chartData?.points.length) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-slate-500">
        No chart data for the selected range.
      </div>
    );
  }

  const {
    granularity,
    points,
    netAvg,
    netExpected,
    incomeRemaining,
    expenseRemaining,
    tableMonthNet,
    monthEndProjectedRunning,
    todayRunning,
  } = chartData;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Net Total Over Time</h2>
          <p className="text-sm text-slate-500">
            Running net total ({granularityLabel[granularity]} buckets) · transfers excluded
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Avg monthly net (excl. current):{' '}
          <span className="font-medium text-slate-700">{formatCurrency(netAvg)}</span>
        </p>
      </div>

      <div className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#64748b' }}
              interval="preserveStartEnd"
              angle={granularity === 'day' ? -35 : 0}
              textAnchor={granularity === 'day' ? 'end' : 'middle'}
              height={granularity === 'day' ? 60 : 30}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v) =>
                new Intl.NumberFormat('en-ZA', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(v)
              }
            />
            <Tooltip content={<ChartTooltip chartData={chartData} />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="actual"
              name="Running total"
              stroke="#1e293b"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="expectedProjected"
              name="Remaining projection"
              stroke="#2563eb"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: '#2563eb' }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-1 text-xs text-slate-500">
        <p>
          Running total uses base transactions through each bucket. The blue line projects from today
          ({formatCurrency(todayRunning)}) to next pay ({formatCurrency(monthEndProjectedRunning)}
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
