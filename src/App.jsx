import { useEffect, useMemo, useState } from 'react';
import { AnalyzerToolbar } from './components/AnalyzerToolbar';
import { ChartsView } from './components/ChartsView';
import { CycleSummary } from './components/CycleSummary';
import { deriveCycleSummary } from './lib/cycleSummary';
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

  // Recharts' ResponsiveContainer measures 0x0 under a headless browser, so charts can't be
  // verified from a screenshot. Expose the computed data instead — dev only.
  useEffect(() => {
    if (import.meta.env.DEV) window.__mv = { data, processed, chartData };
  }, [data, processed, chartData]);

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
            {activeTab === 'table' ? (
              <TransactionTable processed={processed} />
            ) : (
              <ChartsView chartData={chartData} />
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}
