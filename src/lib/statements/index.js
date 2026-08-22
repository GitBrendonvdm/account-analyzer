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
 * Which bank is decided by what the page says about itself: FNB's labels say "FNB" and "eBucks"
 * outright, and the only reliable Nedbank signal on a scan is the "All balances" title. Structure
 * alone is not enough, because a spaced FNB row and a Nedbank row have the same shape — name,
 * number, two amounts — so a page with no markers at all is tried both ways and the parser that
 * found accounts wins.
 *
 * One upload can hold both banks' pages. The lines are cut into runs at every line that names a
 * bank, each bank's run goes to its own parser, and the bank with more accounts is the statement.
 * The other bank's rows are not lost: they are reported under `skipped` as "Other bank's page",
 * so the preview can say what it saw and did not use.
 *
 * Each entry carries, beyond the figures: `typeFrom` ('label' for the bank's own account label,
 * 'column' for a type column, 'name' for a guess from a free-text description, 'record' for the
 * app's own account, 'user' for a type the user chose), `printedBalance` as read before the sign
 * rule, `signFromType` when that rule flipped it, and `line`, the text it was read from. Passing
 * `knownAccounts` lets every entry that the app already knows take the app's type before
 * anything is signed — see match.js.
 *
 * Pure by design: no DOM, no PDF library, no network. extract.js is the browser glue that produces
 * the lines; match.js is what pairs the result with the app's records.
 */

export { looksLikeFnb, parseFnb, typeFromName } from './fnb';
export { looksLikeNedbank, parseNedbank } from './nedbank';
export { matchStatement, adoptKnownTypes, externalRecord, patchIsNoop, SIGN_NOTE } from './match';

const OTHER_BANK = "Other bank's page";

function clean(lines) {
  return (lines ?? [])
    .map((l) => String(l ?? '').replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
}

function bankOf(line) {
  if (looksLikeFnb([line])) return 'FNB';
  if (looksLikeNedbank([line])) return 'Nedbank';
  return null;
}

/**
 * Cut the lines into runs, one per stretch of a bank's page. A line that names a bank opens a new
 * run when the bank changes; lines before the first such line belong to whichever bank comes
 * first. With no bank named anywhere there is one run with no bank.
 */
function splitByBank(lines) {
  const runs = [];
  const pending = [];
  for (const line of lines) {
    const bank = bankOf(line);
    const current = runs[runs.length - 1];
    if (bank && bank !== current?.bank) runs.push({ bank, lines: pending.splice(0) });
    if (runs.length === 0) pending.push(line);
    else runs[runs.length - 1].lines.push(line);
  }
  return runs.length > 0 ? runs : [{ bank: null, lines: pending }];
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
  const parseAs = (bank, subset) =>
    bank === 'FNB'
      ? parseFnb(subset, { asOf: fallback })
      : parseNedbank(subset, { asOf: fallback, knownMasks: masks });

  const runs = splitByBank(list);
  const banks = [...new Set(runs.map((r) => r.bank).filter(Boolean))];

  let parsed;
  if (banks.length === 0) {
    const fnb = parseAs('FNB', list);
    const nedbank = parseAs('Nedbank', list);
    if (fnb.accounts.length === 0 && nedbank.accounts.length === 0) {
      return { bank: null, asOf: fallback, accounts: [], skipped: [] };
    }
    parsed = fnb.accounts.length >= nedbank.accounts.length ? fnb : nedbank;
  } else if (banks.length === 1) {
    parsed = parseAs(banks[0], list);
  } else {
    const results = banks.map((bank) =>
      parseAs(bank, runs.filter((r) => r.bank === bank).flatMap((r) => r.lines)),
    );
    // Most accounts wins; a tie goes to the bank that appeared first. Sort is stable.
    results.sort((a, b) => b.accounts.length - a.accounts.length);
    const [winner, ...others] = results;
    const foreign = others.flatMap((o) => [
      ...o.accounts.map((a) => ({ line: a.line, reason: OTHER_BANK })),
      ...o.skipped,
    ]);
    parsed = { ...winner, skipped: [...winner.skipped, ...foreign] };
  }
  return adoptKnownTypes(parsed, known);
}
