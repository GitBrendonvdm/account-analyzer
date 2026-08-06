import { useEffect, useMemo, useState } from 'react';
import { AnalyzerToolbar } from './components/AnalyzerToolbar';
import { ChartsView } from './components/ChartsView';
import { AccountsView } from './components/AccountsView';
import { CycleSummary } from './components/CycleSummary';
import { deriveCycleSummary } from './lib/cycleSummary';
import {
  buildAccountMovementSeries,
  buildAccountPositions,
  buildAccountSummaries,
} from './lib/accountSeries';
import { EmptyState } from './components/EmptyState';
import { TransactionTable } from './components/TransactionTable';
import { ViewTabs } from './components/ViewTabs';
import { useAnalyzerState } from './hooks/useAnalyzerState';
import { useChartData } from './hooks/useChartData';
import { useTransactionData } from './hooks/useTransactionData';

export default function App() {
  const [activeTab, setActiveTab] = useState('table');
  const {
    data,
    selectedAccounts,
    monthRange,
    setMonthRange,
    fileName,
    allAccounts,
    availableMonthCount,
    toggleAccount,
    handleFileUpload,
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

  // Recharts' ResponsiveContainer measures 0x0 under a headless browser, so charts can't be
  // verified from a screenshot. Expose the computed data instead — dev only.
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__mv = { data, processed, chartData, summary, accountSeries, accountSummaries, accountPositions };
    }
  }, [data, processed, chartData, summary, accountSeries, accountSummaries, accountPositions]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="w-full space-y-6">
        <AnalyzerToolbar
          fileName={fileName}
          monthRange={monthRange}
          availableMonthCount={availableMonthCount}
          onMonthRangeChange={setMonthRange}
          allAccounts={allAccounts}
          selectedAccounts={selectedAccounts}
          onToggleAccount={toggleAccount}
          onFileUpload={handleFileUpload}
        />
        {processed ? (
          <>
            <CycleSummary summary={summary} />
            <ViewTabs activeTab={activeTab} onTabChange={setActiveTab} />
            {activeTab === 'table' && <TransactionTable processed={processed} />}
            {activeTab === 'charts' && <ChartsView chartData={chartData} />}
            {activeTab === 'accounts' && (
              <AccountsView
                series={accountSeries}
                summaries={accountSummaries}
                positions={accountPositions}
                months={processed.months}
                currentMonth={processed.currentMonth}
                dataThrough={processed.dataThrough}
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
