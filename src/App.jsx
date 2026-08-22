import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Aurora } from './components/Aurora';
import { TopBar } from './components/TopBar';
import { TodayView } from './components/TodayView';
import { Headlines } from './components/Headlines';
import { buildCycleCurve } from './lib/cycleCurveSeries';
import { buildBalanceBands } from './lib/balanceSeries';
import { ImportSummary } from './components/ImportSummary';
import { deriveCycleSummary } from './lib/cycleSummary';
import {
  buildAccountMovementSeries,
  buildAccountPositions,
  buildAccountSummaries,
} from './lib/accountSeries';
import { applyBalances, cardHeadroom, summariseNetWorth } from './lib/netWorth';
import { buildCostOfDebt } from './lib/costOfDebt';
import { buildHabits } from './lib/habits';
import { buildHeadlines } from './lib/headlines';
import { deriveSafeToSpend } from './lib/safeToSpend';
import { buildBudgetProgress } from './lib/budgets';
import { buildGapClosers, buildTrajectory } from './lib/trajectory';
import { summariseGoals } from './lib/goals';
import { EmptyState } from './components/EmptyState';
import { Login } from './components/Login';
import { MigrateBanner } from './components/MigrateBanner';
import { buildCycleCalendar } from './lib/cycleCurve';
import { buildFullTransfers } from './lib/flows';
import { buildLiabilityTerms, rateSteps as buildRateSteps, toDebt } from './lib/inferRates';
import {
  buildDebtBudget,
  cascadeTimeline,
  comparePlans,
  lumpWhatIf,
  marginalValue,
  rateSensitivity,
} from './lib/debtPlan';
import { useSettings } from './hooks/useSettings';
import { useToday } from './hooks/useToday';
import { processTransactionData } from './lib/processTransactionData';
import { buildRecurringLines } from './lib/recurring';
import { buildIncomeProfile } from './lib/incomeProfile';
import { buildUpcoming } from './lib/upcoming';
import { buildDirection, buildVitals } from './lib/vitals';
import { buildCashToPayday } from './lib/cashToPayday';
import { buildSubscriptions } from './lib/subscriptions';
import { buildPriceCreep } from './lib/priceCreep';
import { buildDrift } from './lib/drift';
import { buildBasket } from './lib/basket';
import { buildFeesAudit } from './lib/fees';
import { buildSavingsFinder } from './lib/savingsFinder';
import { solveExtraForDate, solveExtraForGoal } from './lib/solver';
// Everything that is not the opening screen loads on first use. Today is a hand-drawn page; the
// other views carry Recharts, the debt engine's UI and the PDF reader, which together doubled the
// first paint for a screen that needed none of them.
const LedgerView = lazy(() => import('./components/LedgerView').then((m) => ({ default: m.LedgerView })));
const ChartsView = lazy(() => import('./components/ChartsView').then((m) => ({ default: m.ChartsView })));
const HabitsView = lazy(() => import('./components/HabitsView').then((m) => ({ default: m.HabitsView })));
const PlanView = lazy(() => import('./components/PlanView').then((m) => ({ default: m.PlanView })));
const DebtView = lazy(() => import('./components/DebtView').then((m) => ({ default: m.DebtView })));
const AccountsView = lazy(() => import('./components/AccountsView').then((m) => ({ default: m.AccountsView })));
const StatementUpload = lazy(() =>
  import('./components/StatementUpload').then((m) => ({ default: m.StatementUpload })),
);

import { useAnalyzerState } from './hooks/useAnalyzerState';
import { useChartData } from './hooks/useChartData';
import { useTransactionData } from './hooks/useTransactionData';
import { usePlanState } from './hooks/usePlanState';

