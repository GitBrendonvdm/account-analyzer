import { useMemo, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { useSeriesToggle } from '../charts/interactive';
import { READOUT_CLASS, readoutStyle, useSpanDrag } from './useSpanDrag';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';

/**
 * Where the cash goes between now and payday, day by day.
 *
 * Safe-to-spend is one number for the whole stretch; this is the shape of it. The line is the sum
 * of the liquid accounts walked forward from the last observed day — every scheduled charge on the
 * day it usually lands, the salary on its day, and the ordinary daily spend at the pace this point
 * of the cycle has run at before — so the question it answers is not "how much is left" but "on
 * which day does it run out, and by how much". A trough on day 9 with the instalments on the 24th
 * is a different problem from a slow slide to payday, and a total cannot tell them apart.
 *
 * Observed days draw solid and projected days dashed, the same convention as the other Today
 * charts, with the low/high band showing how wide the guess is. The buffer rule is the user's own
 * figure (settings.cashBuffer); the first day under it is marked, because that is the day to act
 * before. Drag across the plot to zoom, hover for the day's balance and what lands on it, click an
 * account chip to see its own line — the trough is usually one account's, not everyone's. On a
 * phone a tap pins the readout and a vertical swipe still scrolls (see `useSpanDrag`).
 *
 * Until the backtest (scripts/backtest-cash.mjs) passes its gate the card says "Estimate" in so
 * many words. A forecast that has not yet been scored against the past should not dress as fact.
 */

const W = 1000;
const H = 220;
const PAD = 14;
const TOTAL_COLOUR = '#f5f5f7';
const ACCOUNT_COLOURS = ['#0a84ff', '#63e6e2', '#5e5ce6', '#ff9f0a', '#ff375f'];
const DAY_MONTH = { day: 'numeric', month: 'short' };

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const keyOf = (d) => (d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : '');
const fmtDate = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-ZA', DAY_MONTH) : '—';
};
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Every series aligned to the total's day index, plus the day each item lands on. */
function buildModel(cashPath) {
  const days = (cashPath?.total?.days ?? []).map((d) => ({ ...d, date: toDate(d.date) }));
  if (!days.length) return null;
  const index = new Map(days.map((d, i) => [keyOf(d.date), i]));
  const items = days.map(() => []);
  const accounts = (cashPath.accounts ?? []).map((a, i) => {
    const byKey = new Map((a.days ?? []).map((d) => [keyOf(toDate(d.date)), d]));
    for (const day of a.days ?? []) {
      const at = index.get(keyOf(toDate(day.date)));
      if (at == null) continue;
      for (const s of day.scheduled ?? []) items[at].push({ ...s, account: a.label });
    }
    return {
      id: a.accountId ?? `account-${i}`,
      label: a.label ?? a.accountId ?? `Account ${i + 1}`,
      colour: ACCOUNT_COLOURS[i % ACCOUNT_COLOURS.length],
      known: a.known !== false,
      points: days.map((d) => byKey.get(keyOf(d.date))?.balance ?? null),
    };
  });
  // A total that carries its own item arrays (no per-account detail) still gets dots.
  if (items.every((list) => !list.length)) {
    days.forEach((d, i) => {
      if (Array.isArray(d.scheduled)) items[i].push(...d.scheduled);
    });
  }
  const lastObserved = days.reduce((last, d, i) => (d.observed === false ? last : i), 0);
  const total = cashPath.total;
  const buffer = cashPath.buffer ?? 0;
  const dip = buffer > 0 ? (total.firstBelowBuffer ?? total.firstBelowFloor) : total.firstBelowFloor;
  return {
    days,
    items,
    lastObserved,
    series: [
      { id: 'total', label: 'All cash', colour: TOTAL_COLOUR, width: 3, points: days.map((d) => d.balance) },
      ...accounts,
    ],
    paydayIndex: index.get(keyOf(toDate(cashPath.horizon?.nextPayDate))) ?? null,
    dipIndex: index.get(keyOf(toDate(dip?.date))) ?? null,
    minIndex: index.get(keyOf(toDate(total.min?.date))) ?? null,
    maxItem: Math.max(...items.flat().map((it) => Math.abs(it.amount ?? 0)), 1),
  };
}

