import { round2 } from './amounts';

/**
 * FNB's official account statement — the PDF the bank sends, not the history file you download.
 *
 * It is the one document that is the bank's final word: an opening balance, every line with the
 * balance it left, a closing balance, and the bank's own count and total of what came in and went
 * out. That makes it a ruler. The app's ledger can be held against it, line for line, and where
 * the two disagree one of them is missing something.
 *
 * READING IT BY COLUMN. The table cannot be read as lines of text. A description may contain an
 * amount ("POS Purchase 199.99 Apple.Com/Bi"), the amount column carries a `Cr` that says which
 * way money moved and the balance column reuses the same letters for a different meaning, and a
 * fee line has no description at all. What tells a description's 199.99 from the amount's 199.99
 * is where it sits on the page, so this takes positioned items (extract.js `extractItems`) and
 * finds the columns from the header row — Description, Amount, Balance, Accrued Bank Charges — on
 * each page, not from constants, so a statement laid out a little differently still reads.
 *
 * SIGNS. Amount: `Cr` is money in, anything else money out. Balance: `Cr` is in credit, no suffix
 * is overdrawn. A line whose amount is a credit but whose balance did not move is the bank telling
 * you about a collection that did not happen (an unpaid debit order, printed as a credit); it is
 * kept, marked `nonPosting`, and excluded from the totals — exactly as the bank excludes it from
 * its own turnover figures.
 *
 * THE STATEMENT PROVES ITSELF. Every line's balance must be the line before it plus its amount,
 * the last must be the closing balance, and the count and sum of credits and of debits must be
 * the bank's turnover figures. `checks` says which held, and a line that broke the chain is
 * `verified: false` so a mis-read is never presented as a fact.
 *
 * Cheque and savings layouts only: that is the one layout seen. A card or loan statement is
 * reported as unsupported rather than guessed at.
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE_CELL = /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i;
const MONEY = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*(Cr|Dr)?$/i;
const ROW_TOLERANCE = 2.5;

const dayIso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function moneyOf(text) {
  const m = String(text ?? '').trim().match(MONEY);
  if (!m) return null;
  return { value: Number(`${m[1].replace(/,/g, '')}.${m[2]}`), suffix: m[3] ? m[3].toLowerCase() : null };
}

/** "8 September 2026" → "2026-09-08" */
function longDate(text) {
  const m = String(text ?? '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  const month = m && MONTHS[m[2].slice(0, 3).toLowerCase()];
  return month ? dayIso(m[3], month, Number(m[1])) : null;
}

/** Group a page's items into visual rows, top to bottom, each left to right. */
function rowsOf(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - item.y) <= ROW_TOLERANCE) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

const textOf = (row) => row.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();

export function looksLikeFnbStatement(pages) {
  const text = (pages ?? []).flatMap((p) => p.items.map((i) => i.str)).join(' ');
  return /Statement Period\s*:/i.test(text) && /Opening Balance/i.test(text) && /Closing Balance/i.test(text);
}

/** The column anchors on one page, from its own header row; null when the page has no table header. */
function columnsOn(items) {
  const named = (s) => items.filter((i) => i.str.trim().toLowerCase() === s);
  // "Date" also appears in the page footer, so the header's words are the ones that share its row.
  const amount = named('amount')[0];
  if (!amount) return null;
  const onRow = (s) => named(s).find((i) => Math.abs(i.y - amount.y) < 6);
  const description = onRow('description');
  const balance = onRow('balance');
  const date = onRow('date');
  if (!description || !balance || !date) return null;
  // "Accrued / Bank / Charges" is a three-line header; its widest-spread word marks the column's edge.
  const accrued = named('accrued').find((i) => Math.abs(i.y - amount.y) < 20);
  return {
    y: Math.max(date.y, amount.y),
    dateX: date.x,
    descriptionX: description.x,
    amountFrom: amount.x - 12,
    balanceFrom: balance.x - 8,
    accruedFrom: accrued ? accrued.x - 5 : Infinity,
  };
}

function yearFor(day, month, from, to) {
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
  for (const y of years) {
    const iso = dayIso(y, month, day);
    if (iso >= from && iso <= to) return iso;
  }
  return dayIso(to.slice(0, 4), month, day);
}

