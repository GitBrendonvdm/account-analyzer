import { useMemo } from 'react';
import { buildNetTotalChartData, buildPeriodNetChartData } from '../lib/chartData';

export function useChartData(data, selectedAccounts, processed) {
  return useMemo(
    () => ({
      running: buildNetTotalChartData(data, selectedAccounts, processed),
      period: buildPeriodNetChartData(processed),
    }),
    [data, processed, selectedAccounts],
  );
}
