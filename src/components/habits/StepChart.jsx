import { useCallback, useMemo, useRef, useState } from 'react';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * A recurring line's price over time, as a step.
 *
 * A subscription does not drift; it sits at one price and then jumps. Drawn as a line through the
 * per-cycle amounts it would look like noise; drawn as steps it looks like what it is — a regime,
 * a step, a regime — and the eye lands on the steps, which are the only thing worth looking at.
 * Each step is marked in the warn tone so a row with three of them reads differently from a row
 * with none before the percentage is read.
 *
 * Takes either a RecurringLine's `regimes` (cycle-keyed runs at one amount) or a price-creep item
 * (`first`, `last`, `steps`); both become the same cycle-by-cycle series. Hovering reads the cycle
 * and the amount, which is how "when did it go up" gets answered without a table.
 */

const W = 320;
const H = 40;
const PAD = 5;

const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const parseKey = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  return m ? [Number(m[1]), Number(m[2]) - 1] : null;
};
/** Every 'YYYY-MM' from `from` to `to` inclusive; capped so a bad key cannot loop forever. */
function monthsBetween(from, to) {
  const a = parseKey(from);
  const b = parseKey(to);
  if (!a || !b) return from ? [from] : [];
  const out = [];
  let [y, m] = a;
  for (let i = 0; i < 120; i += 1) {
    out.push(monthKey(y, m));
    if (y > b[0] || (y === b[0] && m >= b[1])) break;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}
const cycleLabel = (key) => {
  const p = parseKey(key);
  return p ? new Date(p[0], p[1], 1).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : key ?? '';
};

function pointsFromRegimes(regimes) {
  const runs = (regimes ?? []).filter((r) => r && r.from && Number.isFinite(r.amount));
  const multi = runs.filter((r) => (r.count ?? 2) >= 2);
  const kept = (multi.length ? multi : runs).slice().sort((a, b) => (a.from < b.from ? -1 : 1));
  const points = [];
  kept.forEach((r, i) => {
    monthsBetween(r.from, r.to ?? r.from).forEach((cycle, j) => {
      points.push({ cycle, amount: r.amount, step: i > 0 && j === 0 });
    });
  });
  return points;
}

function pointsFromCreep({ first, last, steps }) {
  if (!first?.cycle || !Number.isFinite(first.amount)) return [];
  const stepAt = new Map((steps ?? []).map((s) => [s.cycle, s.to]));
  let amount = first.amount;
  return monthsBetween(first.cycle, last?.cycle ?? first.cycle).map((cycle) => {
    const step = stepAt.has(cycle);
    if (step) amount = stepAt.get(cycle);
    return { cycle, amount, step };
  });
}

export function StepChart({ regimes, first, last, steps, className = '' }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const points = useMemo(
    () => (regimes ? pointsFromRegimes(regimes) : pointsFromCreep({ first, last, steps })),
    [regimes, first, last, steps],
  );

  const onPointerMove = useCallback(
    (e) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || points.length < 1) return;
      const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setHover(Math.round(t * (points.length - 1)));
    },
    [points.length],
  );
  const onPointerLeave = useCallback(() => setHover(null), []);

  if (!points.length) return null;

  const amounts = points.map((p) => p.amount);
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  const span = hi - lo || Math.max(1, hi * 0.2);
  const n = points.length;
  const xOf = (i) => (n === 1 ? (i === 0 ? 0 : W) : (i / (n - 1)) * W);
  const yOf = (v) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  // Each cycle holds its amount until the next one: horizontal to the next x, then a riser.
  let d = '';
  points.forEach((p, i) => {
    const x = xOf(i);
    const y = yOf(p.amount);
    if (i === 0) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
    else d += ` V${y.toFixed(1)}`;
    const nextX = i === n - 1 ? W : xOf(i + 1);
    d += ` H${nextX.toFixed(1)}`;
  });
  const stepIndexes = points.map((p, i) => (p.step ? i : null)).filter((i) => i != null);
  const summary = `${cycleLabel(points[0].cycle)} ${formatCurrencyAbs(points[0].amount)} to ${cycleLabel(points[n - 1].cycle)} ${formatCurrencyAbs(points[n - 1].amount)}, ${stepIndexes.length} step${stepIndexes.length === 1 ? '' : 's'}`;
  const current = hover != null ? points[hover] : null;

  return (
    <span className={`relative inline-block ${className}`} style={{ width: 160, height: H }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-full w-full touch-none"
        role="img"
        aria-label={summary}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <path d={d} fill="none" stroke="var(--color-label-2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {stepIndexes.map((i) => (
          <g key={i}>
            <line
              x1={xOf(i)}
              x2={xOf(i)}
              y1={yOf(points[i].amount)}
              y2={H}
              stroke="var(--color-warn)"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={xOf(i)} cy={yOf(points[i].amount)} r={3.5} fill="var(--color-warn)" />
          </g>
        ))}
        {current && (
          <g>
            <line x1={xOf(hover)} x2={xOf(hover)} y1="0" y2={H} stroke="rgba(255,255,255,0.28)" vectorEffect="non-scaling-stroke" />
            <circle cx={xOf(hover)} cy={yOf(current.amount)} r={3.5} fill="var(--color-label)" />
          </g>
        )}
      </svg>
      {current && (
        <span
          className="glass-chip num pointer-events-none absolute z-10 whitespace-nowrap px-2 py-0.5 text-[11px] text-label"
          style={{
            top: -26,
            left: `${(xOf(hover) / W) * 100}%`,
            transform: xOf(hover) / W > 0.6 ? 'translateX(-100%)' : 'none',
          }}
        >
          {cycleLabel(current.cycle)} · {formatCurrencyAbs(current.amount)}
        </span>
      )}
    </span>
  );
}
