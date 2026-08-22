import {
  SELF_ANCHOR_FIRST_ROWS,
  SELF_ANCHOR_MIN_DRAW,
  SELF_ANCHOR_MIN_MULTIPLE,
} from '../constants';
import { parseTransactionDate } from '../utils/date';
import { accountIdOf } from './accounts';
import { median } from './stats';

/**
 * Positions and balances, anchored at an as-of date.
 *
 * The export has no balance column, so the only thing the rows can give is a POSITION: the signed
 * sum of everything that happened, anchored at zero before the first row. A typed balance turns
 * that into a real figure through one offset — balance minus the position at the moment the
 * balance was true. The old code took "the moment the balance was true" to be whichever cycle
 * happened to be current, or the file's last row, which meant a balance typed on the 10th and an
 * export imported on the 20th silently re-anchored to the 20th: the balance drifted by ten days of
 * movement every time a new file arrived. Here the anchor is the record's own `balanceAsOf`,
 * falling back to the account's last row only when no date was recorded, and appending rows can
 * never move a balance that was stated for an earlier day.
 *
 * Loans can do better than a typed number. Three of the four in the real export begin with the
 * disbursement itself — one large draw, then instalments — so the position IS the balance, to the
 * cent, with no typing at all. `selfAnchored` recognises that shape and nothing looser: a loan
 * exported mid-life never qualifies, because its position is two years of movement and not a
 * debt.
 *
 * Signs follow the rows: negative is owed. `selfAnchored.balanceOwed` alone is a positive
 * magnitude, because it is handed straight to the debt modules, which say so in their JSDoc.
 */

const DAY_MS = 86400000;

const dateOf = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** A 'YYYY-MM-DD' string or a Date → midnight Date; null when unparseable. */
function toDay(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : midnight(value);
  const parsed = parseTransactionDate(String(value));
  return parsed ? midnight(parsed) : null;
}

function byDateKeyId(a, b) {
  const da = dateOf(a)?.getTime() ?? 0;
  const db = dateOf(b)?.getTime() ?? 0;
  if (da !== db) return da - db;
  const ka = a.key ?? '';
  const kb = b.key ?? '';
  if (ka !== kb) return ka < kb ? -1 : 1;
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Rows of one account, sorted by Date then key then id. Pick the account by a set of raw names or
 * by its stable id (`'bank|mask'`, which survives the export renaming the account). Rows whose
 * date cannot be read are dropped: a row that cannot be placed on the timeline cannot be positioned.
 */
export function accountRows(data, { rawNames = null, accountId = null } = {}) {
  if (!data?.length || (!rawNames && !accountId)) return [];
  const names = rawNames ? new Set(rawNames) : null;
  const ids = new Map();
  const idOf = (raw) => {
    if (!ids.has(raw)) ids.set(raw, accountIdOf(raw));
    return ids.get(raw);
  };
  return data
    .filter(
      (t) =>
        ((names && names.has(t.Account)) || (accountId && idOf(t.Account) === accountId)) &&
        dateOf(t),
    )
    .sort(byDateKeyId);
}

/** Cumulative signed AmountNum of rows with Date ≤ date ('YYYY-MM-DD' string or Date). Rows before the file → 0. */
export function positionAt(rows, date) {
  const at = toDay(date);
  if (!at) return 0;
  let sum = 0;
  for (const t of rows ?? []) {
    const d = dateOf(t);
    if (d && d <= at) sum += t.AmountNum;
  }
  return sum;
}

function lastRowDate(rows) {
  let last = null;
  for (const t of rows ?? []) {
    const d = dateOf(t);
    if (d && (!last || d > last)) last = d;
  }
  return last;
}

/**
 * offset = currentBalance − positionAt(rows, balanceAsOf ?? lastRowDate). null when currentBalance
 * is not finite. When balanceAsOf precedes the first row, the position at that date is 0 and the
 * offset is the balance itself. An account with no rows at all is simply its balance.
 */
export function anchorOffset(rows, account) {
  const balance = account?.currentBalance;
  if (balance == null || !Number.isFinite(balance)) return null;
  const at = toDay(account.balanceAsOf) ?? lastRowDate(rows);
  if (!at) return balance;
  return balance - positionAt(rows, at);
}

/** positionAt(rows, date) + offset, or null when the account's balance is unknown. */
export function balanceAt(rows, account, date) {
  const offset = anchorOffset(rows, account);
  if (offset == null) return null;
  return positionAt(rows, date) + offset;
}

/**
 * Closing position for every day in [from, to] inclusive, carried across quiet days, as
 * `[{ date, position }]` (length = days + 1). Rows before `from` are folded into the opening.
 */
export function dailyPositions(rows, from, to) {
  const start = toDay(from);
  const end = toDay(to);
  if (!start || !end || end < start) return [];
  const sorted = (rows ?? []).filter(dateOf).sort(byDateKeyId);
  let i = 0;
  let position = 0;
  while (i < sorted.length && dateOf(sorted[i]) < start) {
    position += sorted[i].AmountNum;
    i += 1;
  }
  const out = [];
  const days = Math.round((end - start) / DAY_MS);
  for (let k = 0; k <= days; k += 1) {
    const day = addDays(start, k);
    while (i < sorted.length && dateOf(sorted[i]) <= day) {
      position += sorted[i].AmountNum;
      i += 1;
    }
    out.push({ date: day, position });
  }
  return out;
}

const NOT_ANCHORED = { anchored: false, balanceOwed: null, disbursementDate: null, drawAmount: null };

/**
 * Loan self-anchoring. `anchored` when, within the first SELF_ANCHOR_FIRST_ROWS rows, a negative
 * row with |amount| ≥ max(SELF_ANCHOR_MIN_DRAW, SELF_ANCHOR_MIN_MULTIPLE × median(positive
 * non-rebate rows)) exists AND the cumulative position just before the first positive row is
 * ≤ −(SELF_ANCHOR_MIN_MULTIPLE × that median). Then `balanceOwed` = −positionAt(rows, lastRow) —
 * a POSITIVE magnitude — with an implied offset of 0.
 *
 * @returns {{ anchored:boolean, balanceOwed:number|null, disbursementDate:Date|null, drawAmount:number|null }}
 */
export function selfAnchored(rows) {
  const sorted = (rows ?? []).filter(dateOf).sort(byDateKeyId);
  if (!sorted.length) return { ...NOT_ANCHORED };
  const repayments = sorted
    .filter((t) => t.AmountNum > 0 && !/rebate/i.test(t.Description ?? ''))
    .map((t) => t.AmountNum);
  const typical = median(repayments);
  const threshold = Math.max(SELF_ANCHOR_MIN_DRAW, SELF_ANCHOR_MIN_MULTIPLE * typical);
  const draw = sorted
    .slice(0, SELF_ANCHOR_FIRST_ROWS)
    .find((t) => t.AmountNum < 0 && -t.AmountNum >= threshold);
  if (!draw) return { ...NOT_ANCHORED };

  const firstPositive = sorted.findIndex((t) => t.AmountNum > 0);
  const head = firstPositive < 0 ? sorted : sorted.slice(0, firstPositive);
  const before = head.reduce((s, t) => s + t.AmountNum, 0);
  if (before > -(SELF_ANCHOR_MIN_MULTIPLE * typical)) return { ...NOT_ANCHORED };

  return {
    anchored: true,
    balanceOwed: -positionAt(sorted, dateOf(sorted[sorted.length - 1])),
    disbursementDate: dateOf(draw),
    drawAmount: -draw.AmountNum,
  };
}
