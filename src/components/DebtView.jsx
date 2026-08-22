import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { Card } from './ui/Surface';
import { DeficitBanner } from './debt/DeficitBanner';
import { LiabilityTable } from './debt/LiabilityTable';
import { PlanControls } from './debt/PlanControls';
import { StrategyTiles } from './debt/StrategyTiles';
import { BalanceChart } from './debt/BalanceChart';
import { CommittedLine } from './debt/CommittedLine';
import { MarginalTable } from './debt/MarginalTable';
import { LumpWhatIf } from './debt/LumpWhatIf';
import { CardTiles } from './debt/CardTiles';
import { SensitivityStrip } from './debt/SensitivityStrip';
import { WhatIfPanel } from './debt/WhatIfPanel';
import { MARGINAL_AMOUNT_DEFAULT, MARGINAL_HORIZON_MONTHS } from '../constants';

// A card's inset. 28px either side of a 360px phone left 304px for eight columns of figures; 20px
// gives the content the width back while the card still reads as a surface. Unchanged from `sm` up.
const CARD = 'materialize p-5 sm:p-8';

/**
 * Debt — what is owed, at what rate, and what each rand of extra is worth.
 *
 * Every other view takes its numbers from App. This one owns a little interactive state (which
 * strategy, how much extra, a lump, a rate shift) because the questions it answers are
 * counterfactuals — "what if I sent R1 000 here instead" — and a slider that round-trips through
 * App to re-run the whole pipeline feels broken. The plan engine is handed in as `engine`
 * (comparePlans / marginalValue / lumpWhatIf / rateSensitivity / cascadeTimeline) rather than
 * imported, so the view renders App's pre-computed `plans` / `marginal` / `sensitivity` on first
 * paint and only recomputes locally once the engine is wired; with no engine the controls still
 * persist through settings and App's next pass picks them up.
 *
 * The extra slider is the one place the deficit is honest about itself: its floor IS the deficit.
 * Nothing reaches a debt until the bleed is stopped, so the first R{deficit} of anything found is
 * spoken for, and the plan only changes once the slider is above that line.
 */

const STRATEGIES = [
  { id: 'minimum', label: 'Minimum', blurb: 'Only the contractual payments' },
  { id: 'avalanche', label: 'Avalanche', blurb: 'Highest rate first' },
  { id: 'snowball', label: 'Snowball', blurb: 'Smallest balance first' },
  { id: 'lifetime', label: 'Lifetime', blurb: 'Highest fee-adjusted rate first' },
  { id: 'shortTerm', label: 'Short-term', blurb: 'Most interest avoided this year first' },
  { id: 'custom', label: 'Custom', blurb: 'Your own order' },
];
const STRATEGY_IDS = STRATEGIES.map((s) => s.id);

const EXTRA_MAX = 20000;
const EXTRA_STEP = 500;
const EMPTY = [];

function readSetting(settings, key, fallback) {
  const value = settings?.get?.(key, fallback);
  return value == null ? fallback : value;
}

const isCard = (t) => t?.type === 'Credit Card' || t?.kind === 'card';

