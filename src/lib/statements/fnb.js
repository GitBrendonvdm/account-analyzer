import { headroom, last4, parseZar } from './amounts';

/**
 * FNB's "My Bank Accounts" overview.
 *
 * The PDF has a text layer, which sounds like the easy case until you extract it. Stitched back
 * into lines by position, a row reads "FNB Gold Cheque Account 62…9986 R -9,341.97 R 8,956.43" —
 * name, number, balance, available. Stitched by a naive extractor the same row is one string with
 * the cells run together and the columns the other way round: "R 8,956.43R -9,341.9762…9986FNB
 * Gold Cheque Account". Both layouts have been seen from the same file, so both are read here,
 * and the section headings ("Day To Day", "Loans") are never relied on for the TYPE of an account,
 * because the run-together layout scrambles their order: the type comes from the bank's own label.
 *
 * The limits are not printed at all but follow from the two columns: available credit plus what
 * is owed is a card's limit, and for a cheque account in the red the same sum is the overdraft.
 */

const CURRENCY = '(R|eB|[$\\u20ac\\u00a3])';
const AMT = '(-?\\s?[\\d,]+\\.\\d{2})';
// An account number: seven or more digits, possibly with the middle masked by asterisks, ending in
// the four digits the app keys accounts on.
const NUMBER = '([\\d*]{3,}\\d{4})';

// Cells run together: available, balance, number, name.
const ROW_RUN = new RegExp(
  `^\\s*${CURRENCY}\\s*${AMT}\\s*${CURRENCY}\\s*${AMT}\\s*${NUMBER}\\s*(.+?)\\s*$`,
);
// Cells separated: name, number, balance, available.
const ROW_SPACED = new RegExp(
  `^\\s*(.+?)\\s+${NUMBER}\\s+${CURRENCY}\\s*${AMT}\\s+${CURRENCY}\\s*${AMT}\\s*$`,
);

// Structure, not data: section headings, the column header in either layout, and section totals.
const HEADING =
  /^(my bank accounts|day to day|rewards|global accounts|savings and investments|smart device|loans|investments|credit cards?|transact)$/i;
const COLUMN_HEADER = /account name\s*account number|available balance\s*balance\s*account number/i;
const TOTAL = /^total\b|\btotal\s*$/i;
const MARKER =
  /\bfnb\b|ebucks|my bank accounts|account name\s*account number|available balance\s*balance\s*account number/i;

const MARQUE =
  /\b(mazda|toyota|volkswagen|vw|ford|bmw|mercedes|audi|hyundai|kia|honda|nissan|suzuki|renault|haval|chery|isuzu|mahindra|gwm|peugeot|jeep|volvo|subaru|mitsubishi|land rover|range rover|polo|golf|corolla|fortuner|hilux|ranger|datsun|opel|fiat|porsche|lexus|jaguar|mini|tata|baic|omoda|jetour|byd)\b/i;

const LIABILITY = new Set(['Credit Card', 'Loan']);

/**
 * What kind of account a name describes. FNB's labels are the bank's own and say it outright;
 * Nedbank's descriptions are the user's ("Private Bundle", "MiGoals") and reach this only when OCR
 * has lost the type column, so the vocabulary includes what those look like — and what OCR makes
 * of them: "Bon" for "BOND".
 */
export function typeFromName(name) {
  const n = String(name ?? '');
  if (/credit\s*card|plastic/i.test(n)) return { type: 'Credit Card', kind: 'card' };
  if (/home\s*loan|\bbond?\b|mortgage/i.test(n)) return { type: 'Loan', kind: 'home' };
  // "Load" is the bank's own typo for a vehicle loan — "Mazda Cx5 Load" — and it is in the data.
  if (/\bloan\b|\bload\b|vehicle|\bcar\b/i.test(n)) {
    if (/vehicle|\bcar\b/i.test(n) || MARQUE.test(n)) return { type: 'Loan', kind: 'vehicle' };
    if (/personal/i.test(n)) return { type: 'Loan', kind: 'personal' };
    return { type: 'Loan', kind: 'other' };
  }
  if (/cheque|current|bundle|migoals/i.test(n)) return { type: 'Bank', kind: 'cheque' };
  if (/savings|\bsave\b|\bfund\b|annuity|investment|retirement|notice|money\s*market|unit\s*trust|tax.?free/i.test(n)) {
    const investment = /annuity|investment|retirement|unit\s*trust|tax.?free|share/i.test(n);
    return { type: 'Savings', kind: investment ? 'investment' : 'savings' };
  }
  return { type: 'Other', kind: null };
}

/**
 * The one account shape both parsers emit, with the app's sign convention applied: a liability is
 * what is owed, negative, whichever way the bank printed it. `printedBalance` keeps the figure as
 * read so the account can be re-typed later (by a known record, or by the user) and re-signed from
 * the original rather than from a sign this rule already changed. `signFromType` says the rule
 * flipped it, so the preview can say so.
 */
export function shapeAccount({ bank, name, number, numbers, type, kind, typeFrom, printedBalance, available }) {
  const liability = LIABILITY.has(type);
  const signed = liability ? -Math.abs(printedBalance) : printedBalance;
  const balance = signed === 0 ? 0 : signed;
  const room = headroom(balance, available);
  return {
    bank,
    name,
    number,
    numbers: numbers ?? [number],
    last4: last4(number),
    type,
    kind,
    typeFrom,
    balance,
    printedBalance,
    available,
    creditLimit: type === 'Credit Card' ? room : null,
    overdraftLimit: type === 'Bank' ? room : null,
    signFromType: liability && printedBalance > 0,
    currency: 'ZAR',
  };
}

export function looksLikeFnb(lines) {
  return (lines ?? []).some((l) => MARKER.test(l));
}

function readRow(line) {
  const run = line.match(ROW_RUN);
  if (run) {
    const [, cur1, available, cur2, balance, number, name] = run;
    return { name, number, currencies: [cur1, cur2], balance, available };
  }
  const spaced = line.match(ROW_SPACED);
  if (spaced) {
    const [, name, number, cur1, balance, cur2, available] = spaced;
    return { name, number, currencies: [cur1, cur2], balance, available };
  }
  return null;
}

export function parseFnb(lines, { asOf } = {}) {
  const accounts = [];
  const skipped = [];

  for (const raw of lines ?? []) {
    const line = String(raw ?? '').trim();
    if (!line) continue;
    if (HEADING.test(line) || COLUMN_HEADER.test(line) || TOTAL.test(line)) continue;

    const row = readRow(line);
    if (!row) {
      skipped.push({ line, reason: 'Not an account row' });
      continue;
    }
    const { name, number, currencies } = row;
    if (currencies.includes('eB')) {
      skipped.push({ line, reason: 'rewards points, not money' });
      continue;
    }
    if (currencies.some((c) => c !== 'R')) {
      skipped.push({ line, reason: 'foreign currency, not imported' });
      continue;
    }
    const printedBalance = parseZar(row.balance);
    const available = parseZar(row.available);
    if (printedBalance == null || available == null) {
      skipped.push({ line, reason: 'Could not read the balance' });
      continue;
    }
    const { type, kind } = typeFromName(name);
    accounts.push(
      shapeAccount({ bank: 'FNB', name, number, type, kind, typeFrom: 'label', printedBalance, available }),
    );
  }

  // Nothing on the page says when it was printed, so the caller's date (today, at upload) stands.
  return { bank: 'FNB', asOf: asOf ?? null, accounts, skipped };
}
