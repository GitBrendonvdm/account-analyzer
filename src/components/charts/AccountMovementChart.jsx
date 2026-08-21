import { formatCurrency } from '../../utils/format';

/**
 * Per-account movement as small multiples.
 *
 * One shared axis is useless here: Nedbank Loan *2801 moves by millions while FNB Bank *4359 moves
 * by hundreds, so nine of eleven accounts would render as a flat line on zero. A log axis can't
 * help either, because the values are negative. Each account therefore gets its own scale, and the
 * cards are ordered by how much they actually moved.
 *
 * Drawn as plain SVG rather than Recharts: these are small, static, and there are eleven of them,
 * and ResponsiveContainer measures 0x0 under a headless browser, which makes them unverifiable.
 */

const W = 320;
const H = 72;

function Sparkline({ points, positive }) {
  if (points.length < 2) {
    return (
      <div className="flex h-[72px] items-center justify-center text-xs text-label-3">
        Not enough activity to plot
      </div>
    );
  }
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.value);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const spanX = x1 - x0 || 1;
  const spanY = y1 - y0 || 1;

  const sx = (t) => ((t - x0) / spanX) * W;
  const sy = (v) => H - ((v - y0) / spanY) * H;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const stroke = positive ? '#30d158' : '#ff453a';
  // Where zero sits, when the curve actually crosses it.
  const zeroY = y0 <= 0 && y1 >= 0 ? sy(0) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full" preserveAspectRatio="none" aria-hidden>
      {zeroY != null && (
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="rgba(255,255,255,0.16)" strokeWidth="1" strokeDasharray="3 3" />
      )}
      <path d={area} fill={stroke} opacity="0.08" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
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
              <Sparkline points={a.points} positive={a.change >= 0} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-label-3 tabular-nums">
              <span>{formatCurrency(a.min)}</span>
              <span>{a.count} transactions</span>
              <span>{formatCurrency(a.max)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
