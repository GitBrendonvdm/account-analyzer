import { accountIdOf, parseAccount } from './accounts';
import { accountRows, anchorOffset, positionAt } from './ledger';

/**
 * Real balances, from one number per account.
 *
 * The export has no balance column, so `buildAccountPositions` anchors every account at zero on its
 * first transaction. The month-to-month deltas are exact but the level is arbitrary, which is why
 * the bond reads −R2 747 083: two years of movement, not a debt.
 *
 * One figure fixes all of it. Rather than asking for an opening balance from 2024 that nobody
 * remembers, the app asks what an account holds on a given day — a number that's one glance at a
 * banking app away — and works backwards:
 *
 *   offset  = balance − positionAt(balanceAsOf)
 *   balance = position + offset            (for every cycle, past and present)
 *
 * WHERE THE ANCHOR SITS. The first version took the anchor to be whichever cycle happened to be
 * current, which meant a balance typed on the 10th and an export imported on the 20th silently
 * re-anchored to the 20th: ten days of movement leaked into every historical figure with each new
 * file. When the rows are given the offset now comes from ledger.js, anchored at the record's own
 * `balanceAsOf` (falling back to the account's last row), so appending rows can never move a
 * balance that was stated for an earlier day. Without the rows the legacy current-cycle rule still
 * applies, for callers that only hold positions.
 *
 * EXTERNAL ACCOUNTS. A retirement annuity or a savings account the bank summary lists has no rows
 * in the export and never will, but it is part of what the household is worth. Records marked
 * `external` (and records whose rows simply have not arrived yet) are appended as flat lines at
 * their stated balance, so net worth counts them and nothing downstream has to special-case them.
 *
 * Accounts without a balance are reported as unknown rather than assumed to be zero. A net worth
 * that quietly treats an unentered bond as R0 is worse than one that says it's incomplete.
 */

const LIABILITY = new Set(['Credit Card', 'Loan']);

/** The record's own idea of its type, which wins over the name parsed off the export. */
function typeOf(account, fallback) {
  return account?.typeOverride ?? fallback ?? account?.type ?? 'Other';
}

function isKnownBalance(value) {
  return value != null && Number.isFinite(value);
}

/**
 * A renamed account appears in the positions under both its labels; the record's balance belongs
 * to the CURRENT label only. Counting the retired label as known too would count the balance twice.
 */
function isRetiredName(position, account) {
  if (!account?.rawName || (account.seenNames?.length ?? 0) < 2) return false;
  return position.account !== account.rawName;
}

/**
 * @param positions     buildAccountPositions(data, selectedAccounts, months)
 * @param accountsById  Map<AccountRecord.id, AccountRecord> — every record, selected or not
 * @param months        the visible cycle keys, ascending
 * @param options.data  every row; when given the offset is anchored at `balanceAsOf` (ledger.js)
 * @returns positions decorated with real balances (nulls where no balance has been given), plus one
 *   flat entry per record with no position — external accounts and records whose rows have not
 *   arrived — marked `external: true`.
 */
export function applyBalances(positions, accountsById, months, { data = null } = {}) {
  const currentMonth = months[months.length - 1];
  const placed = new Set();

  const balanced = positions.map((p) => {
    const account = accountsById.get(p.id ?? p.accountId) ?? accountsById.get(p.account);
    if (account) placed.add(account.id);
    const type = typeOf(account, p.type);
    const anchor = account?.currentBalance;
    const known = isKnownBalance(anchor) && !isRetiredName(p, account);

    let offset = 0;
    let balance = null;
    if (known) {
      if (data) {
        // Rows of this label only, so the ledger position and the table position agree row for row.
        const rows = accountRows(data, { rawNames: [p.account] });
        offset = anchorOffset(rows, account) ?? 0;
        const last = rows.length ? rows[rows.length - 1] : null;
        balance = (last ? positionAt(rows, last.DateObj ?? last.Date) : 0) + offset;
      } else {
        offset = anchor - (p.positionByMonth[currentMonth] ?? 0);
        balance = anchor;
      }
    }

    return {
      ...p,
      type,
      isLiability: LIABILITY.has(type),
      label: account?.label || p.account,
      creditLimit: account?.creditLimit ?? null,
      overdraftLimit: account?.overdraftLimit ?? null,
      source: account?.source ?? null,
      balanceAsOf: account?.balanceAsOf ?? null,
      external: false,
      known,
      offset,
      balance,
      balanceByMonth: Object.fromEntries(
        months.map((m) => [m, known && p.positionByMonth[m] != null ? p.positionByMonth[m] + offset : null]),
      ),
    };
  });

  accountsById.forEach((account) => {
    if (placed.has(account.id)) return;
    // A record without a position is external or has no rows yet. A deselected account with rows
    // is neither, and must not reappear here as a flat line: the chips removed it on purpose.
    const hasRows = data ? accountRows(data, { accountId: account.id }).length > 0 : false;
    if (!account.external && (hasRows || !data)) return;
    const rawName = account.rawName ?? account.label ?? account.id;
    const meta = parseAccount(rawName);
    const type = typeOf(account, meta.type);
    const known = isKnownBalance(account.currentBalance);
    const balance = known ? account.currentBalance : null;
    balanced.push({
      account: rawName,
      accountId: account.id ?? accountIdOf(rawName),
      bank: account.bank ?? meta.bank,
      mask: account.mask ?? meta.mask,
      short: meta.short,
      type,
      isLiability: LIABILITY.has(type),
      label: account.label || rawName,
      known,
      offset: 0,
      balance,
      balanceByMonth: Object.fromEntries(months.map((m) => [m, balance])),
      positionByMonth: {},
      deltaByMonth: {},
      openingPosition: 0,
      currentDelta: 0,
      typicalDelta: 0,
      windowChange: 0,
      external: true,
      creditLimit: account.creditLimit ?? null,
      overdraftLimit: account.overdraftLimit ?? null,
      source: account.source ?? null,
      balanceAsOf: account.balanceAsOf ?? null,
      hidden: account.hidden ?? false,
    });
  });

  return balanced;
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
      overdraftLimit: null,
    }))
    .sort((a, b) => b.used - a.used);
}

/**
 * The same question for current accounts with an overdraft: how far into it you already are.
 * `available` is the facility plus the balance when the balance is negative — an account in the
 * black has the whole facility left.
 * @returns [{ account, balance, limit, available }]
 */
export function overdraftHeadroom(balanced) {
  return balanced
    .filter((b) => b.type === 'Bank' && b.known && b.overdraftLimit)
    .map((b) => ({
      account: b.label ?? b.account,
      balance: b.balance,
      limit: b.overdraftLimit,
      available: b.overdraftLimit + Math.min(0, b.balance),
    }))
    .sort((a, b) => a.available - b.available);
}
