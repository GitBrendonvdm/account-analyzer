import { useEffect, useMemo, useState } from 'react';
import { Aurora } from './components/Aurora';
import { TopBar } from './components/TopBar';
import { TodayView } from './components/TodayView';
import { ChartsView } from './components/ChartsView';
import { AccountsView } from './components/AccountsView';
import { Headlines } from './components/Headlines';
import { buildCycleCurve } from './lib/cycleCurveSeries';
import { HabitsView } from './components/HabitsView';
import { ImportSummary } from './components/ImportSummary';
import { PlanView } from './components/PlanView';
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
import { LedgerView } from './components/LedgerView';
import { useAnalyzerState } from './hooks/useAnalyzerState';
import { useChartData } from './hooks/useChartData';
import { useTransactionData } from './hooks/useTransactionData';
import { usePlanState } from './hooks/usePlanState';

export default function App() {
  const [activeTab, setActiveTab] = useState('today');
  const {
    ready,
    data,
    accounts,
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
  const balanced = useMemo(
    () => (processed ? applyBalances(accountPositions, accountsById, processed.months) : []),
    [accountPositions, accountsById, processed],
  );
  const netWorth = useMemo(
    () => (processed ? summariseNetWorth(balanced, processed.months) : null),
    [balanced, processed],
  );
  const headroom = useMemo(() => cardHeadroom(balanced), [balanced]);

  const costOfDebt = useMemo(
    () => (processed ? buildCostOfDebt(data, selectedAccounts, processed.months) : null),
    [data, selectedAccounts, processed],
  );
  const habits = useMemo(
    () => (processed ? buildHabits(data, selectedAccounts, processed) : null),
    [data, selectedAccounts, processed],
  );

  const curve = useMemo(
    () => (processed ? buildCycleCurve(data, selectedAccounts, processed) : null),
    [data, selectedAccounts, processed],
  );

  const headlines = useMemo(
    () => buildHeadlines({ summary, processed, positions: balanced, netWorth, costOfDebt, headroom, habits }),
    [summary, processed, balanced, netWorth, costOfDebt, headroom, habits],
  );

  // ---- plan: targets, goals, scenario ------------------------------------------------------
  const { targets, setTarget, goals, addGoal, removeGoal, monthlySaving, setMonthlySaving } =
    usePlanState();

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


  // Recharts' ResponsiveContainer measures 0x0 under a headless browser, so charts can't be
  // verified from a screenshot. Expose the computed data instead — dev only.
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__mv = {
        data, processed, chartData, summary, accountSeries, accountSummaries, accountPositions,
        balanced, netWorth, costOfDebt, habits, headlines, safe, budgets, trajectory, gapClosers,
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
        />
        <div className="flex flex-col gap-5 pt-2">
          <ImportSummary summary={lastImport} onDismiss={dismissLastImport} />
          {processed ? (
            <>
              {activeTab === 'today' && (
                <TodayView
                  summary={summary}
                  safe={safe}
                  curve={curve}
                  chartData={chartData}
                  netWorth={netWorth}
                  costOfDebt={costOfDebt}
                  positions={balanced.map((p) => ({ ...p, currentMonthKey: processed.currentMonth }))}
                  habits={habits}
                  onOpenLedger={() => setActiveTab('table')}
                />
              )}
              {activeTab !== 'today' && <Headlines headlines={headlines} />}
              {activeTab === 'table' && <LedgerView processed={processed} positions={balanced} />}
              {activeTab === 'charts' && <ChartsView chartData={chartData} />}
              {activeTab === 'habits' && <HabitsView habits={habits} />}
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
                />
              )}
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}
