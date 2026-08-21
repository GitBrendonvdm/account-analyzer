import { accountIdOf, parseAccount } from '../lib/accounts';

/**
 * Stable identity for an account across exports.
 *
 * Account identity used to be the full display string — "FNB Savings *9547". Then the 21 August
 * export renamed that account to "FNB Bank *9547", same card, same mask, and to every part of the
 * app that was one account disappearing and a different one being born: its history split in two,
 * and anything keyed to it (a balance, a budget) would have silently detached.
 *
 * Bank plus mask survives that rename, and survives the type being re-labelled again later. The
 * type is still tracked, because it decides whether higher is better, but it is a PROPERTY of the
 * account rather than part of its name.
 */

export { accountIdOf };

/**
 * Fold every raw name seen for an account into one record.
 *
 * `seenNames` keeps the full history of labels so the rename is visible rather than lost, and
 * `label` is what the user chose to call it — falling back to the account's most recent name.
 *
 * "Most recent" is decided by the newest TRANSACTION date the name was seen on, not by which file
 * happened to be imported last. Imports are unordered by design — you might import an older export
 * to recover history that slid out of the window — and without this, doing so would rename the
 * account backwards and drag its type along with it.
 */
export function buildAccountRecord(rawNames, existing = null, seenThrough = null) {
  const names = [...new Set([...(existing?.seenNames ?? []), ...rawNames])];
  const incomingLatest = rawNames[rawNames.length - 1] ?? names[names.length - 1];
  const isNewer = !existing?.seenThrough || (seenThrough && seenThrough > existing.seenThrough);
  const latest = isNewer ? incomingLatest : (existing?.rawName ?? incomingLatest);
  const meta = parseAccount(latest);
  return {
    id: accountIdOf(latest),
    bank: meta.bank,
    // A user-set type wins: an export calling a revolving facility a "Loan" is a guess, and the
    // sign convention of the account is something only the account holder can confirm.
    type: existing?.typeOverride ?? meta.type,
    typeOverride: existing?.typeOverride ?? null,
    mask: meta.mask,
    rawName: latest,
    seenNames: names,
    // Newest transaction date this account has been seen on, across every import.
    seenThrough:
      seenThrough && (!existing?.seenThrough || seenThrough > existing.seenThrough)
        ? seenThrough
        : (existing?.seenThrough ?? seenThrough ?? null),
    label: existing?.label ?? null,
    isLiability:
      (existing?.typeOverride ?? meta.type) === 'Credit Card' ||
      (existing?.typeOverride ?? meta.type) === 'Loan',
    // Everything below is authored by the user and must survive every future import — that is half
    // the reason the database exists. Balances are what the account holds TODAY (negative for debt);
    // every historical figure is re-based from them. See lib/netWorth.js.
    currentBalance: existing?.currentBalance ?? null,
    balanceAsOf: existing?.balanceAsOf ?? null,
    creditLimit: existing?.creditLimit ?? null,
    hidden: existing?.hidden ?? false,
  };
}

/** What to show for an account: the user's own name for it, else the export's. */
export function accountLabel(account) {
  if (!account) return '';
  return account.label || account.rawName || account.id;
}

/** Did this account get re-labelled between exports? Worth surfacing rather than hiding. */
export function wasRenamed(account) {
  return (account?.seenNames?.length ?? 0) > 1;
}