export default function App() {
  const [activeTab, setActiveTab] = useState('today');
  // The last account-summary upload, shown as one line until dismissed — the import banner's
  // shape is about rows, and this one is about balances.
  const [statementDone, setStatementDone] = useState(null);
  const today = useToday();
  const {
    ready,
    data,
    accounts,
    createAccount,
    deleteAccount,
    selectedIds,
    selectedAccounts,
    monthRange,
    setMonthRange,
    availableMonthCount,
    toggleAccount,
    handleFileUpload,
    updateAccount,
    lastImport,
    dismissLastImport,
    importing,
    importError,
    dismissImportError,
    auth,
    signIn,
    signOut,
    localDump,
    migrateLocal,
    migrating,
    dismissLocalDump,
    exportUrl,
  } = useAnalyzerState();

  const processed = useTransactionData(data, selectedAccounts, monthRange);
  const chartData = useChartData(data, selectedAccounts, processed);
  const summary = useMemo(() => deriveCycleSummary(processed), [processed]);

  const accountSeries = useMemo(
    () =>
      processed
        ? buildAccountMovementSeries(data, selectedAccounts, {
            // Honour the month slider: start at the beginning of the earliest visible pay cycle.
            from: processed.cycleStarts[processed.months[0]],
          })
        : null,
    [data, selectedAccounts, processed],
  );
  const accountPositions = useMemo(
    () => (processed ? buildAccountPositions(data, selectedAccounts, processed.months) : []),
    [data, selectedAccounts, processed],
  );
  const accountSummaries = useMemo(
    () =>
      processed
        ? buildAccountSummaries(data, selectedAccounts, processed.months, processed.currentMonth)
        : [],
    [data, selectedAccounts, processed],
  );

  // ---- balances turn positions into money -------------------------------------------------
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  // `data` lets a typed or uploaded balance anchor on its as-of date rather than the latest cycle,
  // and brings external (transaction-less) accounts into the picture.
  const balanced = useMemo(
    () => (processed ? applyBalances(accountPositions, accountsById, processed.months, { data }) : []),
    [accountPositions, accountsById, processed, data],
  );
  const netWorth = useMemo(
    () => (processed ? summariseNetWorth(balanced, processed.months) : null),
    [balanced, processed],
  );
  const headroom = useMemo(() => cardHeadroom(balanced), [balanced]);

  // Over EVERY account: loans are switched off by default, and a cost-of-debt figure that
  // silently drops the bond's R21k a cycle is the single most misleading number the app can show.
  const allNamesForCost = useMemo(() => accounts.flatMap((a) => a.seenNames ?? [a.rawName]), [accounts]);
  const costOfDebt = useMemo(
    () => (processed ? buildCostOfDebt(data, allNamesForCost, processed.months) : null),
    [data, allNamesForCost, processed],
  );
  const habits = useMemo(
    () => (processed ? buildHabits(data, selectedAccounts, processed) : null),
    [data, selectedAccounts, processed],
  );

  const curve = useMemo(
    () => (processed ? buildCycleCurve(data, selectedAccounts, processed, { cycles: 3 }) : null),
    [data, selectedAccounts, processed],
  );

  const balances = useMemo(
    () => (processed ? buildBalanceBands(data, selectedAccounts, accounts, processed, { cycles: 3 }) : null),
    [data, selectedAccounts, accounts, processed],
  );


  // ---- plan: targets, goals, scenario ------------------------------------------------------
  const { targets, setTarget, goals, addGoal, removeGoal, monthlySaving, setMonthlySaving } =
    usePlanState();
  const settings = useSettings();

  // ---- debt: terms off the ledgers, one engine, the plans ----------------------------------
  // These ignore the account chips on purpose: a loan you have switched off is still a loan.
  // Keyed on `data`/`accounts` only, so toggling a chip never recomputes them.
  const allMonths = useMemo(
    () => (data ? [...new Set(data.map((t) => t['Pay Month']))].sort() : []),
    [data],
  );
  const calendar = useMemo(
    () => (data ? buildCycleCalendar(data, allMonths, today) : null),
    [data, allMonths, today],
  );
  const transfers = useMemo(() => (data ? buildFullTransfers(data, { accounts }) : null), [data, accounts]);
  const primeRate = settings.get('primeRate', null);
  const terms = useMemo(
    () => (data && transfers ? buildLiabilityTerms(data, accounts, { asOf: today, primeRate, transfers }) : []),
    [data, accounts, today, primeRate, transfers],
  );
  const debts = useMemo(() => terms.map(toDebt).filter(Boolean), [terms]);
  const rateStepList = useMemo(() => terms.flatMap((t) => buildRateSteps(t)), [terms]);
  const debtBudget = useMemo(
    () => (processed ? buildDebtBudget(processed, { monthlySaving, cuts: 0, debts, balanced }) : null),
    [processed, monthlySaving, debts, balanced],
  );
  const planOptions = useMemo(
    () =>
      processed
        ? { currentMonth: processed.currentMonth, nextPayDate: processed.nextPayDate ?? null, inflows: debtBudget?.inflows ?? {} }
        : null,
    [processed, debtBudget],
  );
  const plans = useMemo(
    () =>
      debts.length && planOptions
        ? comparePlans(debts, { ...planOptions, extraPerMonth: debtBudget?.extraSchedule ?? 0, strategy: settings.get('debtStrategy', 'avalanche') })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settings.get reads a plain value
    [debts, planOptions, debtBudget, settings.settings],
  );
  const marginal = useMemo(
    () => (debts.length && planOptions ? marginalValue(debts, { ...planOptions, extraPerMonth: debtBudget?.extraSchedule ?? 0 }) : null),
    [debts, planOptions, debtBudget],
  );
  const sensitivity = useMemo(
    () => (debts.length && planOptions ? rateSensitivity(debts, { ...planOptions, extraPerMonth: debtBudget?.extraSchedule ?? 0 }) : null),
    [debts, planOptions, debtBudget],
  );
  const debtEngine = useMemo(() => ({ comparePlans, marginalValue, lumpWhatIf, rateSensitivity, cascadeTimeline }), []);

  // ---- recurring lines, income, what is coming up ------------------------------------------
  // Everything in this block ignores the account chips too: a bill is a bill whether or not its
  // account is switched on, and the vitals are about the household, not the current filter.
  const dataThrough = processed?.dataThrough ?? null;
  const allNames = useMemo(() => accounts.flatMap((a) => a.seenNames ?? [a.rawName]), [accounts]);
  const recurring = useMemo(
    () =>
      data && calendar && transfers
        ? buildRecurringLines(data, { accounts, calendar, transfers, asOf: today, dataThrough })
        : null,
    [data, accounts, calendar, transfers, today, dataThrough],
  );
  const lines = recurring?.lines ?? null;
  const incomeProfile = useMemo(
    () =>
      data && calendar && transfers
        ? buildIncomeProfile(data, { accounts, calendar, transfers, asOf: today, dataThrough })
        : null,
    [data, accounts, calendar, transfers, today, dataThrough],
  );
  const upcoming = useMemo(
    () =>
      lines && calendar
        ? buildUpcoming(lines, { calendar, asOf: today, dataThrough, incomeProfile, explained: recurring.explained, data, transfers })
        : null,
    [lines, calendar, today, dataThrough, incomeProfile, recurring, data, transfers],
  );

  // A longer window for the vitals: twelve complete cycles, when the file has them.
  const processedLong = useMemo(
    () => (data ? processTransactionData(data, allNames, Math.min(13, Math.max(3, availableMonthCount)), today) : null),
    [data, allNames, availableMonthCount, today],
  );
  const costOfDebtLong = useMemo(
    () => (data && processedLong ? buildCostOfDebt(data, allNames, processedLong.months) : null),
    [data, allNames, processedLong],
  );
  const vitals = useMemo(
    () =>
      processedLong && data && calendar && transfers
        ? buildVitals({ processedLong, data, accounts, balanced, costOfDebtLong, transfers, calendar, asOf: today })
        : null,
    [processedLong, data, accounts, balanced, costOfDebtLong, transfers, calendar, today],
  );
  const direction = useMemo(
    () =>
      data && calendar && transfers
        ? buildDirection({ data, accounts, transfers, calendar, lines, incomeProfile })
        : null,
    [data, accounts, transfers, calendar, lines, incomeProfile],
  );
  const cashBuffer = Number(settings.get('cashBuffer', 0)) || 0;
  const cashPath = useMemo(
    () =>
      data && calendar && transfers && lines && upcoming
        ? buildCashToPayday({
            data, accounts, calendar, transfers, lines, explained: recurring.explained, upcoming, incomeProfile,
            asOf: today, dataThrough, buffer: cashBuffer,
          })
        : null,
    [data, accounts, calendar, transfers, lines, recurring, upcoming, incomeProfile, today, dataThrough, cashBuffer],
  );

  // ---- the savings finders ------------------------------------------------------------------
  const storedOverrides = settings.get('lineOverrides', null);
  const lineOverrides = useMemo(() => storedOverrides ?? {}, [storedOverrides]);
  const subscriptions = useMemo(
    () => (lines && calendar ? buildSubscriptions(lines, { calendar, dataThrough, asOf: today, lineOverrides }) : null),
    [lines, calendar, dataThrough, today, lineOverrides],
  );
  const priceCreep = useMemo(() => (lines ? buildPriceCreep(lines) : null), [lines]);
  const drift = useMemo(
    () => (data && calendar && transfers ? buildDrift(data, { transfers, calendar, accounts, selectedAccounts }) : null),
    [data, calendar, transfers, accounts, selectedAccounts],
  );
  const basket = useMemo(
    () => (data && calendar && transfers ? buildBasket(data, { transfers, calendar, accounts, selectedAccounts }) : null),
    [data, calendar, transfers, accounts, selectedAccounts],
  );
  const fees = useMemo(
    () => (data && calendar && transfers ? buildFeesAudit(data, accounts, { transfers, calendar, lines: lines ?? [] }) : null),
    [data, accounts, transfers, calendar, lines],
  );
  const finder = useMemo(
    () =>
      subscriptions && fees
        ? buildSavingsFinder({ subscriptions, priceCreep, drift, fees, basket, debtBudget, processed })
        : null,
    [subscriptions, priceCreep, drift, fees, basket, debtBudget, processed],
  );
  const setLineOverride = useCallback(
    (lineId, value) => {
      const next = { ...(settings.get('lineOverrides', null) ?? {}) };
      if (value == null) delete next[lineId];
      else next[lineId] = value;
      settings.set('lineOverrides', next);
    },
    [settings],
  );

  const safe = useMemo(() => deriveSafeToSpend(processed, summary), [processed, summary]);
  const budgets = useMemo(
    () => (processed ? buildBudgetProgress(processed, targets) : null),
    [processed, targets],
  );
  const trajectory = useMemo(
    () =>
      processed && balanced.some((b) => b.known)
        ? buildTrajectory(balanced, {
            cycles: 12,
            monthlySaving,
            fromDate: processed.currentCycleEnd,
          })
        : null,
    [balanced, monthlySaving, processed],
  );
  const gapClosers = useMemo(
    () => (processed && processed.netAvg < 0 ? buildGapClosers(processed, -processed.netAvg) : null),
    [processed],
  );
  const goalSummary = useMemo(
    () => summariseGoals(goals, Math.max(0, processed?.netAvg ?? 0)),
    [goals, processed],
  );
  // "What would it take": the Plan view calls the solver on demand with these.
  const solverInputs = useMemo(
    () => ({ debts, debtBudget, gapClosers, processed, planOptions }),
    [debts, debtBudget, gapClosers, processed, planOptions],
  );
  const solve = useMemo(() => ({ solveExtraForDate, solveExtraForGoal }), []);

  // Headlines read every analytic, so they come last.
  const headlines = useMemo(
    () =>
      buildHeadlines({
        summary, processed, positions: balanced, netWorth, costOfDebt, headroom, habits,
        vitals, direction, plans, debtBudget, rateSteps: rateStepList, upcoming, subscriptions, finder, drift,
      }),
    [summary, processed, balanced, netWorth, costOfDebt, headroom, habits, vitals, direction, plans, debtBudget, rateStepList, upcoming, subscriptions, finder, drift],
  );


  // Recharts' ResponsiveContainer measures 0x0 under a headless browser, so charts can't be
  // verified from a screenshot. Expose the computed data instead — dev only.
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__mv = {
        data, processed, chartData, summary, accountSeries, accountSummaries, accountPositions,
        balanced, netWorth, costOfDebt, habits, headlines, safe, budgets, trajectory, gapClosers, balances, curve,
        calendar, transfers, terms, debts, debtBudget, plans, marginal, sensitivity, rateSteps: rateStepList,
        recurring, lines, incomeProfile, upcoming, processedLong, costOfDebtLong, vitals, direction,
        cashPath, subscriptions, priceCreep, drift, basket, fees, finder,
      };
    }
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-label-3">
        <Aurora />
        <span className="relative">Loading your data…</span>
      </div>
    );
  }

  // The data lives on the server now, behind one passphrase. Nothing renders until it has been
  // given — not even the empty state, which would otherwise reveal whether any data exists.
  if (!auth.authenticated) {
    return (
      <div className="relative min-h-screen">
        <Aurora />
        <Login configured={auth.configured} onSubmit={signIn} error={auth.error} busy={auth.busy} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <Aurora />
      <div className="relative mx-auto w-full max-w-[1440px] px-5 pb-16 sm:px-8 3xl:max-w-[1760px] 4xl:max-w-[2040px]">
        <TopBar
          activeView={activeTab}
          onViewChange={setActiveTab}
          accounts={accounts}
          selectedIds={selectedIds}
          onToggleAccount={toggleAccount}
          onFileUpload={handleFileUpload}
          importing={importing}
          monthRange={monthRange}
          onMonthRangeChange={setMonthRange}
          availableMonthCount={availableMonthCount}
          dataThrough={processed?.dataThrough}
          staleLevel={summary?.staleLevel}
          exportUrl={exportUrl}
          onSignOut={signOut}
          extraControls={
            <Suspense fallback={null}>
              <StatementUpload
                accounts={accounts}
                onPatchAccount={updateAccount}
                onCreateAccount={createAccount}
                onDone={setStatementDone}
              />
            </Suspense>
          }
        />
        <div className="flex min-h-[calc(100vh-9.5rem)] flex-col gap-5 pt-2">
          {statementDone && (
            <div className="glass-tile flex flex-wrap items-center justify-between gap-4 px-5 py-3 text-[13px]">
              <span className="text-label-2">
                <b className="font-semibold text-label">{statementDone.bank ?? 'Account'} summary</b>
                {statementDone.asOf ? ` as of ${statementDone.asOf}` : ''}
                {` — ${statementDone.updated} balance${statementDone.updated === 1 ? '' : 's'} updated`}
                {statementDone.created > 0 && `, ${statementDone.created} account${statementDone.created === 1 ? '' : 's'} added`}
                {statementDone.method === 'ocr' && ' (read by OCR — worth a glance under Accounts)'}
              </span>
              <button type="button" onClick={() => setStatementDone(null)} className="press text-label-3 hover:text-label">
                Dismiss
              </button>
            </div>
          )}
          {localDump && (
            <MigrateBanner
              dump={localDump}
              onMigrate={migrateLocal}
              busy={migrating}
              onDismiss={dismissLocalDump}
            />
          )}
          {importError && (
            <div className="glass-tile flex items-center justify-between gap-4 px-5 py-3 text-[13px] text-bad">
              <span>Import failed: {importError}</span>
              <button type="button" onClick={dismissImportError} className="press text-label-2 hover:text-label">
                Dismiss
              </button>
            </div>
          )}
          <ImportSummary summary={lastImport} onDismiss={dismissLastImport} />
          {processed ? (
            <Suspense fallback={<div className="t-caption px-2 py-6">Loading…</div>}>
              {activeTab === 'today' && (
                <TodayView
                  summary={summary}
                  safe={safe}
                  curve={curve}
                  balances={balances}
                  netWorth={netWorth}
                  costOfDebt={costOfDebt}
                  positions={balanced.map((p) => ({ ...p, currentMonthKey: processed.currentMonth }))}
                  habits={habits}
                  onOpenLedger={() => setActiveTab('table')}
                  vitals={vitals}
                  upcoming={upcoming}
                  cashPath={cashPath}
                  incomeProfile={incomeProfile}
                  onOpenAccounts={() => setActiveTab('accounts')}
                />
              )}
              {activeTab !== 'today' && <Headlines headlines={headlines} />}
              {activeTab === 'table' && <LedgerView processed={processed} positions={balanced} />}
              {activeTab === 'charts' && <ChartsView chartData={chartData} />}
              {activeTab === 'habits' && (
                <HabitsView
                  habits={habits}
                  finder={finder}
                  subscriptions={subscriptions}
                  priceCreep={priceCreep}
                  drift={drift}
                  basket={basket}
                  lineOverrides={lineOverrides}
                  onSetLineOverride={setLineOverride}
                  asOf={today}
                />
              )}
            {activeTab === 'plan' && (
              <PlanView
                safe={safe}
                summary={summary}
                budgets={budgets}
                onSetTarget={setTarget}
                trajectory={trajectory}
                monthlySaving={monthlySaving}
                onMonthlySavingChange={setMonthlySaving}
                gapClosers={gapClosers}
                goals={goalSummary}
                onAddGoal={addGoal}
                onRemoveGoal={removeGoal}
                direction={direction}
                debts={debts}
                debtBudget={debtBudget}
                solverInputs={solverInputs}
                solve={solve}
                onOpenDebt={() => setActiveTab('debt')}
                subscriptions={subscriptions}
                lineOverrides={lineOverrides}
                onSetLineOverride={setLineOverride}
                asOf={today}
              />
            )}
              {activeTab === 'debt' && (
                <DebtView
                  terms={terms}
                  debts={debts}
                  debtBudget={debtBudget}
                  plans={plans}
                  marginal={marginal}
                  sensitivity={sensitivity}
                  rateSteps={rateStepList}
                  accounts={accounts}
                  settings={settings}
                  onPatchAccount={updateAccount}
                  onOpenPlan={() => setActiveTab('plan')}
                  onOpenAccounts={() => setActiveTab('accounts')}
                  asOf={today}
                  engine={debtEngine}
                  planOptions={planOptions}
                />
              )}
              {activeTab === 'accounts' && (
                <AccountsView
                  series={accountSeries}
                  summaries={accountSummaries}
                  positions={balanced}
                  months={processed.months}
                  currentMonth={processed.currentMonth}
                  dataThrough={processed.dataThrough}
                  accounts={accounts}
                  onSaveAccount={updateAccount}
                  costOfDebt={costOfDebt}
                  fees={fees}
                  onDeleteAccount={deleteAccount}
                />
              )}
            </Suspense>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}
