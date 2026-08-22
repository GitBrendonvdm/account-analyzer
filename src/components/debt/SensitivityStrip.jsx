import { AlertTriangle } from 'lucide-react';
import { CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import { NEVER_CLEARS_WARN_BP, RATE_SENSITIVITY_SHIFTS_BP } from '../../constants';

/**
 * What a rate move does to the plan.
 *
 * The shift applies to the VARIABLE debts only, relative to the rate actually observed — not to
 * prime, which the app never sees. Two readings per shift: the instalment held (the term moves,
 * and past some point it never clears) and the loan recast (the instalment moves, the term holds),
 * because banks do the second and people fear the first. The warning fires when a move within
 * 75bp makes any instalment stop covering its interest, and says what the bank would have to raise
 * it to. The footer is the one number worth remembering: what a quarter-point costs a year.
 */

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const fmtMonthYear = (d) => {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-ZA', MONTH_YEAR) : 'not within 50 years';
};
const signed = (v, fmt = (x) => String(x)) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : fmt(0));
const bpLabel = (bp) => (bp === 0 ? 'today' : `${bp > 0 ? '+' : '−'}${Math.abs(bp) / 100}%`);

export function SensitivityStrip({ rows = [], debts = [], terms = [], bp = 0, onBp, recast = false, onRecast, labelsById = {} }) {
  const shifts = [...new Set([...RATE_SENSITIVITY_SHIFTS_BP, ...rows.map((r) => r.bp)])].sort((a, b) => a - b);
  const find = (b, r) => rows.find((x) => x.bp === b && Boolean(x.recast) === r) ?? null;
  const base = find(0, false) ?? find(0, true);
  const row = find(bp, recast);
  const variable = debts.filter((d) => d.rateVariable);
  const variableBalance = variable.reduce((s, d) => s + (Number.isFinite(d.balance) ? d.balance : 0), 0);
  const name = (id) => labelsById[id] ?? id;
  const instalmentOf = (id) => {
    const d = debts.find((x) => x.id === id);
    const t = terms.find((x) => x.accountId === id);
    return d?.instalment ?? t?.instalment ?? null;
  };

  const warning = rows
    .filter((r) => !r.recast && r.bp > 0 && r.bp <= NEVER_CLEARS_WARN_BP && r.neverClears?.length)
    .sort((a, b) => a.bp - b.bp)[0];
  const warnedId = warning?.neverClears?.[0];
  const recastRow = warning ? find(warning.bp, true) : null;
  const newInstalment =
    warnedId != null && instalmentOf(warnedId) != null
      ? instalmentOf(warnedId) + (recastRow?.instalmentDelta?.[warnedId] ?? 0)
      : null;

  // "vs today" means nothing when the selection IS today.
  const compare = row && base && row !== base && (bp !== 0 || recast);
  const monthsDelta = compare && Number.isFinite(row.months) && Number.isFinite(base.months) ? row.months - base.months : null;
  const interestDelta = compare ? (row.totalInterest ?? 0) - (base.totalInterest ?? 0) : null;
  const year1Delta = compare && Number.isFinite(row.year1Interest) && Number.isFinite(base.year1Interest) ? row.year1Interest - base.year1Interest : null;

  return (
    <div>
      <CardHead
        title="If rates move"
        subtitle={
          variable.length
            ? `Applied to your ${variable.length} variable-rate debt${variable.length === 1 ? '' : 's'}, relative to the rate observed.`
            : 'None of your debts is on a variable rate, so a move changes nothing here.'
        }
        right={
          <div className="flex flex-wrap items-center gap-3">
            <div className="glass-chip flex flex-wrap gap-1 p-1" role="group" aria-label="Rate shift">
              {shifts.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => onBp?.(b)}
                  aria-pressed={bp === b}
                  className={`press rounded-full px-3 py-1.5 text-[12.5px] ${bp === b ? 'bg-fill-2 font-semibold' : 'text-label-2 hover:text-label'}`}
                >
                  {bpLabel(b)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onRecast?.(!recast)}
              aria-pressed={recast}
              className={`press glass-chip px-3.5 py-1.5 text-[12.5px] ${recast ? 'text-label' : 'text-label-2'}`}
            >
              {recast ? 'Instalment recast, term holds' : 'Instalment held, term moves'}
            </button>
          </div>
        }
      />

      {row ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <div className="t-label">Debt-free</div>
            <div className="num mt-1 text-[17px] font-semibold text-label">{fmtMonthYear(row.debtFreeDate)}</div>
            {monthsDelta != null && (
              <div className={`t-caption ${monthsDelta > 0 ? 'text-bad' : monthsDelta < 0 ? 'text-good' : ''}`}>
                {signed(monthsDelta)} months vs today
              </div>
            )}
          </div>
          <div>
            <div className="t-label">Total interest</div>
            <div className="num mt-1 text-[17px] font-semibold text-label">{formatCurrencyAbs(row.totalInterest)}</div>
            {interestDelta != null && (
              <div className={`t-caption ${interestDelta > 0 ? 'text-bad' : interestDelta < 0 ? 'text-good' : ''}`}>
                {signed(interestDelta, formatCurrencyAbs)} vs today
              </div>
            )}
          </div>
          <div>
            <div className="t-label">First year</div>
            <div className="num mt-1 text-[17px] font-semibold text-label">
              {Number.isFinite(row.year1Interest) ? formatCurrencyAbs(row.year1Interest) : '—'}
            </div>
            {year1Delta != null && (
              <div className={`t-caption ${year1Delta > 0 ? 'text-bad' : year1Delta < 0 ? 'text-good' : ''}`}>
                {signed(year1Delta, formatCurrencyAbs)} vs today
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="t-caption mt-6">No sensitivity run for this shift yet.</p>
      )}

      {row && variable.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-[13.5px] text-label-2">
          {variable.map((d) => {
            const delta = row.instalmentDelta?.[d.id];
            const never = row.neverClears?.includes(d.id);
            return (
              <li key={d.id} className="flex items-center gap-2">
                <span className="text-label">{name(d.id)}</span>
                {never ? (
                  <span className="text-bad">never clears at this instalment</span>
                ) : Number.isFinite(delta) && delta !== 0 ? (
                  <span className="num">instalment {signed(delta, formatCurrencyAbs)}</span>
                ) : (
                  <span className="t-caption">instalment unchanged</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {warning && (
        <p className="mt-5 flex items-start gap-2 text-[14px] text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            A {warning.bp / 100}% rise would mean the {name(warnedId)}'s instalment no longer covers the interest
            {newInstalment != null ? ` — the bank would have to raise it to ${formatCurrencyAbs(newInstalment)}.` : '.'}
          </span>
        </p>
      )}

      {variable.length > 0 && (
        <p className="t-caption mt-5 border-t pt-4">
          Each 0.25% on your variable-rate debt is about {formatCurrencyAbs(variableBalance * 0.0025)} a year.
        </p>
      )}
    </div>
  );
}
