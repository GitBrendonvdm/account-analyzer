import { todayIso } from './amounts';
import { looksLikeFnb, parseFnb } from './fnb';
import { adoptKnownTypes } from './match';
import { looksLikeNedbank, parseNedbank } from './nedbank';

/**
 * One entry point for an uploaded account summary, whichever bank printed it.
 *
 * The transaction export tells the app what moved; it never says what an account HOLDS, and the
 * balances editor asks the user to type that in by hand. The bank's own overview page has every
 * balance on it already. This turns the lines of that page — extracted text or OCR, the caller
 * decides — into account entries in the app's own shape and sign convention, so that a match
 * against the accounts the export created is a comparison of two numbers, nothing more.
 *
 * Which bank is decided by what the page says about itself, FNB first: its labels say "FNB" and
 * "eBucks" outright, while the only reliable Nedbank signal on a scan is the "All balances" title.
 * Structure alone is not enough, because a spaced FNB row and a Nedbank row have the same shape —
 * name, number, two amounts — so a page with no markers at all is tried both ways and the parser
 * that found accounts wins.
 *
 * Each entry carries, beyond the figures: `typeFrom` ('label' for the bank's own account label,
 * 'column' for a type column, 'name' for a guess from a free-text description, 'record' for the
 * app's own account, 'user' for a type the user chose), `printedBalance` as read before the sign
 * rule, and `signFromType` when that rule flipped it. Passing `knownAccounts` lets every entry
 * that the app already knows take the app's type before anything is signed — see match.js.
 *
 * Pure by design: no DOM, no PDF library, no network. extract.js is the browser glue that produces
 * the lines; match.js is what pairs the result with the app's records.
 */

export { looksLikeFnb, parseFnb, typeFromName } from './fnb';
export { looksLikeNedbank, parseNedbank } from './nedbank';
export { matchStatement, adoptKnownTypes, externalRecord, SIGN_NOTE } from './match';

function clean(lines) {
  return (lines ?? [])
    .map((l) => String(l ?? '').replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
}

/**
 * @param {string[]} lines   text lines in reading order
 * @param {object}   options `asOf` is the date to stamp on a statement that carries none (FNB's
 *                           does not); `knownAccounts` are the app's account records, used for
 *                           typing and for which plastic a card should lead with; `knownMasks` is
 *                           the older form of the latter and still honoured.
 */
export function parseStatement(lines, { asOf, knownMasks, knownAccounts } = {}) {
  const list = clean(lines);
  const fallback = asOf ?? todayIso();
  const known = knownAccounts ?? [];
  const masks = [...(knownMasks ?? []), ...known.map((a) => a?.mask)].filter(Boolean);

  let parsed;
  if (looksLikeFnb(list)) {
    parsed = parseFnb(list, { asOf: fallback });
  } else if (looksLikeNedbank(list)) {
    parsed = parseNedbank(list, { asOf: fallback, knownMasks: masks });
  } else {
    const fnb = parseFnb(list, { asOf: fallback });
    const nedbank = parseNedbank(list, { asOf: fallback, knownMasks: masks });
    if (fnb.accounts.length === 0 && nedbank.accounts.length === 0) {
      return { bank: null, asOf: fallback, accounts: [], skipped: [] };
    }
    parsed = fnb.accounts.length >= nedbank.accounts.length ? fnb : nedbank;
  }
  return adoptKnownTypes(parsed, known);
}
