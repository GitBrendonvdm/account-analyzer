import { headroom, last4, round2 } from './amounts';
import { typeFromName } from './fnb';

/**
 * FNB's "download transaction history" file.
 *
 *   ACCOUNT TRANSACTION HISTORY
 *
 *   Name:, <holder>
 *   Account:, 62513359986, [FNB Gold Cheque Account]
 *   Balance:, 288.85, 18388.86
 *
 *   Date, Amount, Balance, Description
 *   2026/10/15, -5000.00, 288.85, TRANSFER
 *
 * It is the bank's own record, not an aggregator's reading of it, and it carries what no export the
 * app has seen before did: a RUNNING BALANCE on every line. That changes what the file can be used
 * for. The balance column lets the file prove itself — each line's balance is the one below it plus
 * its amount, so a missing line, a re-ordered line or a line that never moved the balance shows up
 * as a break in the chain — and the header's balance is the account's real balance on the day of
 * the download, so nobody has to type it in.
 *
 * What the file is NOT:
 *
 *   - Newest first, and not strictly by date. Lines are in the order the bank processed them, so a
 *     card purchase dated the 17th can sit below one dated the 18th. The running balance follows
 *     the file's order, which is why the chain is checked in that order and dates are only used for
 *     the ledger.
 *   - Free of lines that are not money. A zero-amount line is an announcement ("CR.INT.RATE",
 *     "CHANGE", "REPAYMENT CALC METHOD CHANGE"). A line whose amount did not move the balance is a
 *     notification of something that did not happen — an unpaid debit order's collection attempt
 *     is printed as a credit and leaves the balance exactly where it was. Importing either as a
 *     transaction would invent income, so they are set aside and reported.
 *   - Always balanced. A credit card's history has `0` in every balance cell, and its header carries
 *     the balance and the available credit instead. Such a file is read without a chain.
 *   - In rand. The eBucks account's amounts are points. They are recognised and left out.
 *
 * Pure: text in, a plain object out. Nothing here knows about the database or the other accounts.
 */

const TITLE = /^\s*account transaction history\s*$/im;
const ACCOUNT_LINE = /^\s*account:\s*,\s*([^,]*?)\s*,\s*\[(.*?)\]\s*$/im;
const BALANCE_LINE = /^\s*balance:\s*,\s*([^,]*?)\s*,\s*(.*?)\s*$/im;
const ROW = /^\s*(\d{4})\/(\d{2})\/(\d{2})\s*,\s*(-?[\d ]*\d(?:\.\d+)?)\s*,\s*(-?[\d ]*\d(?:\.\d+)?)\s*,\s?(.*)$/;
const EBUCKS = /e-?bucks/i;
const RATE_NOTE = /^cr\.int\.rate\s+(\d+(?:[.,]\d+)?)/i;

/** Does this look like one of FNB's history files? Cheap, so the caller can route a mixed upload. */
export function looksLikeFnbHistory(text) {
  const head = String(text ?? '').slice(0, 1500);
  return TITLE.test(head) && ACCOUNT_LINE.test(head);
}

function number(text) {
  const n = Number(String(text ?? '').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

function headerNumber(text) {
  const t = String(text ?? '').trim();
  if (!t || /^n\/?a$/i.test(t)) return null;
  return number(t);
}

/** "5,90000" is how the bank writes 5.9 — a decimal comma and five places. */
function rateOf(text) {
  const n = Number(String(text).replace(',', '.'));
  return Number.isFinite(n) ? round2(n * 100) / 100 : null;
}

const iso = (y, m, d) => `${y}-${m}-${d}`;

/**
 * @returns {{
 *   ok: boolean, reason?: string,
 *   account: { number, last4, name, balance, available },
 *   rows: { date, amount, balance, description, index }[],  lines that moved money, file order (newest first)
 *   informational: { date, description }[],                  zero-amount announcements
 *   nonPosting: { date, amount, description }[],             amount shown, balance unmoved
 *   hasBalances: boolean,                                    false for a card (every cell 0)
 *   chain: { checked: number, breaks: { index, date, description, expected, actual }[] },
 *   creditRate: number|null,                                 percent, from a CR.INT.RATE line
 *   newest: string|null, oldest: string|null,                ISO dates
 * }}
 */
export function parseFnbHistory(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const account = source.match(ACCOUNT_LINE);
  if (!TITLE.test(source.slice(0, 1500)) || !account) {
    return { ok: false, reason: 'Not an FNB transaction-history file' };
  }
  const balance = source.match(BALANCE_LINE);

  const rows = [];
  const informational = [];
  let creditRate = null;
  source.split(/\r?\n/).forEach((line) => {
    const m = line.match(ROW);
    if (!m) return;
    const [, y, mo, d, amountText, balanceText, rest] = m;
    const description = rest.replace(/\s+/g, ' ').trim();
    const amount = number(amountText);
    if (amount == null) return;
    const date = iso(y, mo, d);
    if (amount === 0) {
      informational.push({ date, description });
      const rate = description.match(RATE_NOTE);
      if (rate && creditRate == null) creditRate = rateOf(rate[1]);
      return;
    }
    rows.push({ date, amount, balance: number(balanceText), description, index: rows.length });
  });

  const hasBalances = rows.some((r) => r.balance != null && r.balance !== 0);

  // Walk newest → oldest. A line is consistent when its balance less its amount is the balance of
  // the line below it. A line whose balance equals the one below it, though its amount is not zero,
  // never moved the balance at all: it is set aside and the chain carries on across it.
  const posting = [];
  const nonPosting = [];
  const breaks = [];
  let checked = 0;
  if (hasBalances) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const below = rows.slice(i + 1).find((r) => r.balance != null);
      if (!below) {
        posting.push(row);
        continue;
      }
      if (round2(row.balance) === round2(below.balance)) {
        nonPosting.push({ date: row.date, amount: row.amount, description: row.description });
        continue;
      }
      checked += 1;
      const expected = round2(row.balance - row.amount);
      if (expected !== round2(below.balance)) {
        breaks.push({ index: row.index, date: row.date, description: row.description, expected, actual: below.balance });
      }
      posting.push(row);
    }
  } else {
    posting.push(...rows);
  }

  const dates = posting.map((r) => r.date).sort();
  const number_ = account[1].trim();
  return {
    ok: true,
    account: {
      number: number_,
      last4: last4(number_),
      name: account[2].trim(),
      balance: balance ? headerNumber(balance[1]) : null,
      available: balance ? headerNumber(balance[2]) : null,
    },
    rows: posting,
    informational,
    nonPosting,
    hasBalances,
    chain: { checked, breaks },
    creditRate,
    newest: dates[dates.length - 1] ?? null,
    oldest: dates[0] ?? null,
  };
}

