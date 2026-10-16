import { accountIdOf } from './accounts';

/**
 * Putting accounts away.
 *
 * A household accumulates accounts the app should stop showing: a card from 2023, a savings account
 * that was closed, a business account that lives in another system. They hold nothing, they have no
 * activity, and every one of them is a row in a table, a card in a grid and a "3 numbers missing"
 * line in the debt view that the reader has to read past to get to the accounts that matter.
 *
 * HIDING IS ABOUT WHAT YOU SEE, NOT WHAT HAPPENED. A hidden account is left out of the lists, the
 * charts, the debt table, the net worth and the cash path — and nothing is deleted: its rows stay,
 * its history still counts wherever the selection chips say it does, and showing it again puts it
 * back exactly as it was. The flag is the `hidden` field the record has always carried.
 *
 * DORMANT is the one thing the app can propose by itself: no row in over a year, and nothing held. An
 * account that is dormant but holds money is never proposed — that is not clutter, it is a balance.
 */

const DAY_MS = 86400000;
export const DORMANT_DAYS = 400;

const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

/** Every raw name an account has been exported under — what the pipeline filters rows by. */
export function namesOf(accounts) {
  return new Set((accounts ?? []).flatMap((a) => a.seenNames ?? [a.rawName]));
}

/**
 * @param accounts  the account records
 * @param stored    the stored rows
 * @returns {object[]} the accounts that are dormant and hold nothing, most recent first
 */
export function dormantAccounts(accounts, stored) {
  if (!stored?.length) return [];
  const newest = stored.reduce((max, t) => (t.Date > max ? t.Date : max), '');
  const last = new Map();
  stored.forEach((t) => {
    const id = accountIdOf(t.Account);
    if (!last.has(id) || t.Date > last.get(id)) last.set(id, t.Date);
  });
  return (accounts ?? [])
    .filter((a) => {
      if (a.hidden || a.external) return false;
      const seen = last.get(a.id);
      if (!seen) return false;
      if (dayNumber(newest) - dayNumber(seen) < DORMANT_DAYS) return false;
      return !(Number.isFinite(a.currentBalance) && Math.abs(a.currentBalance) >= 1);
    })
    .sort((a, b) => (last.get(b.id) > last.get(a.id) ? 1 : -1));
}