export function DebtView({
  terms,
  debts,
  debtBudget,
  plans,
  marginal,
  sensitivity,
  rateSteps,
  accounts,
  settings,
  onPatchAccount,
  onOpenPlan,
  onOpenAccounts,
  asOf,
  engine = null,
  planOptions = null,
  incomePerCycle = null,
}) {
  const termList = terms ?? EMPTY;
  const debtList = debts ?? EMPTY;

  // ---- persisted controls -------------------------------------------------------------------
  const storedStrategy = readSetting(settings, 'debtStrategy', plans?.best?.byInterest ?? 'avalanche');
  const strategy = STRATEGY_IDS.includes(storedStrategy) ? storedStrategy : 'avalanche';

  const deficit = Math.max(0, debtBudget?.deficitPerCycle ?? 0);
  const available = Math.max(0, debtBudget?.extraSchedule?.[0] ?? debtBudget?.adjusted ?? 0);
  const floor = deficit > 0 ? deficit : available;
  const max = Math.max(EXTRA_MAX, Math.ceil((floor + 10000) / EXTRA_STEP) * EXTRA_STEP);
  const storedExtra = Number(readSetting(settings, 'debtExtra', floor));
  const extra = Math.min(max, Math.max(floor, Number.isFinite(storedExtra) ? storedExtra : floor));
  const lump = Math.max(0, Number(readSetting(settings, 'debtLump', 0)) || 0);
  const primeRate = readSetting(settings, 'primeRate', null);
  const cascade = strategy !== 'minimum' && readSetting(settings, 'debtCascade', true) !== false;

  // ---- local-only controls -------------------------------------------------------------------
  const [customOrder, setCustomOrder] = useState(null);
  const [lumpMonth, setLumpMonth] = useState(1);
  const [bpShift, setBpShift] = useState(0);
  const [recast, setRecast] = useState(false);

  const setSetting = (key, value) => settings?.set?.(key, value);

  // ---- lookups -------------------------------------------------------------------------------
  const labelsById = useMemo(() => {
    const out = {};
    for (const d of debtList) out[d.id] = d.label;
    for (const t of termList) out[t.accountId] = t.label;
    return out;
  }, [debtList, termList]);
  const accountsById = useMemo(
    () => Object.fromEntries((accounts ?? EMPTY).map((a) => [a.id, a])),
    [accounts],
  );

  // ---- the plan options for local recompute -------------------------------------------------
  // Above the floor the gap is closed: the deficit stops landing on the card and what is left
  // over goes to the debts. At the floor itself nothing has changed yet, which is exactly App's
  // first-paint plan, so the two never disagree on mount.
  const gapClosed = deficit > 0 && extra > deficit;
  const extraToDebts = deficit > 0 ? Math.max(0, extra - deficit) : extra;
  const inflows = useMemo(() => {
    if (gapClosed) return {};
    if (planOptions?.inflows) return planOptions.inflows;
    return debtBudget?.absorberId && deficit > 0 ? { [debtBudget.absorberId]: deficit } : {};
  }, [gapClosed, planOptions, debtBudget, deficit]);
  const order = useMemo(
    () => customOrder ?? plans?.avalanche?.order ?? debtList.map((d) => d.id),
    [customOrder, plans, debtList],
  );
  // An `order` makes the engine run the custom plan as well; only ask for it once there is one.
  const customActive = customOrder != null || strategy === 'custom';
  const runOptions = useMemo(
    () => ({
      ...(planOptions ?? {}),
      strategy,
      ...(customActive ? { order } : {}),
      extraPerMonth: extraToDebts,
      inflows,
      cascade,
      lumps: lump > 0 ? [{ month: lumpMonth, amount: lump, targetId: null }] : [],
    }),
    [planOptions, strategy, customActive, order, extraToDebts, inflows, cascade, lump, lumpMonth],
  );

  const plansShown = useMemo(
    () => (engine?.comparePlans && debtList.length ? engine.comparePlans(debtList, runOptions) : plans),
    [engine, debtList, runOptions, plans],
  );
  const plan = plansShown?.[strategy] ?? plansShown?.avalanche ?? null;

  // Under `minimum` the engine strips every lump, which would make the marginal and lump tables
  // read as zeros; the same order with no extra and no cascade is the honest baseline there.
  const marginalOptions = useMemo(
    () =>
      strategy === 'minimum'
        ? { ...runOptions, strategy: 'custom', order: plan?.order ?? order, cascade: false, extraPerMonth: 0, lumps: [] }
        : { ...runOptions, lumps: [] },
    [strategy, runOptions, plan, order],
  );
  const marginalShown = useMemo(
    () =>
      engine?.marginalValue && debtList.length
        ? engine.marginalValue(debtList, {
            ...marginalOptions,
            amount: MARGINAL_AMOUNT_DEFAULT,
            horizon: MARGINAL_HORIZON_MONTHS,
          })
        : marginal,
    [engine, debtList, marginalOptions, marginal],
  );
  const lumpResult = useMemo(
    () =>
      engine?.lumpWhatIf && debtList.length && lump > 0
        ? engine.lumpWhatIf(debtList, { ...marginalOptions, amount: lump, month: lumpMonth })
        : null,
    [engine, debtList, marginalOptions, lump, lumpMonth],
  );
  const sensitivityShown = useMemo(
    () =>
      engine?.rateSensitivity && debtList.length ? engine.rateSensitivity(debtList, runOptions) : sensitivity,
    [engine, debtList, runOptions, sensitivity],
  );
  const timeline = useMemo(
    () => (engine?.cascadeTimeline && plan ? engine.cascadeTimeline(plan) : null),
    [engine, plan],
  );

  const cardTerms = termList.filter(isCard);
  const hasPlan = Boolean(plan?.schedule?.length);

  return (
    <div className="flex flex-col gap-5">
      <DeficitBanner debtBudget={debtBudget} onOpenPlan={onOpenPlan} />

      {debtList.length > 0 && (
        <WhatIfPanel
          debts={debtList}
          base={runOptions}
          deficit={deficit}
          incomePerCycle={incomePerCycle}
          instalmentsPerCycle={debtList.reduce((sum, d) => sum + (d.instalment ?? 0), 0)}
          onOpenPlan={onOpenPlan}
        />
      )}

      <LiabilityTable
        terms={termList}
        plan={plan}
        primeRate={primeRate}
        accountsById={accountsById}
        rateSteps={rateSteps}
        onPatchAccount={onPatchAccount}
        onOpenAccounts={onOpenAccounts}
        asOf={asOf}
      />

      {!debtList.length || !plansShown ? (
        <Card className={`${CARD} flex flex-wrap items-center gap-4`}>
          <Landmark size={22} className="shrink-0 text-label-3" />
          <div className="min-w-0 flex-grow">
            <h2 className="t-head">No debt has a balance yet</h2>
            <p className="mt-1.5 max-w-prose text-[14.5px] text-label-2">
              Upload your account summary under Accounts, or type a balance and a rate. The plans,
              the balance chart and the what-ifs appear as soon as one debt has both.
            </p>
          </div>
          {onOpenAccounts && (
            <button
              type="button"
              onClick={onOpenAccounts}
              className="press glass-chip px-4 py-2 text-[13px] font-medium text-info hover:brightness-125 max-md:min-h-11"
            >
              Open Accounts
            </button>
          )}
        </Card>
      ) : (
        <>
          <Card className={CARD}>
            <PlanControls
              strategies={STRATEGIES}
              strategy={strategy}
              onStrategy={(id) => setSetting('debtStrategy', id)}
              extra={extra}
              floor={floor}
              available={available}
              deficit={deficit}
              max={max}
              step={EXTRA_STEP}
              onExtra={(v) => setSetting('debtExtra', v)}
              cascade={cascade}
              onCascade={(v) => setSetting('debtCascade', v)}
              lump={lump}
              onLump={(v) => setSetting('debtLump', v)}
              primeRate={primeRate}
              onPrimeRate={(v) => setSetting('primeRate', v)}
              onOpenPlan={onOpenPlan}
              order={order}
              onOrder={setCustomOrder}
              labelsById={labelsById}
              debts={debtList}
            />
            <StrategyTiles
              strategies={STRATEGIES}
              table={plansShown?.table ?? EMPTY}
              best={plansShown?.best}
              selected={strategy}
              onSelect={(id) => setSetting('debtStrategy', id)}
              plan={plan}
              plans={plansShown}
              extra={extraToDebts}
              labelsById={labelsById}
            />
          </Card>

          {hasPlan && (
            <Card className={CARD}>
              <BalanceChart plan={plan} debts={debtList} labelsById={labelsById} />
            </Card>
          )}

          {hasPlan && (
            <Card className={CARD}>
              <CommittedLine
                plan={plan}
                timeline={timeline}
                debts={debtList}
                labelsById={labelsById}
                cascade={cascade}
                strategy={strategy}
              />
            </Card>
          )}

          <Card className="materialize overflow-hidden">
            <MarginalTable
              rows={marginalShown ?? EMPTY}
              plan={plan}
              labelsById={labelsById}
              amount={MARGINAL_AMOUNT_DEFAULT}
            />
          </Card>

          <Card className={CARD}>
            <LumpWhatIf
              result={lumpResult}
              marginal={marginalShown ?? EMPTY}
              amount={lump}
              onAmount={(v) => setSetting('debtLump', v)}
              month={lumpMonth}
              onMonth={setLumpMonth}
              schedule={plan?.schedule ?? EMPTY}
              labelsById={labelsById}
              approximate={!engine?.lumpWhatIf}
            />
          </Card>

          {cardTerms.length > 0 && (
            <CardTiles
              terms={cardTerms}
              plan={plan}
              accountsById={accountsById}
              onOpenAccounts={onOpenAccounts}
            />
          )}

          <Card className={CARD}>
            <SensitivityStrip
              rows={sensitivityShown ?? EMPTY}
              debts={debtList}
              terms={termList}
              bp={bpShift}
              onBp={setBpShift}
              recast={recast}
              onRecast={setRecast}
              labelsById={labelsById}
            />
          </Card>
        </>
      )}
    </div>
  );
}
