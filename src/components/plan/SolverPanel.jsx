import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Field } from '../ui/Field';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';

/**
 * "What would it take" — the plan run backwards.
 *
 * The Debt view answers "if I pay R2 000 extra, when is it gone"; people ask the other question:
 * "I want this gone by my fiftieth — what does that cost a month". The solver bisects the plan
 * engine for the smallest extra that clears the chosen debts by the chosen date, and this panel
 * puts the answer in one sentence with the honest clause on the end — the part of the extra that
 * only stops the borrowing, before a rand of it reduces anything.
 *
 * The solver is injected (`solve`) rather than imported, so App decides which engine runs and the
 * panel stays renderable with none. It runs on demand from the committed inputs, never on every
 * keystroke: Field commits on blur, and each solve is at most forty plan simulations.
 *
 * A debt that cannot be cleared by the date is named with the balance it would still carry and
 * the year it does clear on today's instalment, because "not reachable" alone invites the wrong
 * conclusion (that nothing can be done) when the right one is that the date is too soon.
 */

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const monthYear = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-ZA', MONTH_YEAR) : '—';
};
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));
const pct = (rate) => (Number.isFinite(rate) ? `${(rate * 100).toFixed(1)}%` : 'an unknown rate');
const STRATEGIES = [
  { id: 'avalanche', label: 'Highest rate first' },
  { id: 'snowball', label: 'Smallest first' },
];

/** `solve` may be the library module, a bare solveExtraForDate function, or nothing at all. */
function apiOf(solve) {
  if (!solve) return {};
  if (typeof solve === 'function') {
    return { solveExtraForDate: solve, solveDateForExtra: solve.solveDateForExtra, solveExtraForGoal: solve.solveExtraForGoal };
  }
  return solve;
}

function tryCall(fn, ...args) {
  if (typeof fn !== 'function') return null;
  try {
    return fn(...args) ?? null;
  } catch {
    return null;
  }
}

