import { useMemo } from 'react';
import { processTransactionData } from '../lib/processTransactionData';

export function useTransactionData(data, selectedAccounts, monthRange) {
  return useMemo(
    () => processTransactionData(data, selectedAccounts, monthRange),
    [data, monthRange, selectedAccounts],
  );
}
