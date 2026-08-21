/**
 * Real balances, from one number per account.
 *
 * The export has no balance column, so `buildAccountPositions` anchors every account at zero on its
 * first transaction. The month-to-month deltas are exact but the level is arbitrary, which is why
 * the bond reads −R2 747 083: two years of movement, not a debt.
 *
 * One figure fixes all of it. Rather than asking for an opening balance from 2024 that nobody
 * remembers, the app asks what an account holds TODAY — a number that's one glance at a banking
 * app away — and works backwards:
 *
 *   offset  = balanceToday − positionAtLatestCycle
 *   balance = position + offset            (for every cycle, past and present)
 *
 * That makes the offset self-correcting: re-enter today's balance after any import and every
 * historical balance re-bases with it.
 *
 * Accounts without a balance are reported as unknown rather than assumed to be zero. A net worth
 * that quietly treats an unentered bond as R0 is worse than one that says it's incomplete.
 */

/** @returns positions decorated with real balances, or nulls where no balance has been given. */
export function applyBalances(positions, accountsById, months) {
  const currentMonth = months[months.length - 1];
  return positions.map((p) => {
    const account = accountsById.get(p.id ?? p.accountId) ?? accountsById.get(p.account);
    const anchor = account?.currentBalance;
    const known = anchor != null && Number.isFinite(anchor);
    const offset = known ? anchor - (p.positionByMonth[currentMonth] ?? 0) : 0;
    return {
      ...p,
      label: account?.label || p.account,
      creditLimit: account?.creditLimit ?? null,
      known,
      offset,
      balance: known ? anchor : null,
      balanceByMonth: Object.fromEntries(
        months.map((m) => [m, known && p.positionByMonth[m] != null ? p.positionByMonth[m] + offset : null]),
      ),
    };
  });
}

/**
 * Assets, debt and the difference — plus how much of the picture is actually filled in.
 *
 * Debt is reported as a positive magnitude because that's how people talk about it ("R131k on the
 * cards"), while `net` keeps the sign convention of the balances themselves.
 */
export function summariseNetWorth(balanced, months) {
  const known = balanced.filter((b) => b.known);
  const assets = known.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0);
  const debt = known.filter((b) => b.balance < 0).reduce((s, b) => s - b.balance, 0);

  // Change over the visible window, computed only from accounts we can actually value.
  const first = months[0];
  const current = months[months.length - 1];
  const opening = known.reduce((s, b) => s + (b.balanceByMonth[first] ?? 0), 0);
  const closing = known.reduce((s, b) => s + (b.balanceByMonth[current] ?? 0), 0);

  return {
    assets,
    debt,
    net: assets - debt,
    change: closing - opening,
    byMonth: months.map((m) => ({
      month: m,
      net: known.reduce((s, b) => s + (b.balanceByMonth[m] ?? 0), 0),
      assets: known.reduce((s, b) => s + Math.max(0, b.balanceByMonth[m] ?? 0), 0),
      debt: known.reduce((s, b) => s + Math.max(0, -(b.balanceByMonth[m] ?? 0)), 0),
    })),
    knownCount: known.length,
    totalCount: balanced.length,
    complete: known.length === balanced.length && balanced.length > 0,
    missing: balanced.filter((b) => !b.known).map((b) => b.label ?? b.account),
  };
}

/**
 * How much headroom is left on the cards, where a limit has been given.
 * Answers the question the trajectory view has to answer: when does this run out?
 */
export function cardHeadroom(balanced) {
  return balanced
    .filter((b) => b.type === 'Credit Card' && b.known && b.creditLimit)
    .map((b) => ({
      account: b.label ?? b.account,
      balance: b.balance,
      limit: b.creditLimit,
      used: Math.min(1, Math.abs(b.balance) / b.creditLimit),
      available: b.creditLimit - Math.abs(b.balance),
    }))
    .sort((a, b) => b.used - a.used);
}
