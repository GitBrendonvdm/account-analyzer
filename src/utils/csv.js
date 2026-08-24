import { normalizeTransactionAmount, parseAmount } from './amount';
import { isVault22Export, normaliseVault22Rows } from './vault22';

/**
 * Read an export into the row shape the rest of the app consumes.
 *
 * There are two exports in the world now: the one this app was built on, and the one Vault22
 * started producing in August 2026 — different column names, a positive amount with the direction
 * in a `Type` column, the account split into a name and a mask, and every settled transaction
 * shadowed by a stale `pending` copy. Rather than teach the pipeline two vocabularies, the newer
 * file is translated into the older one at the door (see utils/vault22.js), so everything
 * downstream — identity, dedupe, the account ledger, the forecasts — carries on unchanged.
 *
 * `accounts` are the accounts the app already knows. They matter because the new format no longer
 * writes the bank down: an account is recognised by its mask and keeps the name, and therefore the
 * identity, it already had.
 */

function splitRows(text) {
  const lines = String(text ?? '').split('\n');
  // A byte-order mark would otherwise become part of the first column's name.
  const headers = (lines[0] ?? '').replace(/^\uFEFF/, '').split(',').map((h) => h.trim());
  const rows = lines
    .slice(1)
    .filter((l) => l.length > 5)
    .map((row, idx) => {
      const values = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const o = { id: idx };
      headers.forEach((h, i) => {
        o[h] = values[i]?.replace(/^"|"$/g, '').trim();
      });
      return o;
    });
  return { headers, rows };
}

/**
 * @returns {{ rows, format: 'legacy'|'vault22-2026', duplicatesIgnored: number }}
 *          `duplicatesIgnored` is the stale pending copies, `repeatsCollapsed` the rows the file
 *          repeated verbatim. Both are reported rather than swallowed — worth
 *          reporting, because a file of 4 060 lines becoming 3 254 transactions should not be
 *          something the app does quietly.
 */
export function parseExport(text, { accounts = [] } = {}) {
  const { headers, rows } = splitRows(text);
  if (isVault22Export(headers)) {
    const { rows: canonical, dropped, repeats } = normaliseVault22Rows(rows, { accounts });
    return { rows: canonical, format: 'vault22-2026', duplicatesIgnored: dropped, repeatsCollapsed: repeats };
  }
  rows.forEach((o) => {
    o.AmountNum = normalizeTransactionAmount(o.Description, parseAmount(o.Amount));
  });
  return { rows, format: 'legacy', duplicatesIgnored: 0, repeatsCollapsed: 0 };
}

/** The rows alone, for the callers that only ever wanted those. */
export function parseCsv(text, options) {
  return parseExport(text, options).rows;
}
