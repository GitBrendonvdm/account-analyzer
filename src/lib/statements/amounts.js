/**
 * Reading money, account numbers and dates out of text that was never meant for a machine.
 *
 * The two sources could not be less alike. FNB's overview has a real text layer, so its figures
 * arrive exactly as printed — "R -9,341.97" — but depending on how the cells were stitched back
 * into lines the only thing separating a balance from the account number next to it can be the
 * two decimals. Nedbank's is an image, and what comes back from OCR is an approximation: "R1 761.12"
 * with a thin space for the thousands, or "R1761.12" with none, "- R117 863.55" or "-R117 863.55"
 * for a negative, and the rand sign itself read as "Rr", "B" or "8", or lost altogether. Everything
 * here accepts that noise rather than rejecting the page, because a balance the user has to check
 * is still worth more than one they have to type.
 */

// Thousands separators as they actually arrive: comma (FNB), space, no-break space, thin space and
// narrow no-break space (all seen from OCR), or nothing at all.
const SEP = '[ ,\\u00a0\\u2009\\u202f]';
const SPACE_SEPS = /[ \u00a0\u2009\u202f]+/;

// An integer part is either thousand-groups — the first of which may run to four digits, see the
// OCR note in `normaliseInt` — or a bare run of digits. Groups are exactly three digits so that a
// space-separated amount can never swallow the account number sitting next to it.
const INT = `(?:\\d{1,4}(?:${SEP}\\d{3})+|\\d+)`;

// Sign before or after the currency letters, currency letters optional and up to two of them ("R",
// "eB", or OCR's "Rr"), then the integer part and exactly two decimals.
const AMOUNT = `(-)?\\s*(?:[A-Za-z]{1,2})?\\s*(-)?\\s*(${INT})\\.(\\d{2})`;
const WHOLE = new RegExp(`^\\s*${AMOUNT}\\s*$`);
const EVERY = new RegExp(`${AMOUNT}(?!\\d)`, 'g');

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * OCR occasionally reads the rand sign as a digit, giving "8117 863.55" for "R117 863.55". A real
 * four-digit leading group would have been printed "8 117 863.55", so a four-digit group ahead of
 * three-digit groups can only be the currency symbol — drop it. A bare run of digits is left alone
 * because there is nothing to tell "8117863.55" apart from a genuine eight million.
 */
function normaliseInt(intPart) {
  const groups = intPart.split(SPACE_SEPS);
  if (groups.length > 1 && groups[0].length === 4 && groups.slice(1).every((g) => g.length === 3)) {
    groups[0] = groups[0].slice(1);
  }
  return groups.join('').replace(/,/g, '');
}

function toNumber([, neg1, neg2, intPart, dec]) {
  const value = Number(`${normaliseInt(intPart)}.${dec}`);
  if (!Number.isFinite(value)) return null;
  const signed = neg1 || neg2 ? -value : value;
  // "-0.00" is a zero balance, not a debt of nothing.
  return signed === 0 ? 0 : signed;
}

/** One amount, the whole string. `null` when it is not money. */
export function parseZar(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(WHOLE);
  return m ? toNumber(m) : null;
}

/**
 * Every amount in a line, in order, with where it sits so a caller can slice the text around it.
 * The trailing digit guard means this is for text with separators — for FNB's run-together cells
 * the two decimals are the only boundary, and fnb.js reads those left to right instead.
 */
export function findAmounts(line) {
  const out = [];
  if (typeof line !== 'string') return out;
  for (const m of line.matchAll(EVERY)) {
    const value = toNumber(m);
    if (value == null) continue;
    // The pattern may open on the whitespace ahead of the figure; report where the figure starts.
    const raw = m[0].trimStart();
    const index = m.index + (m[0].length - raw.length);
    out.push({ value, index, end: index + raw.length, raw });
  }
  return out;
}

/** The mask the app keys accounts on: the trailing digits of an account number, at most four. */
export function last4(number) {
  const m = String(number ?? '').match(/(\d{1,4})\s*$/);
  return m ? m[1] : '';
}

/**
 * Every run of `min`–`max` digits that is an account number and not part of something else: not
 * inside a longer run, not glued to a letter (an OCR'd "R1761" is money), and not followed by a
 * decimal point (so "2747082.69" with its separators lost is still an amount). Seven is the floor
 * because FNB numbers a retirement annuity with nine digits and OCR can lose one more.
 */
export function digitRuns(text, min = 7, max = 16) {
  const out = [];
  if (typeof text !== 'string') return out;
  const re = new RegExp(`(?<![\\dA-Za-z.])\\d{${min},${max}}(?!\\d|\\.\\d)`, 'g');
  for (const m of text.matchAll(re)) {
    out.push({ digits: m[0], index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The longest such run, first one winning a tie. */
export function longestDigitRun(text, min = 7, max = 16) {
  return digitRuns(text, min, max).reduce(
    (best, run) => (best == null || run.digits.length > best.digits.length ? run : best),
    null,
  );
}

/**
 * How much further an account can go: available minus balance. For a card that is the limit
 * (available credit plus what is owed); for a cheque account with an overdraft it is the facility.
 * Anything that is not positive is not a facility, so it is `null` rather than a misleading zero.
 */
export function headroom(balance, available) {
  if (typeof balance !== 'number' || typeof available !== 'number') return null;
  const room = round2(available - balance);
  return room > 0 ? room : null;
}

/** "22", "08", "2026" → "2026-08-22"; `null` if the parts do not make a date. */
export function isoDateFromDmy(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today in the user's own timezone, not UTC — the date on the statement is a local one. */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
