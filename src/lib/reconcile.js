import { accountRows, balanceAt } from './ledger';
import { round2 } from './statements/amounts';

/**
 * Holding the app against the bank.
 *
 * A STATEMENT (statements/ledgerStatement.js) is the bank's final word on a period: where the
 * account stood at each end, and every line in between. `reconcileStatement` lays the app's
 * ledger over it. Balances are compared first — they are the quick answer to "do we agree?" —
 * and then line by line, because two ledgers can agree on a balance for the wrong reasons (one
 * missing line cancelled by one extra) and the lines are what the reader can act on.
 *
 * (The running balance inside a history FILE is checked where the file is read — see
 * statements/history.js — and not here: the bank processes lines out of date order, so a balance
 * per date is not a number the bank ever printed.)
 *
 * THE LEDGER IS ANCHORED ON ONE BALANCE (see ledger.js): the account's stated balance on its stated
 * day, with everything before it derived by subtracting rows. So a disagreement at an early date
 * means the rows AFTER that date are wrong, not the ones before. Every message here is worded that
 * way round.
 *
 * Lines are paired as the importer pairs them — same account, same amount to the cent, dated
 * within two days, nearest first, each used once — so a line the importer would have recognised
 * as already held is also a line the reconciliation counts as present.
 */

const DAY_MS = 86400000;
const WINDOW_DAYS = 2;
const cents = (n) => Math.round((Number(n) || 0) * 100);
const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

/**
 * @param statement  parseFnbStatement(...) with ok: true
 * @param data       every row (the app's transactions)
 * @param accounts   the app's account records
 * @returns {{
 *   matched: boolean, account: object|null, reason?: string,
 *   pairs: { line, row }[], missing: object[], extra: object[],
 *   balances: { opening: Check, closing: Check },
 *   net: { statement: number, app: number, difference: number },
 *   verdict: 'agrees'|'differs'|'unchecked'
 * }}  where Check = { statement: number|null, app: number|null, difference: number|null, agrees: boolean|null }
 */
export function reconcileStatement(statement, data, accounts) {
  if (!statement?.ok) return { matched: false, account: null, reason: statement?.reason ?? 'Not a statement', verdict: 'unchecked' };
  const candidates = (accounts ?? []).filter((a) => a.mask && a.mask === statement.account.last4);
  // FNB's own accounts first: a Nedbank account can share a last four.
  const account = candidates.find((a) => /fnb/i.test(a.bank ?? '')) ?? candidates[0] ?? null;
  if (!account) {
    return {
      matched: false,
      account: null,
      reason: `No account ending ${statement.account.last4} — import its transaction history first`,
      verdict: 'unchecked',
    };
  }

  const rows = accountRows(data, { accountId: account.id });
  const { from, to } = statement.period;
  const inWindow = rows.filter((r) => r.Date > from && r.Date <= to);
  const lines = statement.lines.filter((l) => !l.nonPosting);

  // ---- line against line ---------------------------------------------------------------------
  const free = inWindow.map((row) => ({ row, cents: cents(row.AmountNum), day: dayNumber(row.Date), used: false }));
  const pairs = [];
  const missing = [];
  lines.forEach((line) => {
    const want = cents(line.amount);
    const day = dayNumber(line.date);
    let best = null;
    for (const candidate of free) {
      if (candidate.used || candidate.cents !== want) continue;
      const gap = Math.abs(candidate.day - day);
      if (gap > WINDOW_DAYS) continue;
      if (!best || gap < best.gap) best = { candidate, gap };
    }
    if (best) {
      best.candidate.used = true;
      pairs.push({ line, row: best.candidate.row });
    } else {
      missing.push(line);
    }
  });
  const extra = free.filter((c) => !c.used).map((c) => c.row);

  // ---- balance against balance ---------------------------------------------------------------
  const compare = (statementValue, date) => {
    const app = balanceAt(rows, account, date);
    if (statementValue == null || app == null) {
      return { statement: statementValue ?? null, app: app ?? null, difference: null, agrees: null };
    }
    const difference = round2(app - statementValue);
    return { statement: statementValue, app: round2(app), difference, agrees: difference === 0 };
  };
  const balances = {
    opening: compare(statement.opening, from),
    closing: compare(statement.closing, to),
  };

  const sum = (xs) => round2(xs.reduce((s, x) => s + x, 0));
  const net = {
    statement: sum(lines.map((l) => l.amount)),
    app: sum(inWindow.map((r) => r.AmountNum)),
  };
  net.difference = round2(net.app - net.statement);

  const known = [balances.opening.agrees, balances.closing.agrees].filter((x) => x != null);
  const clean = missing.length === 0 && extra.length === 0;
  const verdict = clean && known.length > 0 && known.every(Boolean) ? 'agrees' : clean && known.length === 0 ? 'unchecked' : 'differs';

  return { matched: true, account, pairs, missing, extra, balances, net, verdict };
}

/**
 * A statement's missing lines as an FNB history file, so that adding them uses the one door every
 * other bank line comes through — the same pairing against what is held, the same categorising, the
 * same keys. A line the statement prints with no description (the bank's own fees) is called what it is.
 */
export function historyTextFor(statement, lines) {
  const quote = (n) => n.toFixed(2);
  const slash = (iso) => iso.replace(/-/g, '/');
  const body = [...lines]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((l) => `${slash(l.date)}, ${quote(l.amount)}, ${quote(l.balance)}, ${l.description || 'Bank charge'}`);
  return [
    'ACCOUNT TRANSACTION HISTORY',
    '',
    'Name:, ,',
    `Account:, ${statement.account.number}, [${statement.account.name}]`,
    `Balance:, ${quote(statement.closing ?? 0)}, ${quote(statement.closing ?? 0)}`,
    '',
    'Date, Amount, Balance, Description',
    ...body,
    '',
  ].join('\n');
}

