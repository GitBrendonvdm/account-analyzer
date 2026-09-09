import { useMemo } from 'react';
import { groupTransactionsByDescription } from '../lib/groupTransactions';

export function useGroupedTransactions(items, months, skipExpected, parent, providers) {
  const expected = parent?.expected;
  const weeklyRemaining = parent?.weeklyRemaining;
  return useMemo(
    () =>
      groupTransactionsByDescription(items, months, skipExpected, { expected, weeklyRemaining }, providers),
    [items, months, skipExpected, expected, weeklyRemaining, providers],
  );
}