/** FNB writes the bank's descriptions in capitals; the app reads (and the old export wrote) title case. */
export function tidyDescription(description) {
  const clean = String(description ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^#\s*/, '')
    // A card purchase: the bank prefixes "PURCH" and suffixes the card's masked number. The old
    // export kept the shop and the last four digits, and so does this.
    .replace(/^purch\s+/i, '')
    .replace(/\b\d{6}\*{4,}(\d{4})\b/g, '*$1')
    .trim();
  const letters = clean.replace(/[^A-Za-z]/g, '');
  const shouting = letters.length > 3 && letters === letters.toUpperCase();
  return shouting ? clean.toLowerCase().replace(/(^|[\s(/_-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : clean;
}

/**
 * What kind of account a history file describes, from the bank's own name for it.
 * `rewards` marks the eBucks account, whose amounts are points rather than money.
 */
export function kindOfHistory(parsed) {
  const name = parsed?.account?.name ?? '';
  if (EBUCKS.test(name)) return { type: 'Other', kind: 'rewards', rewards: true };
  const guess = typeFromName(name);
  if (guess.type !== 'Other') return { ...guess, rewards: false };
  // A history file with no recognisable name still says something: a card number is 16 digits,
  // and a header with no "available" figure and a balance column of zeros is a card's.
  if (/^\d{6}[*\d]{6}\d{4}$/.test(parsed?.account?.number ?? '')) return { type: 'Credit Card', kind: 'card', rewards: false };
  return { type: 'Bank', kind: 'cheque', rewards: false };
}

/**
 * The account figures a history file's header gives, in the app's own convention (a liability is
 * what is owed, negative) — the same shape the statement overview patches use, so the two sources
 * of a balance are interchangeable and a re-upload of either is recognised as the same figure.
 *
 * `asOf` is the newest line's date: the file says what the account held after its newest line, and
 * says nothing about the days after it. A loan file's header has no balance ("N/A") but its newest
 * line does, so the running balance is the fallback.
 */
export function balanceFacts(parsed, type) {
  const { balance, available } = parsed.account;
  const liability = type === 'Credit Card' || type === 'Loan';
  const newest = parsed.rows[0] ?? null;
  let current = balance;
  if (current == null && parsed.hasBalances && newest?.balance != null) current = newest.balance;
  // The header's "available" on a loan is its undrawn amount, and on a loan with no balance
  // printed it is the balance itself (the home loan's header reads "N/A, -603423.20").
  if (current == null && available != null && liability) current = available;
  if (current == null) return null;
  const signed = liability ? -Math.abs(current) : current;
  const room = balance != null && available != null ? headroom(signed, available) : null;
  return {
    currentBalance: signed === 0 ? 0 : signed,
    printedBalance: current,
    balanceAsOf: parsed.newest,
    creditLimit: type === 'Credit Card' ? room : null,
    overdraftLimit: type === 'Bank' ? room : null,
    // A revolving facility's undrawn amount: available is what can still be drawn.
    undrawn: type === 'Loan' && balance != null && available != null ? round2(Math.max(0, available)) : null,
  };
}
