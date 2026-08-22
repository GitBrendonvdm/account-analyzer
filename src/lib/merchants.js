import { MERGE_PREFIX_MIN_LENGTH } from '../constants';
/**
 * Who you actually paid.
 *
 * Everything in the app is grouped by category, which is how a bank thinks. People don't recognise
 * their own behaviour in "Groceries, R9 196" — they recognise it in "Checkers, 23 times". But the
 * raw descriptions can't be grouped as they stand: the same shop arrives as
 *
 *   Checkers Capegate Brackenfell Za
 *   Checkers Capegate ...
 *   Checkers Capegate 4**8899 *2122
 *
 * and a subscription arrives with its amount and billing date welded to the front:
 *
 *   199.99 Apple.Com/Bi 4**47 15 Jan *6443
 *   59.99 Apple.Com/Bil 4**47 07 Aug *3994
 *
 * So a description is stripped down to the part that identifies the merchant — leading amounts,
 * card masks, reference codes, billing dates, the trailing town and country all removed — and what
 * survives becomes the merchant key. It is deliberately conservative: two things that are really
 * one merchant may stay apart, but two different merchants should never merge.
 */

const COUNTRY = /\b(za|gb|us|nl|ie|sg|fr|de|mus|mie|rza|lza|nza|eza|gza)\b/gi;

/** South African place names that trail card descriptions and say nothing about the merchant. */
const PLACES = new RegExp(
  '\\b(cape ?town|capetown|brackenfell|johannesburg|pretoria|durbanville|kraaifontein|paarl|' +
    'milnerton|bellville|centurion|bloemfontein|stellenbosch|somerset ?west|claremont|' +
    'rondebosch|observatory|goodwood|montague|killarney|newlands|edenburg|bryanston|' +
    'sunninghill|elarduspark|elardus ?park|doornkloof|highveld|umhlanga|durban|sandton|' +
    'western ?cape|wc|eikenbosch|north ?pine|sea ?ppint|mowbray|london|los ?gatos|amsterdam|' +
    'singapore|internet|foreign)\\b',
  'gi',
);

const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/gi;

/** A token that's a reference, mask or code rather than a word. */
function isNoise(token) {
  if (!token) return true;
  if (/^\d/.test(token)) return true; //   199.99, 4711, 0587
  if (/[*#]/.test(token)) return true; //  *1234, 4**8899
  if (/^x+\d/i.test(token)) return true; // xx0125, x7944
  if (/\d/.test(token) && token.length >= 5) return true; // cart25d5d582fg2, dcrexxx5016
  if (/^(pty|ltd|inc|cc|co|the|and|of|at|u|cn|conv|sb|ma|hpr|crp|exp|fam)$/i.test(token)) return false;
  return false;
}

/** Strip a description down to the merchant. Returns '' when nothing identifying survives. */
export function merchantKeyOf(description) {
  let s = (description ?? '').toString();
  if (!s.trim()) return '';

  s = s
    .replace(/\.\.\.\s*$/, ' ')
    .replace(/^\s*[\d.,]+\s+/, ' ') //      leading amount: "199.99 Apple.Com/Bi"
    .replace(/\b4\*+\d+\b/g, ' ') //        card masks: 4**47, 4**8899
    .replace(/\*+\w*/g, ' ') //             *1234, *
    .replace(/\b\d{1,2}\s+(?=[a-z]{3}\b)/gi, ' ') // "15 Jan" → " Jan"
    .replace(MONTHS, ' ')
    .replace(COUNTRY, ' ')
    .replace(PLACES, ' ')
    .replace(/[_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = s
    .split(' ')
    .filter((t) => t.length > 0)
    .filter((t) => !isNoise(t));

  if (tokens.length === 0) return '';
  // Two tokens is usually the merchant and its branch ("Engen Capegate", "Pnp Hpr"); a third only
  // helps when the first two are very short.
  const take = tokens[0].length + (tokens[1]?.length ?? 0) <= 8 ? 3 : 2;
  return tokens.slice(0, take).join(' ').toLowerCase();
}

/** Title-case for display: "pnp hpr" → "Pnp Hpr". */
export function merchantLabel(key) {
  return key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Group rows by merchant.
 *
 * @param rows spend rows already filtered to the window and to real spend (no transfers)
 * @returns Map of merchant key → { key, label, items }
 */
export function groupByMerchant(rows) {
  const byKey = new Map();
  rows.forEach((t) => {
    const key = merchantKeyOf(t.Description);
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, { key, label: merchantLabel(key), items: [] });
    byKey.get(key).items.push(t);
  });
  return byKey;
}

/**
 * Map truncation variants onto one key.
 *
 * The same subscription arrives as "Apple.Com/Bi", "Apple.Com/Bil" and "Apple.Com/Bill" depending
 * on how much of the descriptor the bank kept that month, and `merchantKeyOf` faithfully produces
 * three keys. For recurrence that is fatal: three lines of four charges each, none of them monthly.
 * When key B starts with key A, both share the first token and A is long enough to be specific
 * (MERGE_PREFIX_MIN_LENGTH), B is folded onto A. Keys that merely share a first token — two Engen
 * forecourts — are NOT merged, and a short key like "spar" is never a prefix of anything.
 *
 * @param {Iterable<string>} keys
 * @returns {Map<string, string>} every key → its canonical key (itself when nothing merged)
 */
export function mergePrefixKeys(keys) {
  const distinct = [...new Set([...keys].filter(Boolean))].sort(
    (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  const canonical = new Map();
  const anchors = [];
  distinct.forEach((key) => {
    const first = key.split(' ')[0];
    const anchor = anchors.find(
      (a) => key.startsWith(a) && a.split(' ')[0] === first && a.length >= MERGE_PREFIX_MIN_LENGTH,
    );
    if (anchor) {
      canonical.set(key, canonical.get(anchor));
    } else {
      canonical.set(key, key);
      anchors.push(key);
    }
  });
  return canonical;
}

/** /^1sa\b/i on the raw description — a person-to-person payment whose key would be someone's name. */
export function isPersonPayment(description) {
  return /^1sa\b/i.test((description ?? '').toString().trim());
}

export const PERSON_LABEL = 'Payment to a person';
