import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnalyzerToolbar } from './components/AnalyzerToolbar';
import { ChartsView } from './components/ChartsView';
import { AccountsView } from './components/AccountsView';
import { CycleSummary } from './components/CycleSummary';
import { ImportSummary } from './components/ImportSummary';
import { Headlines } from './components/Headlines';
import { NetWorthStrip } from './components/NetWorthStrip';
import { deriveCycleSummary } from './lib/cycleSummary';
import {
  buildAccountMovementSeries,
  buildAccountPositions,
  buildAccountSummaries,
} from './lib/accountSeries';
import { applyBalances, cardHeadroom, summariseNetWorth } from './lib/netWorth';
import { buildCostOfDebt } from './lib/costOfDebt';
import { buildHeadlines } from './lib/headlines';
import { EmptyState } from './components/EmptyState';
import { TransactionTable } from './components/TransactionTable';
import { ViewTabs } from './components/ViewTabs';
import { useAnalyzerState } from './hooks/useAnalyzerState';
import { useChartData } from './hooks/useChartData';
import { useTransactionData } from './hooks/useTransactionData';

export default function App() {
  const [activeTab, setActiveTab] = useState('table');
  const {
    ready,
    data,
    accounts,
    selectedIds,
    selectedAccounts,
    monthRange,
    setMonthRange,
    fileName,
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
  const headlines = useMemo(
    () => buildHeadlines({ summary, processed, positions: balanced, netWorth, costOfDebt, headroom }),
    [summary, processed, balanced, netWorth, costOfDebt, headroom],
  );

  const showBalances = useCallback(() => setActiveTab('accounts'), []);

  // Recharts' ResponsiveContainer measures 0x0 under a headless browser, so charts can't be
  // verified from a screenshot. Expose the computed data instead — dev only.
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__mv = {
        data, processed, chartData, summary, accountSeries, accountSummaries, accountPositions,
        balanced, netWorth, costOfDebt, headlines,
      };
    }
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
        Loading your data…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="w-full space-y-6">
        <AnalyzerToolbar
          fileName={fileName}
          monthRange={monthRange}
          availableMonthCount={availableMonthCount}
          onMonthRangeChange={setMonthRange}
          accounts={accounts}
          selectedIds={selectedIds}
          onToggleAccount={toggleAccount}
          onFileUpload={handleFileUpload}
          importing={importing}
        />
        <ImportSummary summary={lastImport} onDismiss={dismissLastImport} />
        {processed ? (
          <>
            <Headlines headlines={headlines} />
            <NetWorthStrip netWorth={netWorth} onAddBalances={showBalances} />
            <CycleSummary summary={summary} />
            <ViewTabs activeTab={activeTab} onTabChange={setActiveTab} />
            {activeTab === 'table' && <TransactionTable processed={processed} />}
            {activeTab === 'charts' && <ChartsView chartData={chartData} />}
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
  );
}
