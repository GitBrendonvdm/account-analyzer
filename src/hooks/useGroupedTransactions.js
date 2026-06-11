import { useMemo } from 'react';
import { groupTransactionsByDescription } from '../lib/groupTransactions';

export function useGroupedTransactions(items, months, skipExpected, kind = 'expense') {
  return useMemo(
    () => groupTransactionsByDescription(items, months, skipExpected, kind),
    [items, months, skipExpected, kind],
  );
}
