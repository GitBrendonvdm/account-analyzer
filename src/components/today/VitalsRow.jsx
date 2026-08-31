import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Figure, Tile } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import {
  BURDEN_AMBER,
  BURDEN_RED,
  DSR_AMBER,
  DSR_RED,
  RUNWAY_AMBER,
  RUNWAY_GREEN,
  SAVINGS_RATE_AMBER,
  SAVINGS_RATE_GREEN,
  UTIL_AMBER,
  UTIL_RED,
} from '../../constants';

/**
 * Six numbers that say whether the household is solvent, and which way each is going.
 *
 * Safe-to-spend answers this cycle; these answer the year. Each tile is one pooled ratio over the
 * last three cycles — savings rate, debt service, interest burden, cash runway, card utilisation,
 * the deficit — graded green / amber / red against the thresholds in `constants.js`, with the last
 * twelve cycles as a bar strip so a bad number can be seen to be new or old. The headline figure
 * IS the three-cycle number; the chip under it does not repeat that value at equal weight — it is
 * muted, and carries only the direction arrow against the twelve-cycle figure, because "improving"
 * and "bad" are both true of a 45% debt-service ratio that was 52% a year ago, and only the pair
 * tells you which way to feel.
 *
 * A tile whose number cannot be computed — no balances typed, no card limits — says "Add balances"
 * and opens the Accounts view, rather than printing a zero that would read as good news. Hollow
 * bars mark cycles where the salary landed outside its cycle: those values are real but not
 * comparable, and drawing them solid would make a punctuality problem look like a spending one.
 */

const TONE_CLASS = { good: 'text-good', warn: 'text-warn', bad: 'text-bad' };
const TONE_COLOUR = { good: 'var(--color-good)', warn: 'var(--color-warn)', bad: 'var(--color-bad)' };
const DIRECTION_CLASS = { improving: 'text-good', worsening: 'text-bad', flat: 'text-label-3' };

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)}%`;
const cyclesOf = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} cycles`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Label, formatter and the fallback grading per vital; the library's own `tone` wins when present. */
const TILES = [
  {
    id: 'savingsRate',
    label: 'Savings rate',
    format: pct,
    tone: (v) => (v >= SAVINGS_RATE_GREEN ? 'good' : v >= SAVINGS_RATE_AMBER ? 'warn' : 'bad'),
    note: () => 'of income kept',
  },
  {
    id: 'debtServiceRatio',
    label: 'Debt service',
    format: pct,
    tone: (v) => (v < DSR_AMBER ? 'good' : v <= DSR_RED ? 'warn' : 'bad'),
    note: (v) => `of income to instalments and cards${v.partial ? ' · card minimums not typed' : ''}`,
  },
  {
    id: 'interestBurden',
    label: 'Interest burden',
    format: pct,
    tone: (v) => (v < BURDEN_AMBER ? 'good' : v <= BURDEN_RED ? 'warn' : 'bad'),
    note: () => 'of income to interest and fees',
  },
  {
    id: 'liquidityRunway',
    label: 'Runway',
    format: cyclesOf,
    tone: (v) => (v >= RUNWAY_GREEN ? 'good' : v >= RUNWAY_AMBER ? 'warn' : 'bad'),
    note: (v) =>
      isNumber(v.knownCount) && isNumber(v.totalCount)
        ? `of spending held in cash · ${v.knownCount} of ${plural(v.totalCount, 'account')} known`
        : 'of spending held in cash',
  },
  {
    id: 'cardUtilisation',
    label: 'Card utilisation',
    format: pct,
    tone: (v) => (v < UTIL_AMBER ? 'good' : v <= UTIL_RED ? 'warn' : 'bad'),
    note: (v) => (v.perCard?.length ? `of card limits in use · ${plural(v.perCard.length, 'card')}` : 'of card limits in use'),
  },
  {
    id: 'deficitPerCycle',
    label: 'Deficit',
    format: (v) => formatCurrencyAbs(v),
    // The library grades amber by share of income; without that figure any shortfall reads red.
    tone: (v) => (v <= 0 ? 'good' : 'bad'),
    note: (v) => {
      if (!(v.value > 0)) return 'no shortfall a cycle';
      const funder = v.fundedBy?.[0]?.account;
      return funder ? `short a cycle · lands on the ${funder}` : 'short a cycle';
    },
  },
];

