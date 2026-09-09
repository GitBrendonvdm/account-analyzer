import { useMemo } from 'react';
import { processTransactionData } from '../lib/processTransactionData';
import { useToday } from './useToday';

export function useTransactionData(data, selectedAccounts, monthRange, txnOverrides = null) {
  // `asOf` is an explicit dependency: it used to default inside processTransactionData, where the
  // memo couldn't see it, so the forecast froze on the day the tab was opened.
  const asOf = useToday();
  // Re-labels are already baked into `data` upstream (applyTxnOverrides), so only the
  // expected/unexpected flags need to reach the classifier here.
  return useMemo(
    () => processTransactionData(data, selectedAccounts, monthRange, asOf, { txnOverrides }),
    [data, monthRange, selectedAccounts, asOf, txnOverrides],
  );
}
