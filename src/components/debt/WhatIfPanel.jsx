import { useMemo, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { SCENARIO_HORIZONS, compareScenarios, kindWord, payoffScenario } from '../../lib/scenario';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * "What if I pay off the car in the next three months?"
 *
 * The rest of the view reasons in rands of extra; people reason in decisions. So this card takes
 * the decision — which debt, how soon — and answers in the order the consequences arrive: what it
 * costs a cycle, what it frees and from when, what the freed instalment does to the next debt,
 * where everything ends up, and what it does to the share of income going to debt. A small table
 * under it runs the same horizon on every debt so the "greatest short-term effect" is a ranking
 * you can read, not a claim.
 */

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const fmtDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-ZA', MONTH_YEAR) : '—');
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press rounded-full border px-3.5 py-2 text-[13px] max-md:min-h-11 ${
        active ? 'border-transparent bg-fill-2 font-semibold text-label' : 'border-hair text-label-2 hover:text-label'
      }`}
    >
      {children}
    </button>
  );
}

function Line({ children }) {
  return (
    <li className="flex gap-3 text-[15px] leading-relaxed text-label-2">
      <ArrowRight size={15} className="mt-1.5 shrink-0 text-label-4" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

const B = ({ children, tone = 'text-label' }) => <b className={`font-semibold ${tone}`}>{children}</b>;

export function WhatIfPanel({ debts, base, deficit = 0, incomePerCycle = null, instalmentsPerCycle = null, onOpenPlan }) {
  const list = useMemo(() => debts ?? [], [debts]);
  const [targetId, setTargetId] = useState(null);
  const [months, setMonths] = useState(3);
  const [keepPaying, setKeepPaying] = useState(false);

  const ranked = useMemo(
    () => (list.length && base ? compareScenarios(list, { months, base, keepPaying, deficit, incomePerCycle, instalmentsPerCycle }) : []),
    [list, base, months, keepPaying, deficit, incomePerCycle, instalmentsPerCycle],
  );
  const chosenId = targetId && list.some((d) => d.id === targetId) ? targetId : (ranked[0]?.targetId ?? list[0]?.id ?? null);
  const s = useMemo(
    () =>
      chosenId && base
        ? ranked.find((r) => r.targetId === chosenId) ??
          payoffScenario(list, { targetId: chosenId, months, base, keepPaying, deficit, incomePerCycle, instalmentsPerCycle })
        : null,
    [ranked, chosenId, list, months, base, keepPaying, deficit, incomePerCycle, instalmentsPerCycle],
  );

  if (!list.length || !s) return null;

  const nextSooner = s.next && (s.next.monthsSooner ?? 0) > 0 ? s.next : null;

  return (
    <Card className="materialize p-5 sm:p-7">
      <CardHead
        title="What if I pay off…"
        subtitle="Pick a debt and how soon. Everything below is the plan on screen with that one decision added."
        right={
          <span className="glass-chip flex items-center gap-2 px-3 py-1.5 text-[12px] text-label-2">
            <Sparkles size={13} className="text-good" /> same engine as the plan
          </span>
        }
      />

      <div className="mt-5 flex flex-wrap gap-2">
        {list.map((d) => (
          <Chip key={d.id} active={d.id === chosenId} onClick={() => setTargetId(d.id)}>
            {d.label} <span className="text-label-3">· {kindWord(d)}</span>
          </Chip>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="t-label mr-1">in the next</span>
        {SCENARIO_HORIZONS.map((m) => (
          <Chip key={m} active={m === months} onClick={() => setMonths(m)}>
            {plural(m, 'cycle')}
          </Chip>
        ))}
        <span className="t-label mx-1">then</span>
        <Chip active={!keepPaying} onClick={() => setKeepPaying(false)}>stop the extra</Chip>
        <Chip active={keepPaying} onClick={() => setKeepPaying(true)}>keep paying the same</Chip>
      </div>

      <p className="t-title mt-6">
        {s.alreadyOnTrack ? (
          <>The {s.label} ({kindWord(list.find((d) => d.id === s.targetId))}) clears by <span className="text-good">{fmtDate(s.scenario.clearedDate)}</span> on its own.</>
        ) : (
          <>The {kindWord(list.find((d) => d.id === s.targetId))} — {s.label} — gone by <span className="text-good">{fmtDate(s.scenario.clearedDate)}</span>.</>
        )}
      </p>

      <ul className="mt-4 flex flex-col gap-2.5">
        {!s.alreadyOnTrack && (
          <Line>
            It takes <B>{formatCurrencyAbs(s.extraNeeded)} a cycle</B> on top of the {formatCurrencyAbs(s.instalment)} instalment — <B>{formatCurrencyAbs(s.totalExtra)}</B> over {plural(s.months, 'cycle')}.
            {deficit > 0 && (
              <> You are {formatCurrencyAbs(deficit)} a cycle short today, so in real terms that is <B tone="text-warn">{formatCurrencyAbs(deficit + s.extraNeeded)}</B> a cycle to find.</>
            )}
          </Line>
        )}
        <Line>
          From <B>{fmtDate(s.freed.fromDate)}</B> the <B tone="text-good">{formatCurrencyAbs(s.freed.perCycle)}</B> instalment is yours: <B tone="text-good">{formatCurrencyAbs(s.freed.within12)}</B> freed within a year, {formatCurrencyAbs(s.freed.within24)} within two.
        </Line>
        {s.interestSavedOnTarget > 1 && (
          <Line>
            <B>{formatCurrencyAbs(s.interestSavedOnTarget)}</B> less interest on the {s.label} itself.
          </Line>
        )}
        {nextSooner && (
          <Line>
            Rolled onto the <B>{nextSooner.label}</B>, it clears <B tone="text-good">{plural(nextSooner.monthsSooner, 'cycle')} sooner</B> — {fmtDate(nextSooner.scenarioDate)} instead of {fmtDate(nextSooner.baseDate)}.
          </Line>
        )}
        {s.everything.scenarioDate && (
          <Line>
            Everything is gone by <B tone="text-good">{fmtDate(s.everything.scenarioDate)}</B>
            {s.everything.monthsSooner > 0 ? (
              <> instead of {fmtDate(s.everything.baseDate)} — {plural(s.everything.monthsSooner, 'cycle')} sooner, <B tone="text-good">{formatCurrencyAbs(s.everything.interestSaved)}</B> less interest overall.</>
            ) : (
              <>, as before; the gain is the cash freed, not the end date.</>
            )}
          </Line>
        )}
        {s.debtService && (
          <Line>
            Debt service drops from <B>{pct(s.debtService.before)}</B> to <B tone="text-good">{pct(s.debtService.after)}</B> of income once it is gone.
          </Line>
        )}
      </ul>

      {ranked.length > 1 && (
        <div className="mt-6 border-t pt-5">
          <p className="t-label">The same {plural(months, 'cycle')} on each debt — cheapest first</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase">
                  <th className="sticky-col py-2 pr-3">Debt</th>
                  <th className="py-2 pr-3 text-right">Extra a cycle</th>
                  <th className="py-2 pr-3 text-right">Freed a cycle</th>
                  <th className="py-2 pr-3">From</th>
                  <th className="py-2 pr-3">Everything by</th>
                  <th className="py-2 text-right">Interest saved</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => (
                  <tr
                    key={r.targetId}
                    className={`border-t ${r.targetId === chosenId ? 'bg-fill' : ''}`}
                    onClick={() => setTargetId(r.targetId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTargetId(r.targetId)}
                  >
                    <td className="sticky-col py-2.5 pr-3 font-medium">{r.label}</td>
                    <td className="num py-2.5 pr-3 text-right">{r.alreadyOnTrack ? 'on track' : formatCurrencyAbs(r.extraNeeded)}</td>
                    <td className="num py-2.5 pr-3 text-right text-good">{formatCurrencyAbs(r.freed.perCycle)}</td>
                    <td className="py-2.5 pr-3 text-label-2">{fmtDate(r.freed.fromDate)}</td>
                    <td className="py-2.5 pr-3 text-label-2">
                      {fmtDate(r.everything.scenarioDate)}
                      {r.everything.monthsSooner > 0 && <span className="text-good"> · {r.everything.monthsSooner} sooner</span>}
                    </td>
                    <td className="num py-2.5 text-right">{formatCurrencyAbs(r.everything.interestSaved)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {s.assumptions?.length > 0 && (
        <ul className="t-caption mt-4 flex flex-col gap-0.5">
          {s.assumptions.slice(0, 4).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {onOpenPlan && deficit > 0 && (
        <button type="button" onClick={onOpenPlan} className="press mt-4 flex items-center gap-1.5 text-[13px] font-medium text-info hover:brightness-125 max-md:min-h-11">
          Where the money could come from <ArrowRight size={13} />
        </button>
      )}
    </Card>
  );
}