function Timeline({ solution, debts }) {
  const cycles = Math.max(1, solution.target?.cycles ?? 1);
  const rows = [
    ...(solution.clearedOrder ?? []).map((c) => ({ ...c, reachable: true })),
    ...(solution.unreachable ?? []).map((u) => ({ ...u, reachable: false })),
  ];
  if (!rows.length) return null;
  const labelOf = (r) => r.label ?? debts.find((d) => d.id === r.id)?.label ?? r.id;
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {rows.map((r) => {
        const share = r.reachable ? Math.min(1, (r.clearedCycle ?? cycles) / cycles) : 1;
        return (
          <li key={r.id} className="flex items-center gap-3 text-[13px]">
            <span className="w-44 shrink-0 truncate text-label-2">{labelOf(r)}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-fill">
              <span
                className={`block h-full rounded-full ${r.reachable ? 'bg-good' : 'bg-bad'}`}
                style={{ width: `${Math.max(3, share * 100)}%` }}
              />
            </span>
            <span className={`num w-40 shrink-0 text-right ${r.reachable ? 'text-label-2' : 'text-bad'}`}>
              {r.reachable ? `${monthYear(r.clearedDate)} · ${r.clearedCycle} cycles` : `${formatCurrencyAbs(r.balanceAtTarget)} still owed`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SolverPanel({ debts, debtBudget, solverInputs, solve, monthlySaving = 0, onOpenDebt, className = '' }) {
  const api = apiOf(solve);
  const inputs = solverInputs ?? {};
  const debtList = useMemo(() => (debts ?? inputs.debts ?? []).filter((d) => d && d.balance > 0), [debts, inputs.debts]);
  const budget = debtBudget ?? inputs.debtBudget ?? null;
  const processed = inputs.processed ?? null;
  const gapClosers = inputs.gapClosers ?? null;

  const [targetDate, setTargetDate] = useState(() => isoOf(addMonths(new Date(), 60)));
  const [scope, setScope] = useState('all');
  const [strategy, setStrategy] = useState('avalanche');
  const [goal, setGoal] = useState('');

  const options = useMemo(() => {
    const target = toDate(targetDate);
    const today = new Date();
    return {
      targetDate: target,
      fromDate: today,
      currentMonth: processed?.currentMonth ?? null,
      nextPayDate: toDate(processed?.nextPayDate) ?? null,
      strategy,
      inflows: budget?.inflows ?? {},
      breakEvenExtra: budget?.breakEvenExtra ?? budget?.deficitPerCycle ?? 0,
      scope,
      flexibleAvailable: gapClosers?.totalAvailable ?? null,
      incomePerCycle: processed?.incomeAvg ?? null,
    };
  }, [targetDate, strategy, scope, budget, processed, gapClosers]);

  const scopeKnown = scope === 'all' || debtList.some((d) => d.id === scope);
  const solution = useMemo(
    () => (debtList.length && options.targetDate && scopeKnown ? tryCall(api.solveExtraForDate, debtList, options) : null),
    [api.solveExtraForDate, debtList, options, scopeKnown],
  );
  const inverse = useMemo(
    () =>
      debtList.length && monthlySaving > 0 && scopeKnown
        ? tryCall(api.solveDateForExtra, debtList, {
            extraPerMonth: monthlySaving,
            currentMonth: options.currentMonth,
            nextPayDate: options.nextPayDate,
            strategy,
            inflows: options.inflows,
            scope,
          })
        : null,
    [api.solveDateForExtra, debtList, monthlySaving, scopeKnown, options, strategy, scope],
  );
  const goalAmount = parseFloat(String(goal).replace(/[^\d.]/g, ''));
  const goalSolution = useMemo(
    () =>
      goalAmount > 0 && options.targetDate
        ? tryCall(api.solveExtraForGoal, {
            target: goalAmount,
            saved: 0,
            targetDate: options.targetDate,
            fromDate: options.fromDate,
            surplusPerCycle: budget?.adjusted ?? processed?.netAvg ?? 0,
            breakEvenExtra: options.breakEvenExtra,
            flexibleAvailable: options.flexibleAvailable,
            incomePerCycle: options.incomePerCycle,
          })
        : null,
    [api.solveExtraForGoal, goalAmount, options, budget, processed],
  );

  const scopeLabel = scope === 'all' ? 'everything' : `the ${debtList.find((d) => d.id === scope)?.label ?? 'selected debt'}`;
  const when = monthYear(options.targetDate);

  let sentence = null;
  if (solution) {
    if (solution.infeasible || !Number.isFinite(solution.totalPerCycle)) {
      sentence = `Even every rand of the balances cannot clear ${scopeLabel} by ${when} — pick a later date.`;
    } else {
      const unreachable = (solution.unreachable ?? [])
        .map((u) => {
          const debt = debtList.find((d) => d.id === u.id);
          const baseline = (solution.baselineCleared ?? []).find((b) => b.id === u.id);
          const clears =
            baseline && Number.isFinite(baseline.clearedCycle)
              ? `it clears in ${addMonths(options.fromDate, baseline.clearedCycle).getFullYear()} on the current instalment`
              : 'it never clears on the current instalment';
          return ` The ${u.label ?? debt?.label ?? u.id} is not reachable by then (${formatCurrencyAbs(u.balanceAtTarget)} at ${pct(debt?.rateNominal)}; ${clears}).`;
        })
        .join('');
      const breakEven = solution.breakEvenExtra > 0 ? ` — ${formatCurrencyAbs(solution.breakEvenExtra)} of it just to stop borrowing` : '';
      sentence = `To clear ${scopeLabel} by ${when} you need ${formatCurrencyAbs(solution.totalPerCycle)} a cycle more than now${breakEven}.${unreachable}`;
    }
  }

  return (
    <section className={`glass overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-6 py-5">
        <div>
          <h2 className="t-head">What would it take</h2>
          <p className="t-label mt-1.5 max-w-prose">
            Pick a date and the plan runs backwards: the smallest extra a cycle that clears the debt by then, on top of today's instalments.
          </p>
        </div>
        {onOpenDebt && (
          <button type="button" onClick={onOpenDebt} className="press flex items-center gap-1.5 text-[13px] font-medium text-info hover:brightness-125">
            The full plan <ArrowRight size={13} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4 border-b px-6 py-4">
        <Field label="By" type="date" inputMode="none" value={targetDate} onCommit={(v) => toDate(v) && setTargetDate(v)} width="w-40" max={isoOf(addMonths(new Date(), 600))} />
        <label className="inline-flex flex-col gap-1.5">
          <span className="t-label">Clear</span>
          <select
            value={scopeKnown ? scope : 'all'}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Which debts to clear"
            className="rounded border bg-transparent px-2 py-1 text-sm text-label focus:border-info/30 focus:outline-none"
          >
            <option value="all">Everything</option>
            {debtList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-flex flex-col gap-1.5">
          <span className="t-label">Allocate</span>
          <div className="glass-chip flex gap-1 p-1">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={strategy === s.id}
                onClick={() => setStrategy(s.id)}
                className={`press rounded-full px-3 py-1 text-[12px] ${strategy === s.id ? 'bg-fill-2 font-semibold' : 'text-label-2 hover:text-label'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {typeof api.solveExtraForGoal === 'function' && (
          <Field label="Or save" prefix="R" value={goal} onChange={setGoal} onCommit={setGoal} placeholder="goal" width="w-28" />
        )}
      </div>

      <div className="px-6 py-5">
        {!debtList.length ? (
          <p className="text-sm text-label-2">
            Nothing to solve yet — type a balance and a rate under Debt, or upload an account summary, and this asks what it would take.
          </p>
        ) : typeof api.solveExtraForDate !== 'function' ? (
          <p className="text-sm text-label-2">The solver is not available in this build.</p>
        ) : !solution ? (
          <p className="text-sm text-label-2">Pick a date in the future to run the plan backwards.</p>
        ) : (
          <>
            <p className="t-sub">{sentence}</p>
            {Number.isFinite(solution.asShareOfIncome) && (
              <p className="t-caption mt-1">{Math.round(solution.asShareOfIncome * 100)}% of income a cycle · {formatCurrencyAbs(solution.interestSaved ?? 0)} less interest than the current instalments</p>
            )}
            {solution.shortfall > 0 && Number.isFinite(solution.flexibleAvailable) && (
              <p className="mt-2 text-[13.5px] font-medium text-bad">
                Your flexible categories can give at most {formatCurrencyAbs(solution.flexibleAvailable)} — {formatCurrencyAbs(solution.shortfall)} a cycle short.
              </p>
            )}
            <Timeline solution={solution} debts={debtList} />
          </>
        )}

        {inverse && (
          <p className="mt-4 border-t pt-4 text-[14px] text-label-2">
            {inverse.clearedDate
              ? `With ${formatCurrencyAbs(monthlySaving)} more a cycle, ${scopeLabel} clears by ${monthYear(inverse.clearedDate)}.`
              : `With ${formatCurrencyAbs(monthlySaving)} more a cycle, ${scopeLabel} does not clear within the plan's horizon.`}
          </p>
        )}

        {goalSolution && (
          <p className="mt-3 text-[14px] text-label-2">
            {goalSolution.infeasible || !Number.isFinite(goalSolution.totalPerCycle)
              ? `${formatCurrency(goalAmount)} cannot be saved by ${when} — pick a later date.`
              : `To save ${formatCurrency(goalAmount)} by ${when} you need ${formatCurrencyAbs(goalSolution.totalPerCycle)} a cycle more than now.`}
          </p>
        )}

        {solution?.assumptions?.length > 0 && <p className="t-caption mt-4">{solution.assumptions.join(' · ')}</p>}
      </div>
    </section>
  );
}
