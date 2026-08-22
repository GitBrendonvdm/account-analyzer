import { last4 } from './amounts';
import { shapeAccount, typeFromName } from './fnb';

/**
 * Pairing what the statement says with the accounts the app already has.
 *
 * The export names an account "Nedbank Credit Card *4714"; the statement prints its full number.
 * The last four digits are the only thing both sides share, so that is the key — with the bank as
 * a tie-break, because two banks can issue numbers that happen to end the same way.
 *
 * The app's record is the user's word on what an account IS, so once a statement entry is paired
 * with one, the record's type replaces whatever the page said or the parser guessed, and the sign
 * follows: a liability is what is owed, negative. That is what keeps a R2.7m bond, read off a scan
 * that lost its "Home loan" cell, from ever being recorded as an asset. An entry the app has never
 * seen becomes an EXTERNAL record — it exists so net worth is complete, and it is marked as coming
 * from a statement so a later import cannot mistake it for one of its own. Upload the statement
 * again and that record is found by its mask like any other; it is never created twice.
 *
 * One more guard for the unknown: a large account whose type is nothing better than a guess from
 * its name is not proposed for creation at all. It goes to `needsAttention`, and the user says what
 * it is before it can be added (see externalRecord).
 *
 * The patch is deliberately small: a balance, the date it was true, and a limit when the statement
 * let one be derived. It never touches the name or the type. The date is the statement's unless
 * the caller overrides it — an FNB page carries none, and "today" is wrong for a PDF saved last
 * week — and a patch that would leave the record exactly as it is can be told apart
 * (`patchIsNoop`) so that a second upload of the same page writes nothing.
 */

const LIABILITY = new Set(['Credit Card', 'Loan']);
export const SIGN_NOTE = 'sign taken from the account type';
// Below this an unknown account is a small thing to get wrong; above it the user chooses the type.
const ATTENTION_THRESHOLD = 50000;

function masksOf(entry) {
  const all = [entry.last4, ...(entry.numbers ?? []).map(last4)];
  return new Set(all.filter(Boolean).map((m) => String(m).toLowerCase()));
}

const typeOf = (account) => account?.typeOverride ?? account?.type ?? null;
const isLiability = (account) => account?.isLiability ?? LIABILITY.has(typeOf(account));

function candidatesFor(entry, accounts, used) {
  const masks = masksOf(entry);
  return accounts.filter(
    (a) => a && !used.has(a.id) && a.mask && masks.has(String(a.mask).toLowerCase()),
  );
}

/** Same bank first, then same type, then whichever came first. */
function pick(candidates, bank, type) {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const wantBank = String(bank ?? '').toLowerCase();
  const sameBank = candidates.filter((a) => String(a.bank ?? '').toLowerCase() === wantBank);
  const pool = sameBank.length > 0 ? sameBank : candidates;
  return pool.find((a) => typeOf(a) === type) ?? pool[0];
}

const DEFAULT_KIND = { Bank: 'cheque', Savings: 'savings', 'Credit Card': 'card', Loan: 'other' };

/**
 * The same entry with a different type, re-signed from the figure as printed. The kind survives
 * if the type did; otherwise it is whatever the name says about the new type, else the plain
 * kind for that type.
 */
export function retype(entry, type, typeFrom) {
  const guess = typeFromName(entry.name);
  const kind =
    type === entry.type ? entry.kind : guess.type === type ? guess.kind : (DEFAULT_KIND[type] ?? null);
  return shapeAccount({ ...entry, type, kind, typeFrom });
}

/** Every entry that matches a known record takes that record's type. */
export function adoptKnownTypes(parsed, knownAccounts = []) {
  if (!parsed?.accounts?.length || !knownAccounts?.length) return parsed;
  const used = new Set();
  const accounts = parsed.accounts.map((entry) => {
    const record = pick(candidatesFor(entry, knownAccounts, used), parsed.bank, entry.type);
    if (!record) return entry;
    used.add(record.id);
    return retype(entry, typeOf(record) ?? entry.type, 'record');
  });
  return { ...parsed, accounts };
}