/**
 * @param {{ items: { str: string, x: number, y: number, width: number }[] }[]} pages
 * @returns {{
 *   ok: boolean, reason?: string,
 *   account: { number: string, last4: string, name: string },
 *   period: { from: string, to: string }, statementDate: string|null, statementNumber: string|null,
 *   opening: number|null, closing: number|null, facilityLimit: number|null,
 *   lines: { date, description, amount, balance, accrued, nonPosting, verified, page }[],
 *   turnover: { credits: { count, sum }|null, debits: { count, sum }|null },
 *   counted: { credits: { count, sum }, debits: { count, sum } },
 *   checks: { chain: boolean, closing: boolean, turnover: boolean },
 *   warnings: string[]
 * }}
 */
export function parseFnbStatement(pages) {
  if (!looksLikeFnbStatement(pages)) return { ok: false, reason: 'Not an FNB account statement' };

  const allRows = pages.map((p) => rowsOf(p.items));
  const flat = allRows.flat();
  const warnings = [];

  const joined = flat.map(textOf).join('\n');
  // "FNB Fusion Private Clients Acc : 62513359986" is one cell on the page, beside other cells on
  // the same row, so it is read per cell and not from the row's joined text.
  const acc = pages
    .flatMap((p) => p.items)
    .map((i) => i.str.trim().match(/^([A-Za-z][A-Za-z0-9 &.\-/]*?)\s*:\s*(\d{9,})$/))
    .filter(Boolean)
    // The page footer carries a bare reference ("XSTZFN0:62513359986"); the product name has spaces.
    .sort((a, b) => Number(/\s/.test(b[1])) - Number(/\s/.test(a[1])))[0];
  const period = joined.match(/Statement Period\s*:\s*(.+?)\s+to\s+(.+?)\s*$/im);
  const from = period ? longDate(period[1]) : null;
  const to = period ? longDate(period[2]) : null;
  if (!acc || !from || !to) return { ok: false, reason: 'The account number or the statement period could not be read' };

  const findMoney = (label) => {
    for (const row of flat) {
      const at = row.items.findIndex((i) => i.str.trim().toLowerCase().startsWith(label));
      if (at < 0) continue;
      const labelItem = row.items[at];
      const cell = row.items.slice(at + 1).find((i) => moneyOf(i.str) && i.x > labelItem.x);
      const value = cell && moneyOf(cell.str);
      if (value) return value;
      // "3,771.37" and "Cr" printed as two items.
      const next = row.items.slice(at + 1).find((i) => /^[\d,]+\.\d{2}$/.test(i.str.trim()));
      if (next) {
        const after = row.items[row.items.indexOf(next) + 1];
        return { value: Number(next.str.replace(/,/g, '')), suffix: /^(cr|dr)$/i.test(after?.str.trim() ?? '') ? after.str.trim().toLowerCase() : null };
      }
    }
    return null;
  };
  const signed = (m, creditSuffix = 'cr') => (m ? (m.suffix === creditSuffix ? m.value : -m.value) : null);
  const opening = signed(findMoney('opening balance'));
  const closing = signed(findMoney('closing balance'));
  const facility = findMoney('facility limit');

  const turnoverOf = (label) => {
    for (const row of flat) {
      const cell = row.items
        .map((i) => i.str.match(new RegExp(`no\\.\\s*${label}\\s+transactions\\s+(\\d+)`, 'i')))
        .find(Boolean);
      const sum = row.items.map((i) => moneyOf(i.str)).find((m) => m && m.suffix);
      if (cell && sum) return { count: Number(cell[1]), sum: sum.value };
    }
    return null;
  };

  // ---- the table, page by page --------------------------------------------------------------
  const lines = [];
  let sawTable = false;
  pages.forEach((page, pageIndex) => {
    const cols = columnsOn(page.items);
    if (!cols) return;
    sawTable = true;
    let previous = null;
    for (const row of allRows[pageIndex]) {
      if (row.y >= cols.y - 1) continue; // above or on the header
      const text = textOf(row);
      if (/closing balance|turnover for statement|^page \d+ of/i.test(text)) break;
      const first = row.items[0];
      const dateMatch = first && first.x < cols.descriptionX - 4 ? first.str.trim().match(DATE_CELL) : null;
      const inDescription = row.items.filter((i) => i !== (dateMatch ? first : null) && i.x < cols.amountFrom);
      if (!dateMatch) {
        // A wrapped description: text in the description column, nothing in the numeric ones, close under the line above.
        const numeric = row.items.some((i) => i.x >= cols.amountFrom);
        if (previous && !numeric && inDescription.length && previous.y - row.y < 14 && !/^(accrued|bank|charges)$/i.test(text)) {
          previous.description = `${previous.description} ${inDescription.map((i) => i.str).join(' ')}`.replace(/\s+/g, ' ').trim();
          previous.y = row.y;
        }
        continue;
      }
      const amountCell = row.items.find((i) => i.x >= cols.amountFrom && i.x < cols.balanceFrom);
      const balanceCell = row.items.find((i) => i.x >= cols.balanceFrom && i.x < cols.accruedFrom);
      const accruedCell = row.items.find((i) => i.x >= cols.accruedFrom);
      const amount = amountCell && moneyOf(amountCell.str);
      const balance = balanceCell && moneyOf(balanceCell.str);
      if (!amount || !balance) {
        warnings.push(`A line on page ${pageIndex + 1} could not be read: ${text}`);
        continue;
      }
      const [, day, mon] = dateMatch;
      previous = {
        date: yearFor(Number(day), MONTHS[mon.slice(0, 3).toLowerCase()], from, to),
        description: inDescription.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
        amount: amount.suffix === 'cr' ? amount.value : -amount.value,
        balance: balance.suffix === 'cr' ? balance.value : -balance.value,
        accrued: accruedCell && moneyOf(accruedCell.str) ? moneyOf(accruedCell.str).value : null,
        nonPosting: false,
        verified: true,
        page: pageIndex + 1,
        y: row.y,
      };
      lines.push(previous);
    }
  });
  if (!sawTable) return { ok: false, reason: 'This statement has no transaction table the app can read (card and loan statements are not supported yet)' };

  // ---- prove it -----------------------------------------------------------------------------
  let running = opening;
  let chain = opening != null;
  lines.forEach((line) => {
    delete line.y;
    if (running == null) return;
    if (round2(running + line.amount) === round2(line.balance)) {
      running = line.balance;
    } else if (round2(running) === round2(line.balance)) {
      // The amount did not move the balance: the bank's notice of something that did not happen.
      line.nonPosting = true;
    } else {
      line.verified = false;
      chain = false;
      running = line.balance;
    }
  });

  const counted = { credits: { count: 0, sum: 0 }, debits: { count: 0, sum: 0 } };
  lines.forEach((line) => {
    if (line.nonPosting) return;
    const side = line.amount > 0 ? counted.credits : counted.debits;
    side.count += 1;
    side.sum = round2(side.sum + Math.abs(line.amount));
  });
  const turnover = { credits: turnoverOf('credit'), debits: turnoverOf('debit') };
  const agrees = (a, b) => !b || (a.count === b.count && round2(a.sum) === round2(b.sum));
  const checks = {
    chain: chain && lines.length > 0,
    closing: closing != null && lines.length > 0 && round2(lines[lines.length - 1].balance) === round2(closing),
    turnover: agrees(counted.credits, turnover.credits) && agrees(counted.debits, turnover.debits),
  };
  if (!checks.chain) warnings.push('The running balance does not follow line to line, so some lines may have been misread');
  if (!checks.turnover) warnings.push("The count or total of lines does not match the statement's own turnover figures");

  const number = acc[2];
  return {
    ok: true,
    account: { number, last4: number.slice(-4), name: acc[1].trim() },
    period: { from, to },
    statementDate: longDate(joined.match(/Statement Date\s*:\s*(.+)/i)?.[1]),
    statementNumber: joined.match(/Statement Number\s*:\s*(\S+)/i)?.[1] ?? null,
    opening,
    closing,
    facilityLimit: facility?.value ?? null,
    lines,
    turnover,
    counted,
    checks,
    warnings,
  };
}
