import { useMemo } from 'react';
import {
  Area,
  AreaChart,
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
  ChartTooltip,
  GOOD,
  ZoomHint,
  cursorStyle,
  selectionStyle,
  useReducedMotion,
  useZoomDomain,
} from './interactive';

/**
 * Per-account movement as small multiples.
 *
 * One shared axis is useless here: Nedbank Loan *2801 moves by millions while FNB Bank *4359 moves
 * by hundreds, so nine of eleven accounts would render as a flat line on zero. A log axis can't
 * help either, because the values are negative. Each account therefore gets its own scale, and the
 * cards are ordered by how much they actually moved.
 *
 * Each card is a chart in its own right — hover reads the date, the level and the change since the
 * start of what is visible, and a drag zooms that card. The zoom is per card rather than shared,
 * because the cards are indexed by transaction and no two accounts transact on the same days: a
 * span of twelve points on a card is twelve of THAT account's movements.
 *
 * No legend: one series per card, and the card's title is its name.
 */

const GRID = 'rgba(255,255,255,0.16)';
const dateLabel = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

function Movement({ account }) {
  // Several transactions can land on one day, so the axis is keyed on a per-point id rather than
  // the date; the date is carried separately for the readout.
  const data = useMemo(
    () =>
      account.points.map((p, i) => ({
        key: `${p.t}-${i}`,
        label: dateLabel.format(p.date ?? new Date(p.t)),
        value: p.value,
      })),
    [account.points],
  );
  const zoom = useZoomDomain(data, 'key');
  const reduced = useReducedMotion();

  if (data.length < 2) {
    return (
      <div className="flex h-[72px] items-center justify-center text-xs text-label-3">
        Not enough activity to plot
      </div>
    );
  }

  const colour = account.change >= 0 ? GOOD : BAD;
  const first = zoom.visibleData[0];
  const summary = `${account.account}: moved ${formatCurrency(account.change)} over ${account.count} transactions, between ${formatCurrency(
    account.min,
  )} and ${formatCurrency(account.max)}.`;

  return (
    <>
      <ChartFrame label={summary} zoom={zoom} unit="transactions" className="h-[72px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={zoom.visibleData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} {...zoom.chartProps}>
            <XAxis dataKey="key" hide />
            <YAxis hide domain={['dataMin', 'dataMax']} />
            {/* Where zero sits, when the curve actually crosses it; discarded otherwise. */}
            <ReferenceLine y={0} stroke={GRID} strokeDasharray="3 3" />
            <Tooltip
              cursor={cursorStyle}
              isAnimationActive={false}
              active={zoom.dragging ? false : undefined}
              content={<ChartTooltip deltaFrom={first} />}
            />
            <Area
              type="linear"
              dataKey="value"
              name="Movement"
              stroke={colour}
              strokeWidth={1.5}
              fill={colour}
              fillOpacity={0.08}
              baseValue="dataMin"
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0, fill: colour }}
              isAnimationActive={!reduced}
            />
            {zoom.selection && (
              <ReferenceArea x1={zoom.selection.x1} x2={zoom.selection.x2} {...selectionStyle} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
      {zoom.zoomed && <ZoomHint zoomed onReset={zoom.reset} hint={null} className="mt-2" />}
    </>
  );
}

export function AccountMovementChart({ series }) {
  const accounts = series?.accounts ?? [];

  if (accounts.length === 0) {
    return (
      <div className="glass p-6">
        <h2 className="t-head">Account movement</h2>
        <div className="flex h-40 items-center justify-center text-sm text-label-2">
          No account activity in the selected range.
        </div>
      </div>
    );
  }

  return (
    <div className="glass p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-head">Account movement</h2>
        <p className="t-label">
          Cumulative change per account, each on its own scale. Transfers included.
        </p>
      </div>
      <p className="t-label mt-1.5">
        This is movement, not a balance — the export has no balance column, so every line starts
        from zero at the beginning of the range.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.account} className="rounded-xl border border-hair p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-label-2" title={a.account}>
                {a.account}
              </span>
              <span
                className={`shrink-0 text-sm font-semibold tabular-nums ${
                  a.change > 0 ? 'text-good' : a.change < 0 ? 'text-bad' : 'text-label-3'
                }`}
              >
                {formatCurrency(a.change)}
              </span>
            </div>
            <div className="mt-2">
              <Movement account={a} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-label-3 tabular-nums">
              <span>{formatCurrency(a.min)}</span>
              <span>{a.count} transactions</span>
              <span>{formatCurrency(a.max)}</span>
            </div>
          </div>
        ))}
      </div>

      <ZoomHint zoomed={false} hint="Drag across any chart to zoom in" className="mt-4" />
    </div>
  );
}