function patchFor(entry, account, asOf) {
  const patch = {
    currentBalance: entry.balance,
    balanceAsOf: asOf,
    source: 'statement',
    statementName: entry.name,
  };
  // The statement gives one headroom figure; the app's own type for the account decides what it
  // is called, because that type is the user's to set and the limit has to land on the field the
  // editor shows for it.
  const room = entry.creditLimit ?? entry.overdraftLimit ?? null;
  if (room != null && typeOf(account) === 'Credit Card') patch.creditLimit = room;
  if (room != null && typeOf(account) === 'Bank') patch.overdraftLimit = room;
  return patch;
}

const sameCents = (a, b) =>
  (a == null && b == null) ||
  (typeof a === 'number' && typeof b === 'number' && Math.round(a * 100) === Math.round(b * 100));

/**
 * Would this patch leave the record as it is? Balance to the cent, the same as-of date, and the
 * same value for any limit the patch carries. Who set the balance is not part of it: uploading
 * the page that set it again is not a change.
 */
export function patchIsNoop(patch, account) {
  if (!patch || !account) return false;
  if (!sameCents(patch.currentBalance, account.currentBalance)) return false;
  if ((patch.balanceAsOf ?? null) !== (account.balanceAsOf ?? null)) return false;
  for (const key of ['creditLimit', 'overdraftLimit']) {
    if (key in patch && !sameCents(patch[key], account[key])) return false;
  }
  return true;
}

function recordFor(entry, bank, asOf) {
  const bankName = bank || entry.bank || 'Unknown';
  const mask = entry.last4;
  const type = entry.type || 'Other';
  const rawName = `${bankName} ${type} *${mask}`;
  return {
    id: `${bankName.toLowerCase()}|${mask.toLowerCase()}`,
    bank: bankName,
    type,
    typeOverride: null,
    mask,
    rawName,
    seenNames: [rawName],
    seenThrough: null,
    label: entry.name,
    isLiability: LIABILITY.has(type),
    currentBalance: entry.balance,
    balanceAsOf: asOf,
    creditLimit: type === 'Credit Card' ? (entry.creditLimit ?? null) : null,
    overdraftLimit: type === 'Bank' ? (entry.overdraftLimit ?? null) : null,
    hidden: false,
    external: true,
    source: 'statement',
    statementName: entry.name,
  };
}

/**
 * A complete record for POST /api/accounts. With `type`, the entry is re-typed first — this is
 * how a `needsAttention` entry becomes an account once the user has said what it is.
 */
export function externalRecord(entry, { bank, asOf, type } = {}) {
  const typed = type && type !== entry.type ? retype(entry, type, 'user') : entry;
  return recordFor(typed, bank ?? entry.bank, asOf ?? null);
}

/**
 * @param {object}          parsed            the result of parseStatement
 * @param {object[]|object} accountsOrOptions the app's account records, or
 *                                            `{ knownAccounts, asOf }` — `asOf` replaces the
 *                                            statement's date in every patch and record
 */
export function matchStatement(parsed, accountsOrOptions = []) {
  const options = Array.isArray(accountsOrOptions) ? {} : (accountsOrOptions ?? {});
  const accounts = Array.isArray(accountsOrOptions) ? accountsOrOptions : (options.knownAccounts ?? []);
  const resolved = adoptKnownTypes(parsed, accounts);
  const asOf = options.asOf ?? resolved?.asOf ?? null;
  const bank = resolved?.bank ?? '';
  const used = new Set();
  const matched = [];
  const unmatched = [];
  const needsAttention = [];

  for (const entry of resolved?.accounts ?? []) {
    const account = pick(candidatesFor(entry, accounts, used), bank, entry.type);
    if (account) {
      used.add(account.id);
      let paired = entry;
      let note;
      if (isLiability(account) && entry.balance > 0) {
        paired = { ...entry, balance: -entry.balance, signFromType: true };
        note = SIGN_NOTE;
      } else if (entry.signFromType) {
        note = SIGN_NOTE;
      }
      matched.push({
        parsed: paired,
        account,
        patch: patchFor(paired, account, asOf),
        ...(note ? { note } : {}),
      });
      continue;
    }
    const uncertain = entry.type === 'Other' || entry.typeFrom === 'name';
    if (uncertain && Math.abs(entry.balance) > ATTENTION_THRESHOLD) {
      needsAttention.push({ parsed: entry, reason: 'type unknown' });
      continue;
    }
    unmatched.push({ parsed: entry, record: externalRecord(entry, { bank, asOf }) });
  }

  return { matched, unmatched, needsAttention, asOf };
}
