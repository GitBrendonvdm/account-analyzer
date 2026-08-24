import { accountIdOf, parseAccount } from '../lib/accounts';
import { last4 } from '../lib/statements/amounts';
import { typeFromName } from '../lib/statements/fnb';

/**
 * Vault22's export changed shape in August 2026, and not only cosmetically.
 *
 * The old export was one row per transaction: a signed Amount, one `Account` string carrying the
 * bank, the type and the mask ("FNB Bank *9986"), and column names with spaces. The new one:
 *
 *   1. renames every column — `Spending Group` → `SpendingGroup`, `Pay Month` → `PayMonth`,
 *      `Split Transaction` → `IsSplit`, `Notes` → `Note` — and adds `PostDate`,
 *      `OriginalDescription` and `AccountNumber`;
 *   2. splits the account into the bank's own name ("Credit Card Plastic") and a separate mask
 *      ("*4714"), so the bank is no longer written down anywhere;
 *   3. makes every Amount POSITIVE and moves the direction into `Type` (`debit` / `credit`);
 *   4. emits most transactions TWICE — once `posted` and once as a stale `pending` copy, sometimes
 *      with the reference re-masked ("Toyota_Fin *1001" against "Toyota_Fin *7408").
 *
 * Read literally, that file would have imported every expense as income, under new account
 * identities that split two years of history in half, with roughly eight hundred phantom
 * duplicates on top. So this module translates it back to the shape the rest of the app has always
 * used, and the translation is the interesting part:
 *
 * ACCOUNTS ARE MATCHED BY MASK. The last four digits are the only thing the two formats share, and
 * they are already the second half of the app's stable account id. An account whose mask is known
 * keeps its existing raw name verbatim — which keeps its id, its history, and anything the user set
 * against it. Only a genuinely new account has to be named from scratch, and then the bank is read
 * out of the account's own name where it says so.
 *
 * A PENDING COPY IS DROPPED WHEN THE TRANSACTION HAS ALSO SETTLED. Group the file by date, account
 * and signed amount: where a group holds any `posted` row, every `pending` row in it is a stale
 * shadow of it and goes — however many there are, and whatever the reference was re-masked to. One
 * transfer in the file that prompted this appeared once posted and five times pending. Where a
 * group holds no posted row the pending row is real and is kept, still marked Pending: on that same
 * file exactly one was, an electricity token that had not cleared.
 *
 * Settled rows keep their genuine repeats — the same amount to the same account on one day occurs
 * up to ten times in this data and each is a real transaction. What does not survive is a row
 * BYTE-IDENTICAL to another in the same file, in every column. The app's usual rule is the opposite
 * (see db/txnKey.js: identical rows are numbered rather than collapsed, because two flat whites on
 * one morning are two transactions), and that rule was written for an export that did not repeat
 * itself. This one does: it emitted 805 stale pending copies in the same file, and its settled
 * repeats cluster on statement days — five identical interest charges of R387.36 on one card on one
 * day, where the previous export listed the whole statement batch once or not at all. Where both
 * exports covered the same transaction the old one always held a single copy. So an exact repeat is
 * read as the file repeating itself, one is kept, and the count is reported rather than swallowed.
 *
 * The narrow cost of both rules: buy the same coffee twice in a day for the same amount, and the
 * second is read as a repeat. That is the price of not carrying phantom money forever, in an app
 * that never deletes a row once imported.
 */

/** Both formats, in the order the canonical row wants them; the CSV export writes these back out. */
const CANONICAL_STATUS = { posted: 'Completed', pending: 'Pending' };

/** Banks that write their own name into the account name. Anything else keeps the name as its bank. */
const BANKS = [
  [/\bfnb\b|first\s*national/i, 'FNB'],
  [/nedbank/i, 'Nedbank'],
  [/\babsa\b/i, 'Absa'],
  [/standard\s*bank|stanbic/i, 'Standard Bank'],
  [/capitec/i, 'Capitec'],
  [/investec/i, 'Investec'],
  [/discovery/i, 'Discovery'],
  [/tyme/i, 'TymeBank'],
  [/african\s*bank/i, 'African Bank'],
  [/bidvest/i, 'Bidvest'],
];

/** The new export's own columns, as distinct from the old export's. */
export function isVault22Export(headers = []) {
  const has = (name) => headers.includes(name);
  return has('AccountNumber') && has('Account') && (has('SpendingGroup') || has('PayMonth'));
}

/**
 * Every mask the app already knows, pointing at the raw name it knows it by.
 * Accepts account records (from the database) or plain raw-name strings.
 */
