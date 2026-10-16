import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';
import { BAD, GOOD, axisStyle, compactNumber, cursorStyle, gridStyle, useReducedMotion, yAxisStyle } from './interactive';

const EMPTY = [];

const labelOf = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return `${new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'short' })} ${String(y).slice(2)}`;
};

function Readout({ active, payload }) {
  const row = active ? payload?.[0]?.payload : null;
  if (!row) return null;
  const up = row.change >= 0;
  return (
    <div className="glass-tile px-3 py-2 text-xs">
      <div className="font-semibold text-label">
        {row.label}
        {row.partial ? ' so far' : ''}
      </div>
      <div className={up ? 'text-good' : 'text-bad'}>
        {up ? 'Up' : 'Down'} {formatCurrencyAbs(row.change)}
      </div>
      <div className="text-label-2">Net worth {formatCurrency(row.net)}</div>
    </div>
  );
}

/**
 * Is net worth going up or down, month by month?
 *
 * One bar per pay cycle, green when net worth rose and red when it fell, so a run of bad months reads
 * as a run of red before any number does. The cycle still in progress is faint, because it is not
 * finished. The level is in the readout, not on the axis — the question is the direction.
 */
export function NetWorthChart({ trend }) {
  const reduced = useReducedMotion();
  const rows = trend?.rows ?? EMPTY;
  if (!trend || !rows.length) {
    return (
      <div className="flex h-56 items-center justify-center text-center text-sm text-label-2">
        Net worth needs a balance on at least one account. Add them under Accounts.
      </div>
    );
  }
  const data = rows.map((r) => ({ ...r, label: labelOf(r.month) }));
  const up = trend.sinceLast >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="t-head">Net worth, month by month</h2>
          <p className="text-sm text-label-2">How far net worth moved in each pay cycle.</p>
        </div>
        <div className="text-right">
          <div className={`num text-xl font-semibold ${trend.now < 0 ? 'text-bad' : 'text-label'}`}>{formatCurrency(trend.now)}</div>
          <div className={`flex items-center justify-end gap-1.5 text-xs ${up ? 'text-good' : 'text-bad'}`}>
            <Icon size={13} />
            {up ? 'Up' : 'Down'} {formatCurrencyAbs(trend.sinceLast)} so far this cycle
            {trend.of > 0 && ` · up in ${trend.up} of ${trend.of} full cycles`}
          </div>
        </div>
      </div>

      <div
        className="h-64 w-full [&_.recharts-bar-rectangle]:pointer-events-none"
        role="img"
        aria-label={`Change in net worth each pay cycle, ${data.length} cycles. Now ${formatCurrency(trend.now)}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid {...gridStyle} />
            <XAxis dataKey="label" {...axisStyle} />
            <YAxis {...yAxisStyle} tickFormatter={compactNumber} />
            <Tooltip cursor={cursorStyle} isAnimationActive={false} content={<Readout />} />
            <ReferenceLine y={0} stroke="rgba(235,235,245,0.3)" />
            <Bar dataKey="change" radius={[4, 4, 0, 0]} isAnimationActive={!reduced}>
              {data.map((r) => (
                <Cell key={r.month} fill={r.change >= 0 ? GOOD : BAD} fillOpacity={r.partial ? 0.45 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {(trend.owned?.length > 0 || trend.estimated?.length > 0 || !trend.complete) && (
        <p className="t-caption">
          {trend.owned?.length > 0 && `Counts ${trend.owned.join(', ')}. `}
          {trend.estimated?.length > 0 && `Includes an estimate for ${trend.estimated.join(', ')}. `}
          {!trend.complete && `${trend.missing.length} account${trend.missing.length === 1 ? ' has' : 's have'} no balance and ${trend.missing.length === 1 ? 'is' : 'are'} not counted.`}
        </p>
      )}
    </div>
  );
}
