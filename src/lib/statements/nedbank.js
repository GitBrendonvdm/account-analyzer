import { findAmounts, isoDateFromDmy, last4, longestDigitRun } from './amounts';
import { shapeAccount, typeFromName } from './fnb';

/**
 * Nedbank's "All balances" summary.
 *
 * It is an image, so what arrives here is OCR output, and every rule below is shaped by what OCR
 * gets wrong on the real page. The type column is usually lost; the row numbers come through as
 * "[4 [" or "6 ["; the cell borders as "|"; "BOND" can be "Bon"; the thousands separator can be a
 * thin space or nothing; whole rows of zeros can vanish into "HE oe". So a row is found by the one
 * thing OCR reads reliably — a long run of digits, the account number — and everything else is
 * placed relative to it: the description before it, the type (when it survived) after it, and the
 * LAST TWO amounts on the line as current and available, so a stray figure read out of the margin
 * cannot shift the columns. When the type column is gone the description is read for clues, and
 * the caller can do better still by passing the accounts the app already knows (see index.js).
 *
 * Nedbank prints what is owed on a bond as a positive number and on a card as a negative one. The
 * app has one convention — a liability is negative — and shapeAccount applies it from the type.
 *
 * A card shows up once per plastic. An AMEX and a VISA with the same balance and the same available
 * credit are one account with two numbers, and the app knows it by whichever number appears in the
 * transaction export — so the caller passes the masks it already knows and the merged entry adopts
 * the matching one.
 */

const MARKER = /nedbank|all balances|account description/i;
// Page furniture OCR returns alongside the rows: the title (with "summary" often mangled), the
// date line, the column header, and the bare date that opens the page.
const STRUCTURE =
  /account\s+(summary|mmmary)|all balances|^date\s*:|account description|account number|^\d{1,2}\/\d{1,2}\/\d{4}\b/i;
const DATE = /date\s*:?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i;
const ANY_DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;

// Loans before cards before everything else, so "Home loan" is never read as anything but a loan.
const TYPE_RULES = [
  [/home\s*loan|\bbond\b|mortgage/i, 'Loan', 'home'],
  [/personal\s*loan/i, 'Loan', 'personal'],
  [/vehicle|car\s*loan|\bmfc\b/i, 'Loan', 'vehicle'],
  [/\bloan\b/i, 'Loan', 'other'],
  [/amex|visa|credit|master/i, 'Credit Card', 'card'],
  [/current|cheque/i, 'Bank', 'cheque'],
  [/savings|investment|notice|fixed|deposit/i, 'Savings', 'savings'],
];

function typeFromColumn(text) {
  const words = String(text ?? '').replace(/[^A-Za-z ]+/g, ' ').trim();
  if (!words) return null;
  for (const [re, type, kind] of TYPE_RULES) {
    if (re.test(words)) return { type, kind };
  }
  return null;
}

/**
 * Strip what OCR makes of the row-number column and the cell borders. Pipes become spaces; a
 * leading run of brackets with a one- or two-digit number in it goes — but only a number followed
 * by a space or bracket, so a description or account number that starts with digits keeps them.
 */
function scrub(line) {
  return String(line ?? '')
    .replace(/\|/g, ' ')
    .replace(/^[\s[\]]*(?:\d{1,2}(?=[\s[\]]))?[\s[\]]*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A row, or `null` when the line has no account number on it. */
function readRow(raw) {
  const line = scrub(raw);
  const number = longestDigitRun(line);
  if (!number) return null;
  const amounts = findAmounts(line).filter((a) => a.index >= number.end);
  if (amounts.length < 2) return { error: 'Could not read both balances' };
  const [current, available] = amounts.slice(-2);

  const description = line.slice(0, number.index).trim();
  const column = typeFromColumn(line.slice(number.end, current.index));
  const { type, kind } = column ?? typeFromName(description);

  return {
    account: shapeAccount({
      bank: 'Nedbank',
      name: description || `Account *${last4(number.digits)}`,
      number: number.digits,
      type,
      kind,
      typeFrom: column ? 'column' : 'name',
      printedBalance: current.value,
      available: available.value,
    }),
  };
}

/**
 * Fold plastics onto one card. Two Credit Card rows with the same balance and available credit
 * are the same account; the merged entry keeps every number and leads with the one the app knows.
 */
function mergePlastics(accounts, knownMasks) {
  const known = new Set((knownMasks ?? []).map((m) => String(m).toLowerCase()));
  const out = [];
  const cards = new Map();
  for (const a of accounts) {
    if (a.type !== 'Credit Card') {
      out.push(a);
      continue;
    }
    const key = `${a.balance}|${a.available}`;
    const existing = cards.get(key);
    if (!existing) {
      cards.set(key, a);
      out.push(a);
      continue;
    }
    existing.numbers = [...existing.numbers, ...a.numbers];
    const preferred = existing.numbers.find((n) => known.has(last4(n).toLowerCase()));
    if (preferred && preferred !== existing.number) {
      existing.number = preferred;
      existing.last4 = last4(preferred);
    }
  }
  return out;
}

function readAsOf(lines) {
  for (const line of lines) {
    const m = line.match(DATE);
    if (m) return isoDateFromDmy(m[1], m[2], m[3]);
  }
  for (const line of lines) {
    const m = line.match(ANY_DATE);
    if (m) return isoDateFromDmy(m[1], m[2], m[3]);
  }
  return null;
}

export function looksLikeNedbank(lines) {
  return (lines ?? []).some((l) => MARKER.test(String(l ?? '')));
}

export function parseNedbank(lines, { asOf, knownMasks } = {}) {
  const list = (lines ?? []).map((l) => String(l ?? '').trim()).filter(Boolean);
  const accounts = [];
  const skipped = [];

  for (const line of list) {
    if (STRUCTURE.test(line)) continue;
    const row = readRow(line);
    if (!row) {
      skipped.push({ line, reason: 'Not an account row' });
      continue;
    }
    if (row.error) {
      skipped.push({ line, reason: row.error });
      continue;
    }
    accounts.push(row.account);
  }

  return {
    bank: 'Nedbank',
    asOf: readAsOf(list) ?? asOf ?? null,
    accounts: mergePlastics(accounts, knownMasks),
    skipped,
  };
}