export function maskIndex(accounts = []) {
  const index = new Map();
  accounts.forEach((entry) => {
    const rawName = typeof entry === 'string' ? entry : (entry?.rawName ?? entry?.account ?? '');
    if (!rawName) return;
    const mask = String(
      typeof entry === 'string' ? parseAccount(rawName).mask : (entry.mask ?? parseAccount(rawName).mask),
    ).toLowerCase();
    if (!mask) return;
    if (!index.has(mask)) index.set(mask, rawName);
    // Every name this account has ever been exported under still resolves to the current one.
    const seen = typeof entry === 'string' ? [] : (entry.seenNames ?? []);
    seen.forEach((name) => {
      const m = String(parseAccount(name).mask ?? '').toLowerCase();
      if (m && !index.has(m)) index.set(m, rawName);
    });
  });
  return index;
}

/**
 * The raw account name for a row, preferring the one the app already uses.
 *
 * A known mask returns the stored name unchanged, so the account id, its history and everything the
 * user set against it survive the format change. An unknown mask is named from what the file says:
 * the bank when the account name states it, the account's own name when it does not — because
 * "Credit Card Plastic" never says Nedbank anywhere, and inventing a bank would be worse than
 * admitting the name is all we have.
 */
export function resolveAccountName(name, number, index = new Map()) {
  const mask = String(last4(number) || last4(name) || '').toLowerCase();
  const known = mask && index.get(mask);
  if (known) return known;

  const label = String(name ?? '').trim();
  const { type } = typeFromName(label);
  const bank = BANKS.find(([re]) => re.test(label))?.[1];
  if (!mask) return label;
  // parseAccount reads "<bank> <type> *<mask>"; without a type word it cannot, so Other becomes Bank
  // rather than leaving the account unparseable and its id a raw string.
  const kind = type === 'Other' ? 'Bank' : type;
  return `${bank ?? label} ${kind} *${mask}`;
}

const cents = (n) => Math.round((Number(n) || 0) * 100);
const pairKey = (row) => `${row.Date}|${accountIdOf(row.Account)}|${cents(row.AmountNum)}`;

/** One new-format row in the shape the rest of the app has always consumed. */
function toCanonical(row, index) {
  const magnitude = Math.abs(Number(String(row.Amount ?? '').replace(/[\s,]/g, '')) || 0);
  const credit = String(row.Type ?? '').toLowerCase() === 'credit';
  const amount = credit ? magnitude : -magnitude;
  const status = CANONICAL_STATUS[String(row.Status ?? '').toLowerCase()] ?? row.Status ?? '';
  return {
    Date: row.Date ?? '',
    // The bank's own wording is in Description; OriginalDescription is blank in every row seen.
    Description: row.Description || row.OriginalDescription || '',
    Account: resolveAccountName(row.Account, row.AccountNumber, index),
    'Spending Group': row.SpendingGroup ?? '',
    Category: row.Category ?? '',
    'Pay Month': row.PayMonth ?? '',
    'Split Transaction': String(row.IsSplit ?? '').toLowerCase() === 'true' ? 'Yes' : 'No',
    Currency: row.Currency ?? '',
    Amount: String(amount),
    'Original Currency': row.OriginalCurrency ?? '',
    'Original Amount': row.OriginalAmount ?? '',
    Type: credit ? 'Income' : 'Expense',
    Status: status,
    Tags: row.Tags ?? '',
    Notes: row.Note ?? '',
    AmountNum: amount,
  };
}

/**
 * @param rows     rows parsed from a new-format export, keyed by its own column names
 * @param accounts the accounts the app already knows (records or raw names)
 * @returns {{ rows, dropped, repeats }} canonical rows, the stale pending copies removed, and the
 *          rows the file simply repeated
 */
export function normaliseVault22Rows(rows, { accounts = [] } = {}) {
  const index = maskIndex(accounts);
  const mapped = rows.map((row) => ({ source: row, canonical: toCanonical(row, index) }));

  const settled = new Set();
  mapped.forEach(({ canonical }) => {
    if (canonical.Status !== 'Pending') settled.add(pairKey(canonical));
  });

  const seen = new Set();
  const kept = [];
  let dropped = 0;
  let repeats = 0;
  mapped.forEach(({ source, canonical }) => {
    if (canonical.Status === 'Pending' && settled.has(pairKey(canonical))) {
      dropped += 1;
      return;
    }
    // Every column the file gave, so a row differing even in its posting date survives as its own.
    const identity = Object.keys(source)
      .filter((k) => k !== 'id')
      .sort()
      .map((k) => `${k}=${source[k] ?? ''}`)
      .join('|');
    if (seen.has(identity)) {
      repeats += 1;
      return;
    }
    seen.add(identity);
    kept.push({ ...canonical, id: kept.length });
  });

  return { rows: kept, dropped, repeats };
}