/** Twelve bars, the latest in the tile's tone; hollow where the salary landed outside its cycle. */
function Spark({ series, tone }) {
  const values = (series ?? []).filter((s) => s && isNumber(s.value)).slice(-12);
  if (!values.length) return null;
  const pad = 12 - values.length;
  const max = Math.max(...values.map((s) => Math.abs(s.value)), 1e-9);
  const negative = values.some((s) => s.value < 0);
  const H = 28;
  const W = 12 * 9 - 3;
  const base = negative ? H / 2 : H;
  const scale = negative ? H / 2 : H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-7 w-full" aria-hidden>
      {negative && (
        <line x1="0" x2={W} y1={base} y2={base} stroke="rgba(255,255,255,0.14)" vectorEffect="non-scaling-stroke" />
      )}
      {values.map((s, i) => {
        const h = Math.max(1.5, (Math.abs(s.value) / max) * scale);
        const y = s.value >= 0 ? base - h : base;
        const last = i === values.length - 1;
        const fill = last ? TONE_COLOUR[tone] ?? 'var(--color-label-2)' : 'rgba(255,255,255,0.14)';
        return s.incomeShifted ? (
          <rect
            key={s.month ?? i}
            x={(pad + i) * 9}
            y={y}
            width={6}
            height={h}
            fill="none"
            stroke={last ? fill : 'rgba(235,235,245,0.46)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <rect key={s.month ?? i} x={(pad + i) * 9} y={y} width={6} height={h} fill={fill} />
        );
      })}
    </svg>
  );
}

/**
 * The three-cycle figure already reads large as the tile's headline, so it does not appear here
 * again — this chip is the secondary read: which way it is moving, and what it is moving against.
 */
function DirectionChip({ vital, format }) {
  if (!isNumber(vital.short) || !isNumber(vital.long)) return null;
  const direction = vital.direction ?? 'flat';
  const Icon = direction === 'improving' ? ArrowUp : direction === 'worsening' ? ArrowDown : Minus;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[11px] text-label-3">
      <span>over 3 cycles</span>
      <Icon size={11} aria-label={direction} className={DIRECTION_CLASS[direction] ?? 'text-label-3'} />
      <span>vs</span>
      <span className="num">{format(vital.long)}</span>
      <span>over 12</span>
    </span>
  );
}

function VitalTile({ spec, vital, onOpenAccounts }) {
  const value = vital?.value;
  const missing = !isNumber(value);
  const tone = missing ? null : (vital.tone ?? spec.tone(value));
  return (
    <Tile className="rise flex flex-col gap-3 p-5">
      <Figure
        label={spec.label}
        value={missing ? '—' : spec.format(value)}
        tone={missing ? 'text-label-3' : TONE_CLASS[tone] ?? 'text-label'}
        note={missing ? 'needs a balance to compute' : spec.note(vital)}
      />
      {missing ? (
        <button
          type="button"
          onClick={onOpenAccounts}
          className="glass-chip press flex min-h-11 items-center self-start px-3 py-1.5 text-[12px] font-medium text-info hover:brightness-125 sm:min-h-0"
        >
          Add balances
        </button>
      ) : (
        <>
          <Spark series={vital.series} tone={tone} />
          <DirectionChip vital={vital} format={spec.format} />
        </>
      )}
    </Tile>
  );
}

export function VitalsRow({ vitals, onOpenAccounts, className = '' }) {
  if (!vitals?.vitals) {
    return <p className={`t-caption ${className}`}>Vitals need at least one complete pay cycle.</p>;
  }
  const assumptions =
    vitals.assumptions?.length
      ? vitals.assumptions
      : [`Income excludes one-off inflows (${formatCurrencyAbs(vitals.exceptionIncome ?? 0)} over the window).`];

  return (
    <div className={className}>
      {/* One column on the narrowest phones: at 167px a tile truncates "R 28 132" and "1.2 cycles",
          and a vital you cannot read is worse than one you scroll to. Two across from 430px. */}
      <div className="grid gap-4 min-[430px]:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-6">
        {TILES.map((spec) => (
          <VitalTile key={spec.id} spec={spec} vital={vitals.vitals[spec.id]} onOpenAccounts={onOpenAccounts} />
        ))}
      </div>
      <p className="t-caption mt-3">{assumptions.join(' · ')}</p>
    </div>
  );
}
