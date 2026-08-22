import { useState } from 'react';
import { StepChart } from '../habits/StepChart';
import { STANDING_CHARGES_SHOWN } from '../habits/SubscriptionsCard';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * Every active recurring line, as the full table.
 *
 * The Habits view shows the standing charges as rows with a verb on each; this is the same data
 * laid out for checking — day of the month, cadence, confidence, the price history, the override —
 * in the Plan view, where the question is "what is committed each cycle" rather than "what can I
 * cancel". It is deliberately a plain table with every column, because a plan is made from the
 * details and the audit card above hides half of them on purpose.
 *
 * The override menu writes the same settings.lineOverrides key the Habits chips do, so a decision
 * made here shows there and survives the next import.
 *
 * It opens on the top STANDING_CHARGES_SHOWN lines by per-cycle cost, the engine's order, with a
 * "Show all" strip under the table; the header total is over every line regardless, and a caption
 * says so while the table is folded. Every load starts folded.
 */

const DAY_MS = 86400000;
const OVERRIDES = [
  { value: '', label: "engine's call" },
  { value: 'keep', label: 'keep' },
  { value: 'cancelled', label: 'cancelled' },
  { value: 'ignore', label: 'ignore' },
];
const DEBT_KINDS = new Set(['instalment', 'repayment']);

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const relative = (v, asOf) => {
  const d = toDate(v);
  if (!d) return '—';
  const n = Math.round((midnight(d) - midnight(asOf)) / DAY_MS);
  if (n === 0) return 'today';
  return n > 0 ? `in ${n} day${n === 1 ? '' : 's'}` : `${-n} day${n === -1 ? '' : 's'} ago`;
};
const ordinal = (n) => {
  if (!Number.isFinite(n)) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const monthLabel = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }) : key ?? '';
};

export function StandingCharges({ lines, subscriptions, lineOverrides, onSetLineOverride, asOf, className = '' }) {
  const [showAll, setShowAll] = useState(false);
  const list = lines ?? subscriptions?.lines ?? null;
  if (!list) return null;
  const today = toDate(asOf) ?? new Date();
  const total = list.reduce((s, l) => s + (l.perCycle ?? 0), 0);
  const overrideOf = (line) => lineOverrides?.[line.id] ?? line.override ?? '';
  const collapsible = list.length > STANDING_CHARGES_SHOWN;
  const shown = collapsible && !showAll ? list.slice(0, STANDING_CHARGES_SHOWN) : list;

  return (
    <section className={`glass overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-6 py-5">
        <div>
          <h2 className="t-head">Standing charges</h2>
          <p className="t-label mt-1.5 max-w-prose">
            Every active recurring line — what is committed before a cycle starts. Instalments and repayments included here, because the plan has to carry them.
          </p>
        </div>
        <div className="text-right">
          <div className="num text-lg font-semibold text-label">{formatCurrencyAbs(total)}</div>
          <div className="t-label">a cycle across {list.length} line{list.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="t-caption px-6 py-4">No recurring lines yet — the engine needs a few complete cycles.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase">
                <th className="border-b px-6 py-2.5">Line</th>
                <th className="border-b px-3 py-2.5">Kind</th>
                <th className="border-b px-3 py-2.5">Cadence</th>
                <th className="border-b px-3 py-2.5">Day</th>
                <th className="border-b px-3 py-2.5 text-right">Amount</th>
                <th className="border-b px-3 py-2.5 text-right">Per year</th>
                <th className="border-b px-3 py-2.5">Next due</th>
                <th className="border-b px-3 py-2.5">Confidence</th>
                <th className="border-b px-3 py-2.5">Price</th>
                <th className="border-b px-3 py-2.5">History</th>
                <th className="border-b px-3 py-2.5">Override</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="px-6 py-2">
                    <div className="max-w-[16rem] truncate text-sm text-label">{line.label}</div>
                    <div className="t-caption truncate">{line.category ?? ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-label-2">{line.kind}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-label-2">{line.cadence}</td>
                  <td className="px-3 py-2 text-xs text-label-2">{ordinal(line.dom)}</td>
                  <td className="num px-3 py-2 text-right">{formatCurrencyAbs(line.amount)}</td>
                  <td className="num px-3 py-2 text-right text-label-2">{formatCurrencyAbs((line.perCycle ?? 0) * 12)}</td>
                  <td className="px-3 py-2 text-xs text-label-2">{relative(line.nextDate, today)}</td>
                  <td className="px-3 py-2 text-xs text-label-2">
                    {line.level}
                    {Number.isFinite(line.confidence) && <span className="text-label-4"> · {Math.round(line.confidence * 100)}%</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {line.priceChange ? (
                      <span className={`rounded px-1.5 py-0.5 ${line.priceChange.pct > 0 ? 'bg-warn/15 text-warn' : 'bg-good/15 text-good'}`}>
                        {line.priceChange.pct > 0 ? '+' : '−'}
                        {Math.round(Math.abs(line.priceChange.pct) * 100)}% since {monthLabel(line.priceChange.since)}
                      </span>
                    ) : (
                      <span className="text-label-4">steady</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StepChart regimes={line.regimes} />
                  </td>
                  <td className="px-3 py-2">
                    {DEBT_KINDS.has(line.kind) || !onSetLineOverride ? (
                      <span className="text-xs text-label-4">—</span>
                    ) : (
                      <select
                        value={overrideOf(line)}
                        onChange={(e) => onSetLineOverride(line.id, e.target.value || null)}
                        aria-label={`Override for ${line.label}`}
                        className="rounded border bg-transparent px-1.5 py-1 text-xs text-label focus:border-info/30 focus:outline-none"
                      >
                        {OVERRIDES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {collapsible && (
        <>
          {!showAll && (
            <p className="t-caption px-6 py-2.5 text-center">{`${shown.length} of ${list.length} shown · totals cover all`}</p>
          )}
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="press w-full border-t bg-fill py-2.5 text-xs text-label-2 hover:text-label"
          >
            {showAll ? 'Show fewer' : `Show all ${list.length} standing charges`}
          </button>
        </>
      )}
      {subscriptions?.assumptions?.length > 0 && <p className="t-caption border-t px-6 py-4">{subscriptions.assumptions.join(' ')}</p>}
    </section>
  );
}
