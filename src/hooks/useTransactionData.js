import { useMemo } from 'react';
import { processTransactionData } from '../lib/processTransactionData';
import { useToday } from './useToday';

export function useTransactionData(data, selectedAccounts, monthRange) {
  // `asOf` is an explicit dependency: it used to default inside processTransactionData, where the
  // memo couldn't see it, so the forecast froze on the day the tab was opened.
  const asOf = useToday();
  return useMemo(
    () => processTransactionData(data, selectedAccounts, monthRange, asOf),
    [data, monthRange, selectedAccounts, asOf],
  );
}
