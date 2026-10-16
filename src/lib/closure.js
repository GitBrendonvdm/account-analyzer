import { accountIdOf, parseAccount } from './accounts';

/**
 * Accounts that look finished.
 *
 * When a household clears a debt or closes an account, nothing in the bank's data says so. The
 * history just stops, and the app carries on expecting the car's instalment, the old card's
 * minimum, a balance it never learned. This looks for the two ways the end shows itself, and only
 * SUGGESTS — closing an account changes what is expected of it, so the reader confirms.
 *
 *   PAID OFF — a loan or card whose estimated balance (see loanProjection.js) is matched, within
 *     fifteen percent, by one large payment out of another account in the last two months, worded
 *     like a settlement ("CAR PAYOFF", "SETTLEMENT") or like a transfer. The estimate and the
 *     payment are independent, so agreement between them is real evidence; the date of that
 *     payment is when it closed.
 *   IDLE — no row for a month or more while the rest of the data carries on, no payment still
 *     arriving, and no balance of any size recorded. The account's last row is when it ended.
 *
 * What it never suggests: an external account (it has no rows to go quiet), one already closed or
 * dismissed, an account that holds money, or one that is still being paid.
 */

const DAY_MS = 86400000;
const IDLE_DAYS = 30;
const EVIDENCE_DAYS = 60;
const MATCH_RATIO = 0.15;
const MIN_PAYOFF = 1000;
const SETTLEMENT = /pay.?off|settle|transfer|\btran\b|1sa|1bb|close/i;

const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const typeOf = (account) => account?.typeOverride ?? account?.type ?? parseAccount(account?.rawName).type;

/**
 * @param accounts   the account records
 * @param stored     the stored rows (not the estimated ones)
 * @param inferred   loanProjection's summary — what each projected loan is estimated to owe
 * @param dismissed  account ids the reader has said are not finished
 * @returns {{ accountId, label, kind: 'paid-off'|'idle', closedOn: string, reason: string,
 *             evidence: { date, amount, description }|null }[]}  paid-off first
 */
export function closureSuggestions({ accounts, stored, inferred = [], dismissed = [] }) {
  if (!stored?.length) return [];
  const dataThrough = stored.reduce((max, t) => (t.Date > max ? t.Date : max), '');
  if (!dataThrough) return [];
  const through = dayNumber(dataThrough);

  const lastOf = new Map();
  stored.forEach((t) => {
    const id = accountIdOf(t.Account);
    if (!lastOf.has(id) || t.Date > lastOf.get(id)) lastOf.set(id, t.Date);
  });
  const loanIds = new Set(accounts.filter((a) => typeOf(a) === 'Loan').map((a) => a.id));
  const estimate = new Map(inferred.map((l) => [l.accountId, l]));
  const skip = new Set(dismissed);

  const out = [];
  accounts.forEach((account) => {
    if (account.external || account.closedOn || skip.has(account.id)) return;
    const last = lastOf.get(account.id);
    if (!last) return;
    const label = account.label || account.rawName;
    const liability = typeOf(account) === 'Loan' || typeOf(account) === 'Credit Card';

    // ---- paid off: the estimate meets a payment ------------------------------------------
    const owed = estimate.get(account.id)?.owed;
    if (liability && owed > MIN_PAYOFF) {
      const candidates = stored
        .filter(
          (t) =>
            t.AmountNum < 0 &&
            !loanIds.has(accountIdOf(t.Account)) &&
            accountIdOf(t.Account) !== account.id &&
            through - dayNumber(t.Date) <= EVIDENCE_DAYS &&
            -t.AmountNum >= MIN_PAYOFF &&
            Math.abs(-t.AmountNum - owed) / owed <= MATCH_RATIO &&
            SETTLEMENT.test(t.Description ?? ''),
        )
        .sort((a, b) => Math.abs(-a.AmountNum - owed) - Math.abs(-b.AmountNum - owed));
      const hit = candidates[0];
      if (hit) {
        out.push({
          accountId: account.id,
          label,
          kind: 'paid-off',
          closedOn: hit.Date,
          reason: `a payment of ${Math.round(-hit.AmountNum).toLocaleString('en-ZA')} on ${hit.Date} matches what it was estimated to owe`,
          evidence: { date: hit.Date, amount: -hit.AmountNum, description: hit.Description },
        });
        return;
      }
    }

    // ---- idle: it went quiet and nothing is still arriving ---------------------------------
    const stillPaid = estimate.has(account.id) && estimate.get(account.id).payments > 0;
    const holds = Number.isFinite(account.currentBalance) && Math.abs(account.currentBalance) >= 1;
    if (through - dayNumber(last) >= IDLE_DAYS && !stillPaid && !holds) {
      out.push({
        accountId: account.id,
        label,
        kind: 'idle',
        closedOn: last,
        reason: `no activity since ${last}`,
        evidence: null,
      });
    }
  });

  return out.sort((a, b) => (a.kind === b.kind ? (a.label < b.label ? -1 : 1) : a.kind === 'paid-off' ? -1 : 1));
}

/** What closing an account says to the server: nothing owed or held from that day. */
export function closurePatch(closedOn) {
  return { closedOn, currentBalance: 0, balanceAsOf: closedOn, source: 'manual' };
}

/** Undoing it: the date goes, and the balance goes with it rather than being left as a false zero. */
export function reopenPatch() {
  return { closedOn: null, currentBalance: null, balanceAsOf: null };
}
