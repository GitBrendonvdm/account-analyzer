import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';
import { STICKY_CELL, TableScroller } from './TableScroller';

/**
 * Which way the household is going: the last three cycles against the last twelve, against the
 * twelve before that.
 *
 * Safe-to-spend is about this cycle and the vitals are about the year; this is about the trend,
 * which is the one question a single window cannot answer. Every row is a per-cycle figure at
 * three horizons, so "income is down" and "income is down but it was lower still last year" read
 * as different rows rather than the same number. The headline sentence states the net in so many
 * words — widening, narrowing or holding — because that is the sentence the whole table exists to
 * justify.
 *
 * A cycle in which the salary landed outside its pay month makes the short window incomparable;
 * those rows carry a note and a neutral tone instead of a verdict, because a late salary is a
 * timing event and not a trend.
 */

const TONE_CLASS = { good: 'text-good', bad: 'text-bad', neutral: 'text-label-3' };
const money = (v) => (Number.isFinite(v) ? formatCurrency(v) : '—');

function Spark({ values }) {
  const nums = (values ?? []).filter((v) => Number.isFinite(v)).slice(-12);
  if (!nums.length) return null;
  const max = Math.max(...nums.map((v) => Math.abs(v)), 1e-9);
  const negative = nums.some((v) => v < 0);
  const H = 26;
  const base = negative ? H / 2 : H;
  const scale = negative ? H / 2 : H;
  const W = 12 * 8 - 2;
  const pad = 12 - nums.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[26px] w-[94px]" aria-hidden>
      {negative && <line x1="0" x2={W} y1={base} y2={base} stroke="rgba(255,255,255,0.14)" vectorEffect="non-scaling-stroke" />}
      {nums.map((v, i) => {
        const h = Math.max(1.5, (Math.abs(v) / max) * scale);
        const last = i === nums.length - 1;
        return (
          <rect
            key={i}
            x={(pad + i) * 8}
            y={v >= 0 ? base - h : base}
            width={6}
            height={h}
            fill={last ? 'var(--color-info)' : 'rgba(255,255,255,0.14)'}
          />
        );
      })}
    </svg>
  );
}

function Change({ metric }) {
  const delta = metric.delta;
  if (!Number.isFinite(delta)) return <span className="text-label-4">—</span>;
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  const pct = Number.isFinite(metric.deltaPct) ? ` (${metric.deltaPct >= 0 ? '+' : '−'}${Math.round(Math.abs(metric.deltaPct) * 100)}%)` : '';
  return (
    <span className={`inline-flex items-center gap-1 ${TONE_CLASS[metric.tone] ?? 'text-label-3'}`}>
      <Icon size={13} />
      <span className="num">
        {delta >= 0 ? '+' : '−'}
        {formatCurrencyAbs(delta)}
        {pct}
      </span>
    </span>
  );
}

export function DirectionTable({ direction, className = '' }) {
  if (!direction) return null;
  const { summary = {}, metrics = [] } = direction;
  const gap = summary.netShort - summary.netLong;
  const word = summary.widening ? 'widening' : gap > 500 ? 'narrowing' : 'holding';
  const headline = Number.isFinite(summary.netShort) && Number.isFinite(summary.netLong)
    ? `The gap is ${word}: ${money(summary.netShort)} a cycle over the last 3 cycles against ${money(summary.netLong)} over the last 12${Number.isFinite(summary.netPrior) ? `, and ${money(summary.netPrior)} the year before` : ''}.`
    : null;

  return (
    <section className={`glass overflow-hidden ${className}`}>
      {/* Card padding steps down to 16px on a phone: the card is already full-bleed there. */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-4 md:px-6 md:py-5">
        <div>
          <h2 className="t-head">Direction</h2>
          <p className="t-label mt-1.5 max-w-prose">
            Each figure per cycle at three horizons, over {direction.cycles?.length ?? 0} complete cycles. Improving always means toward good.
          </p>
        </div>
      </div>
      {headline && (
        <p className={`t-sub border-b px-4 py-4 md:px-6 ${summary.widening ? 'text-bad' : word === 'narrowing' ? 'text-good' : ''}`}>{headline}</p>
      )}
      <TableScroller>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase max-md:text-xs">
              <th className={`border-b px-4 py-2.5 md:px-6 ${STICKY_CELL}`}>Metric</th>
              <th className="border-b px-4 py-2.5 text-right">12-cycle</th>
              <th className="border-b px-4 py-2.5 text-right">3-cycle</th>
              <th className="border-b px-4 py-2.5">Change</th>
              <th className="border-b px-4 py-2.5 text-right">Prior 12</th>
              <th className="border-b px-4 py-2.5">Trend</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className={`px-4 py-2.5 md:px-6 ${STICKY_CELL}`}>
                  <span className="text-sm text-label">{m.label ?? m.id}</span>
                  {m.note && <div className="t-caption max-w-[32ch]">{m.note}</div>}
                </td>
                {/* A figure that wraps reads as two numbers; at the 720px floor the columns are tight. */}
                <td className="num px-4 py-2.5 text-right whitespace-nowrap text-label-2">{money(m.long)}</td>
                <td className="num px-4 py-2.5 text-right font-medium whitespace-nowrap">{money(m.short)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <Change metric={m} />
                </td>
                <td className="num px-4 py-2.5 text-right whitespace-nowrap text-label-2">{money(m.prior)}</td>
                <td className="px-4 py-2.5">
                  <Spark values={m.series} />
                </td>
              </tr>
            ))}
            {metrics.length === 0 && (
              <tr>
                <td colSpan={6} className="t-caption px-4 py-4 md:px-6">
                  Direction needs at least three complete cycles.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroller>
      {direction.assumptions?.length > 0 && <p className="t-caption border-t px-4 py-4 md:px-6">{direction.assumptions.join(' ')}</p>}
    </section>
  );
}