export function CashPath({ cashPath, incomeProfile, onOpenAccounts, className = '' }) {
  const svgRef = useRef(null);
  const model = useMemo(() => buildModel(cashPath), [cashPath]);
  const { hidden, toggle } = useSeriesToggle();
  const length = model?.days.length ?? 0;
  const { drag, hover, from, to, zoomed, reset, svgProps, frameProps } = useSpanDrag({ svgRef, length });

  const geometry = useMemo(() => {
    if (!model) return null;
    const shown = model.series.filter((s) => !hidden.has(s.id));
    const span = Math.max(1, to - from);
    const buffer = cashPath.buffer ?? 0;
    const visible = [
      ...shown.flatMap((s) => s.points.slice(from, to + 1)),
      ...model.days.slice(from, to + 1).flatMap((d) => [d.low, d.high]),
      0,
      buffer,
    ].filter((v) => typeof v === 'number' && Number.isFinite(v));
    const lo = Math.min(...visible);
    const hi = Math.max(...visible);
    const pad = (hi - lo || 1) * 0.08;
    const top = hi + pad;
    const bottom = lo - pad;
    const xOf = (i) => ((i - from) / span) * W;
    const yOf = (v) => PAD + ((top - v) / (top - bottom)) * (H - PAD * 2);
    const draw = (points, a, b) => {
      let d = '';
      let open = false;
      for (let i = Math.max(a, from); i <= Math.min(b, to) && i < points.length; i += 1) {
        const v = points[i];
        if (v == null || !Number.isFinite(v)) {
          open = false;
          continue;
        }
        d += `${open ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
        open = true;
      }
      return d.trim();
    };
    const band = (() => {
      const lows = [];
      const highs = [];
      for (let i = from; i <= to; i += 1) {
        const d = model.days[i];
        if (d && Number.isFinite(d.low) && Number.isFinite(d.high)) {
          lows.push(`${xOf(i).toFixed(1)},${yOf(d.low).toFixed(1)}`);
          highs.push(`${xOf(i).toFixed(1)},${yOf(d.high).toFixed(1)}`);
        }
      }
      return lows.length > 1 ? `M${highs.join(' L')} L${lows.reverse().join(' L')} Z` : '';
    })();
    return {
      shown,
      xOf,
      yOf,
      band,
      shapes: shown.map((s) => ({
        ...s,
        solid: draw(s.points, 0, model.lastObserved),
        dashed: draw(s.points, model.lastObserved, s.points.length - 1),
      })),
      zeroY: yOf(0),
      bufferY: buffer > 0 ? yOf(buffer) : null,
      gridYs: [0.25, 0.5, 0.75].map((f) => PAD + f * (H - PAD * 2)),
      ticks: [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(from + f * span)))],
      inView: (i) => i != null && i >= from && i <= to,
    };
  }, [model, hidden, from, to, cashPath]);

  if (!cashPath || !model || !geometry) {
    return cashPath === undefined || cashPath === null ? null : (
      <Card className={`materialize p-5 sm:p-8 ${className}`}>
        <CardHead title="Cash to payday" subtitle="Needs a Bank or Savings account with transactions to draw a path." />
      </Card>
    );
  }

  const { total, buffer = 0, anchored, horizon, lateSalary, estimate } = cashPath;
  const totalPoints = model.series[0].points;
  const payday = toDate(horizon?.nextPayDate);
  const dipDay = model.dipIndex != null ? model.days[model.dipIndex] : null;
  const floorLabel = buffer > 0 ? `your ${formatCurrencyAbs(buffer)} buffer` : 'zero';
  const dipsBeforePayday = dipDay && (!payday || dipDay.date < payday);
  const underDays = total.daysUnderBuffer ?? 0;
  const last = model.days[model.days.length - 1];
  const sentence = dipsBeforePayday
    ? `Cash drops to ${formatCurrency(total.min?.value ?? dipDay.balance)} on ${fmtDate(total.min?.date ?? dipDay.date)} — ${plural(underDays, 'day')} under ${floorLabel} before the salary on the ${payday ? ordinal(payday.getDate()) : 'next payday'}.`
    : `Stays above ${floorLabel}; ${formatCurrency(total.endOfHorizon ?? last.balance)} left on ${fmtDate(horizon?.to ?? last.date)}.`;

  const salary = incomeProfile?.salary;
  const lateCount = salary ? (salary.missingCycles?.length ?? 0) + (salary.lateCycles?.length ?? 0) : null;
  const lateOf = salary?.cycles ?? incomeProfile?.cycles?.length ?? null;
  const lateHistory =
    lateCount != null && lateOf
      ? `it has been in ${lateCount} of ${plural(lateOf, 'cycle')}`
      : `it has been in about ${Math.round((lateSalary?.probability ?? 0) * 100)}% of cycles`;
  const lateLine = lateSalary
    ? lateSalary.firstBelowFloor
      ? `If the salary is ${plural(lateSalary.delayDays, 'day')} late (${lateHistory}), you are under zero from the ${fmtDate(lateSalary.firstBelowFloor.date)}.`
      : `If the salary is ${plural(lateSalary.delayDays, 'day')} late (${lateHistory}), you still stay above zero.`
    : null;

  const readout =
    hover != null && !drag && model.days[hover]
      ? {
          day: model.days[hover],
          x: geometry.xOf(hover),
          rows: geometry.shown
            .map((s) => ({ id: s.id, label: s.label, colour: s.colour, value: s.points[hover] }))
            .filter((r) => r.value != null && Number.isFinite(r.value)),
          items: model.items[hover],
        }
      : null;
  const band =
    drag && Math.abs(drag.to - drag.from) > 0
      ? {
          x: Math.min(geometry.xOf(drag.from), geometry.xOf(drag.to)),
          w: Math.abs(geometry.xOf(drag.to) - geometry.xOf(drag.from)),
          days: Math.abs(drag.to - drag.from) + 1,
        }
      : null;
  const trough =
    geometry.inView(model.minIndex) && totalPoints[model.minIndex] != null
      ? { x: geometry.xOf(model.minIndex), y: geometry.yOf(totalPoints[model.minIndex]) }
      : null;

  return (
    <Card className={`materialize flex flex-col p-5 sm:p-8 ${className}`}>
      <CardHead
        title="Cash to payday"
        subtitle={
          anchored
            ? `Every Bank and Savings account walked forward from ${fmtDate(cashPath.dataThrough)} to a week past payday.`
            : 'No account has a balance yet, so this is the change since today rather than the level — the trough day still holds.'
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            {estimate && (
              <span
                className="glass-chip px-3 py-1.5 text-[12px] text-warn"
                title={
                  cashPath.backtest?.day7
                    ? `Backtested on ${cashPath.backtest.cycles} past cycles: from day 7 the dip call was right ${cashPath.backtest.day7.signHits} of ${cashPath.backtest.day7.cycles} times and the low point within R${cashPath.backtest.day7.valueMedian.toLocaleString('en-ZA')}; from day 14, ${cashPath.backtest.day14?.signHits} of ${cashPath.backtest.day14?.cycles} and within R${cashPath.backtest.day14?.valueMedian.toLocaleString('en-ZA')}.`
                    : 'Not yet validated against past cycles'
                }
              >
                {cashPath.backtest?.day7
                  ? `Estimate — dip called right ${cashPath.backtest.day7.signHits} of ${cashPath.backtest.day7.cycles} times from day 7, ${cashPath.backtest.day14?.signHits} of ${cashPath.backtest.day14?.cycles} from day 14`
                  : 'Estimate — not yet validated against past cycles'}
              </span>
            )}
            {!anchored && (
              <button
                type="button"
                onClick={onOpenAccounts}
                className="glass-chip press min-h-11 px-3 py-1.5 text-[12px] font-medium text-info hover:brightness-125 sm:min-h-0"
              >
                Add balances
              </button>
            )}
          </div>
        }
      />

      <p className="t-sub mt-5">{sentence}</p>
      {lateLine && <p className="mt-1.5 text-[13.5px] text-warn">{lateLine}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-0 sm:gap-y-2">
        {model.series.map((s) => {
          const off = hidden.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(s.id)}
              className="press flex min-h-11 items-center gap-2 rounded-full px-1.5 py-0.5 text-[12.5px] hover:bg-fill sm:min-h-0"
              style={{ opacity: off ? 0.35 : 1 }}
            >
              <span className="block h-[3px] w-4 rounded-full" style={{ background: s.colour }} />
              <span className={s.id === 'total' ? 'font-medium text-label' : 'text-label-2'}>{s.label}</span>
              {s.known === false && <span className="text-label-4">no balance</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex min-h-0 flex-grow flex-col" {...frameProps}>
        <div className="relative flex min-h-0 flex-grow flex-col">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            height="100%"
            {...svgProps}
            role="img"
            aria-label={sentence}
          >
            {geometry.gridYs.map((y) => (
              <line key={y} x1="0" x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" vectorEffect="non-scaling-stroke" />
            ))}
            {geometry.band && <path d={geometry.band} fill="rgba(10,132,255,0.12)" stroke="none" />}
            <line x1="0" x2={W} y1={geometry.zeroY} y2={geometry.zeroY} stroke="var(--color-label-4)" vectorEffect="non-scaling-stroke" />
            {geometry.bufferY != null && (
              <line
                x1="0"
                x2={W}
                y1={geometry.bufferY}
                y2={geometry.bufferY}
                stroke="var(--color-warn)"
                strokeDasharray="6 5"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {geometry.inView(model.paydayIndex) && (
              <line
                x1={geometry.xOf(model.paydayIndex)}
                x2={geometry.xOf(model.paydayIndex)}
                y1="0"
                y2={H}
                stroke="var(--color-good)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {[...geometry.shapes].reverse().map((s) => (
              <g key={s.id}>
                {s.dashed && (
                  <path
                    d={s.dashed}
                    fill="none"
                    stroke={s.colour}
                    strokeWidth={(s.width ?? 2) * 0.9}
                    strokeDasharray="2 7"
                    strokeLinecap="round"
                    opacity={s.id === 'total' ? 0.8 : 0.55}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {s.solid && (
                  <path
                    d={s.solid}
                    fill="none"
                    stroke={s.colour}
                    strokeWidth={s.width ?? 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={s.id === 'total' ? 1 : 0.7}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            ))}

            {!hidden.has('total') &&
              model.items.map((list, i) => {
                if (!list.length || !geometry.inView(i) || totalPoints[i] == null) return null;
                const amount = list.reduce((s, it) => s + Math.abs(it.amount ?? 0), 0);
                const r = 3 + 4 * Math.min(1, amount / model.maxItem);
                return (
                  <circle
                    key={i}
                    cx={geometry.xOf(i)}
                    cy={geometry.yOf(totalPoints[i])}
                    r={r}
                    fill="var(--color-info)"
                    stroke="#08080a"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}

            {geometry.inView(model.dipIndex) && totalPoints[model.dipIndex] != null && (
              <g>
                <circle cx={geometry.xOf(model.dipIndex)} cy={geometry.yOf(totalPoints[model.dipIndex])} r="11" fill="var(--color-bad)" opacity="0.22" />
                <circle cx={geometry.xOf(model.dipIndex)} cy={geometry.yOf(totalPoints[model.dipIndex])} r="5" fill="var(--color-bad)" />
              </g>
            )}

            {readout && (
              <g>
                <line x1={readout.x} x2={readout.x} y1="0" y2={H} stroke="rgba(255,255,255,0.28)" vectorEffect="non-scaling-stroke" />
                {readout.rows.map((r) => (
                  <circle key={r.id} cx={readout.x} cy={geometry.yOf(r.value)} r="4" fill={r.colour} />
                ))}
              </g>
            )}

            {band && (
              <g>
                <rect x={band.x} y="0" width={band.w} height={H} fill="rgba(10,132,255,0.16)" />
                <line x1={band.x} x2={band.x} y1="0" y2={H} stroke="#0a84ff" vectorEffect="non-scaling-stroke" />
                <line x1={band.x + band.w} x2={band.x + band.w} y1="0" y2={H} stroke="#0a84ff" vectorEffect="non-scaling-stroke" />
              </g>
            )}
          </svg>

          {trough && !readout && !band && (
            <div
              className="num pointer-events-none absolute text-[12px] font-semibold text-bad"
              style={{
                left: `${(trough.x / W) * 100}%`,
                top: `${(trough.y / H) * 100}%`,
                transform: trough.x / W > 0.7 ? 'translate(calc(-100% - 8px), 6px)' : 'translate(8px, 6px)',
              }}
            >
              {formatCurrency(total.min?.value ?? 0)} · {fmtDate(total.min?.date)}
            </div>
          )}

          {band && (
            <div className="glass-chip pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 text-[12px] text-label">
              {band.days} days
            </div>
          )}

          {readout && readout.rows.length > 0 && (
            <div className={`${READOUT_CLASS} sm:min-w-[280px]`} style={readoutStyle(readout.x / W)}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium text-label">{fmtDate(readout.day.date)}</span>
                <span className="text-[12px] text-label-3">
                  {readout.day.observed === false ? 'projected' : 'observed'} · day {readout.day.cycleDay}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {readout.rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <span className="block h-[3px] w-3.5 shrink-0 rounded-full" style={{ background: r.colour }} />
                    <span className="min-w-0 flex-grow truncate text-label-2">{r.label}</span>
                    <span className={`num shrink-0 ${r.value < 0 ? 'text-bad' : 'text-label'}`}>{formatCurrency(r.value)}</span>
                  </div>
                ))}
              </div>
              {readout.items.length > 0 && (
                <div className="mt-2 border-t border-hair pt-2 text-[12px] text-label-2">
                  {readout.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="truncate">{it.label}</span>
                      <span className="num shrink-0">{formatCurrencyAbs(it.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between pt-1.5 text-[12px] text-label-3">
          {geometry.ticks.map((i) => (
            <span key={i}>{fmtDate(model.days[i]?.date)}</span>
          ))}
        </div>

        <div className="mt-2.5 flex items-center gap-2 text-[12px] text-label-3">
          {zoomed ? (
            <button
              type="button"
              onClick={reset}
              className="glass-chip press flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-[12px] text-label-2 hover:text-label sm:min-h-0"
            >
              <X size={12} />
              {fmtDate(model.days[from]?.date)} – {fmtDate(model.days[to]?.date)} · reset
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              <Search size={12} />
              Drag across the chart to zoom in · hover or tap for the day's charges
            </span>
          )}
        </div>
      </div>

      {cashPath.assumptions?.length > 0 && (
        <p className="t-caption mt-4 border-t pt-4">{cashPath.assumptions.join(' ')}</p>
      )}
    </Card>
  );
}
