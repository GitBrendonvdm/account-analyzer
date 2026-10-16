import { assignKeys } from '../db/txnKey';
import { normaliseRows } from '../ingest/normalise';
import { maskIndex } from '../utils/vault22';
import { accountIdOf as idOfRaw } from './accounts';
import { balanceFacts, kindOfHistory, looksLikeFnbHistory, parseFnbHistory, tidyDescription } from './statements/history';

/**
 * Turning FNB's own transaction-history files into an import.
 *
 * The files are the bank's record, one per account, each a window onto the account's last few
 * weeks. This module decides what they mean for the data the app already holds, and it is pure so
 * the server can run it inside the import transaction and a test can run it on a table of rows.
 *
 * WHAT A FILE BECOMES
 *
 *   - Its account is found by the last four digits of the account number, against FNB's accounts
 *     only, and keeps the name it already has — so the history, the balance and everything the user
 *     set against it survive. A number the app has never seen becomes a new account, named
 *     "FNB <type> *<last four>" with the type read from the bank's own name for it.
 *   - Its lines become rows in the shape the export used, with the bank's running balance kept
 *     beside each (`BankBalance`) so the ledger can later be checked against it line by line.
 *   - Its header becomes a balance patch: what the account held after its newest line.
 *
 * WHAT IT IS NOT ALLOWED TO DO
 *
 *   - Count anything twice. Two downloads of the same account overlap (the last month, then the last
 *     two), so the lines of one account are merged across files first, a line appearing in both
 *     counting once. Then the merged lines meet what the app already holds, and there are two kinds
 *     of "already":
 *       · the same line from an earlier history file — recognised by key, exactly as any re-import;
 *       · the same TRANSACTION from the aggregator's export that fed the app until now. Those lines
 *         are worded differently ("Fnb Home * Xx0725 Fnb Home *6996" against "FNB HOME 3000021106996
 *         260725"), so no key could match them; they are matched on account, amount to the cent and
 *         a date within two days, one for one, nearest first. A bank line that finds a partner is
 *         the same money and is not added, so the month the two sources overlap is not counted twice.
 *     The cost is the usual one: two genuinely separate identical amounts within two days, only one of
 *     which the old export had, would read as one. The old export had every line, so in practice the
 *     overlap pairs off exactly.
 *   - Invent income. Lines that did not move the balance were set aside by the parser.
 *   - Overwrite what the reader corrected. Rows already held (by key) are not sent again, so their
 *     category, group and notes are exactly as the reader left them.
 *   - Regress a balance. A patch is offered only when the file is at least as new as the balance the
 *     account already has.
 */

export const HISTORY_SOURCE = 'fnb-history';
/** How far apart two renderings of one transaction may be dated. */
const MATCH_DAYS = 2;
const DAY_MS = 86400000;

const cents = (n) => Math.round((Number(n) || 0) * 100);
const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const typeOf = (account) => account?.typeOverride ?? account?.type ?? null;

/** A line's identity across the overlapping files of one account: when, what, how much, and where the balance landed. */
const lineIdentity = (r) => `${r.date}|${cents(r.amount)}|${r.description}|${r.balance == null ? '' : cents(r.balance)}`;

/**
 * Merge the files of one account. A line appearing in both of two overlapping files is one line;
 * a line appearing twice in a single file (two identical fees the same day) is two, which is why
 * the merge keeps the larger count rather than the union.
 */
function mergeFiles(parsedFiles) {
  const wanted = new Map();
  const first = new Map();
  parsedFiles.forEach((parsed, fileIndex) => {
    const counts = new Map();
    parsed.rows.forEach((row) => counts.set(lineIdentity(row), (counts.get(lineIdentity(row)) ?? 0) + 1));
    counts.forEach((n, id) => {
      if (n > (wanted.get(id) ?? 0)) {
        wanted.set(id, n);
        first.set(id, fileIndex);
      }
    });
  });
  const merged = [];
  const taken = new Map();
  // Walk each file's lines oldest first so the order of identical lines is the order they happened.
  parsedFiles.forEach((parsed, fileIndex) => {
    [...parsed.rows].reverse().forEach((row) => {
      const id = lineIdentity(row);
      if (first.get(id) !== fileIndex) return;
      const n = (taken.get(id) ?? 0) + 1;
      if (n > wanted.get(id)) return;
      taken.set(id, n);
      merged.push(row);
    });
  });
  // Chronological, ties kept in the order the bank processed them.
  return merged
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.i - b.i))
    .map(({ row }) => row);
}

function canonicalRow(line, account) {
  const amount = line.amount;
  return {
    Date: line.date,
    Description: tidyDescription(line.description),
    Account: account,
    'Spending Group': '',
    Category: '',
    'Pay Month': '',
    'Split Transaction': 'No',
    Currency: 'ZAR',
    Amount: String(amount),
    'Original Currency': '',
    'Original Amount': '',
    Type: amount < 0 ? 'Expense' : 'Income',
    Status: 'Completed',
    Tags: '',
    Notes: '',
    AmountNum: amount,
    BankDescription: line.description,
    BankBalance: line.balance,
    Source: HISTORY_SOURCE,
  };
}

/**
 * Pair each new bank line with a held row from the other source: same account, same amount to the
 * cent, dated within MATCH_DAYS, nearest first, each held row used once. Returns the indexes (into
 * `lines`) of the lines that found a partner.
 */
function pairWithHeld(lines, heldRows) {
  const byAccount = new Map();
  heldRows.forEach((h) => {
    if (h.Source === HISTORY_SOURCE) return;
    const list = byAccount.get(h.accountId) ?? [];
    list.push({ cents: cents(h.AmountNum ?? h.Amount), day: dayNumber(h.Date ?? h.date), used: false });
    byAccount.set(h.accountId, list);
  });
  const paired = new Set();
  lines.forEach((line, index) => {
    const pool = byAccount.get(line.accountId);
    if (!pool) return;
    const want = cents(line.AmountNum);
    const day = dayNumber(line.Date);
    let best = null;
    for (const candidate of pool) {
      if (candidate.used || candidate.cents !== want) continue;
      const gap = Math.abs(candidate.day - day);
      if (gap > MATCH_DAYS) continue;
      if (!best || gap < best.gap) best = { candidate, gap };
    }
    if (best) {
      best.candidate.used = true;
      paired.add(index);
    }
  });
  return paired;
}

/**
 * @param {object}   input
 * @param {{ name: string, from?: string, text: string }[]} input.files   history files, as text
 * @param {object[]} input.accounts  stored account records
 * @param {object[]} input.held      stored transactions (with `key`, `accountId`, `Source`, `Category`)
 * @param {Date}     [input.asOf]
 * @returns {{
 *   files: object[],      one entry per input file: what it was and what became of it
 *   rows: object[],       new rows, keyed and categorised, ready for importRows (`meta.keyed`)
 *   patches: { id, patch }[],  balance patches for accounts that exist already
 *   newAccounts: { id, rawName, type, patch }[],  accounts the files introduce, with their balances
 *   totals: object
 * }}
 */
export function planBankImport({ files, accounts = [], held = [], asOf = new Date() }) {
  const fnbAccounts = accounts.filter((a) => !a?.bank || /fnb|first national/i.test(a.bank));
  const index = maskIndex(fnbAccounts);
  const byRaw = new Map(accounts.map((a) => [a.rawName, a]));

  const results = [];
  const groups = new Map();

  files.forEach((file) => {
    const entry = { name: file.name, from: file.from ?? file.name, status: 'ok', reason: null };
    results.push(entry);
    if (!looksLikeFnbHistory(file.text)) {
      Object.assign(entry, { status: 'skipped', reason: 'not an FNB transaction history' });
      return;
    }
    const parsed = parseFnbHistory(file.text);
    if (!parsed.ok) {
      Object.assign(entry, { status: 'skipped', reason: parsed.reason });
      return;
    }
    const kind = kindOfHistory(parsed);
    entry.accountName = parsed.account.name;
    entry.last4 = parsed.account.last4;
    if (kind.rewards) {
      Object.assign(entry, { status: 'skipped', reason: 'eBucks is points, not rand — the rand side is already in your other accounts' });
      return;
    }
    if (!parsed.account.last4) {
      Object.assign(entry, { status: 'skipped', reason: 'no account number to match it to' });
      return;
    }
    const known = index.get(parsed.account.last4.toLowerCase());
    const rawName = known ?? `FNB ${kind.type} *${parsed.account.last4}`;
    const record = known ? (byRaw.get(known) ?? null) : null;
    const type = typeOf(record) ?? kind.type;

    Object.assign(entry, {
      rawName,
      isNew: !record,
      type,
      rowsRead: parsed.rows.length,
      informational: parsed.informational.length,
      nonPosting: parsed.nonPosting,
      chain: { hasBalances: parsed.hasBalances, checked: parsed.chain.checked, breaks: parsed.chain.breaks },
      from: file.from ?? file.name,
      oldest: parsed.oldest,
      newest: parsed.newest,
    });

    const group = groups.get(rawName) ?? { rawName, record, type, kind, parsed: [], entries: [] };
    group.parsed.push(parsed);
    group.entries.push(entry);
    groups.set(rawName, group);
  });

  // ---- merge, key, and meet what is held ------------------------------------------------------
  const incoming = [];
  const patches = [];
  const newAccounts = [];

  groups.forEach((group) => {
    const merged = mergeFiles(group.parsed);
    const accountId = group.record?.id ?? null;
    merged.forEach((line) => incoming.push({ ...canonicalRow(line, group.rawName), __group: group.rawName }));

    // The newest file decides the balance; ties go to whichever has more lines.
    const newest = [...group.parsed].sort((a, b) =>
      a.newest === b.newest ? b.rows.length - a.rows.length : a.newest < b.newest ? 1 : -1,
    )[0];
    // A file with a header and no lines states a balance for no day in particular, which is no balance.
    const facts = newest.newest ? balanceFacts(newest, group.type) : null;
    group.facts = facts;
    group.accountId = accountId;
    group.entries.forEach((e) => {
      e.accountRows = merged.length;
    });
  });

  assignKeys(incoming);
  const heldKeys = new Set(held.map((h) => h.key));
  const fresh = incoming.filter((r) => !heldKeys.has(r.key));
  const alreadyHeld = incoming.length - fresh.length;

  // A held row that a bank line has already claimed BY KEY is spoken for: offering it again as the
  // partner of a second identical line would swallow a transaction that really happened twice.
  const claimed = new Set(incoming.filter((r) => heldKeys.has(r.key)).map((r) => r.key));
  const withIds = fresh.map((r) => ({ ...r, accountId: idOfRaw(r.Account) }));
  const pairedAt = pairWithHeld(
    withIds,
    held.filter((h) => !claimed.has(h.key)),
  );

  // Pairing may only drop lines from the TAIL of a group of identical rows, so the survivors keep
  // the numbers they would have had and a later re-import finds them by key.
  const baseOf = (r) => r.key.replace(/\|#\d+$/, '');
  const dropped = new Set();
  const matchedByGroup = new Map();
  pairedAt.forEach((i) => {
    const base = baseOf(withIds[i]);
    matchedByGroup.set(base, (matchedByGroup.get(base) ?? 0) + 1);
  });
  matchedByGroup.forEach((count, base) => {
    const members = withIds.map((r, i) => ({ r, i })).filter(({ r }) => baseOf(r) === base);
    members.slice(members.length - count).forEach(({ i }) => dropped.add(i));
  });
  const kept = withIds.filter((_, i) => !dropped.has(i));

  const { rows: normalised, stats } = normaliseRows(kept, held, { asOf });
  const rows = normalised.map((r) => {
    const copy = { ...r };
    delete copy.__group;
    return copy;
  });

  const perAccount = new Map();
  const bump = (name, field, n = 1) => {
    const t = perAccount.get(name) ?? { added: 0, alreadyHeld: 0, pairedWithOldExport: 0 };
    t[field] += n;
    perAccount.set(name, t);
  };
  incoming.forEach((r) => {
    if (heldKeys.has(r.key)) bump(r.__group, 'alreadyHeld');
  });
  withIds.forEach((r, i) => {
    if (dropped.has(i)) bump(r.__group, 'pairedWithOldExport');
    else bump(r.__group, 'added');
  });

  groups.forEach((group) => {
    const t = perAccount.get(group.rawName) ?? { added: 0, alreadyHeld: 0, pairedWithOldExport: 0 };
    group.entries.forEach((e) => Object.assign(e, t));
    const facts = group.facts;
    if (!facts) return;
    const record = group.record;
    const stale = record?.balanceAsOf && facts.balanceAsOf && record.balanceAsOf > facts.balanceAsOf;
    if (stale) {
      group.entries.forEach((e) => (e.balanceNote = `a newer balance (${record.balanceAsOf}) is already held`));
      return;
    }
    const patch = {
      currentBalance: facts.currentBalance,
      balanceAsOf: facts.balanceAsOf,
      source: 'history',
      statementName: group.parsed[0].account.name,
    };
    // A limit read off "available" is only as good as the holds on the account that day, so it fills
    // a gap and never replaces a limit somebody set or a statement printed.
    if (facts.creditLimit != null && record?.creditLimit == null) patch.creditLimit = facts.creditLimit;
    if (facts.overdraftLimit != null && record?.overdraftLimit == null) patch.overdraftLimit = facts.overdraftLimit;
    if (record) patches.push({ id: record.id, patch });
    else newAccounts.push({ rawName: group.rawName, type: group.type, patch, name: group.parsed[0].account.name });
    group.entries.forEach((e) => (e.balance = facts));
  });

  const totals = {
    files: files.length,
    used: results.filter((r) => r.status === 'ok').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    added: rows.length,
    alreadyHeld,
    pairedWithOldExport: dropped.size,
    categorised: stats.categorised ?? {},
  };
  return { files: results, rows, patches, newAccounts, totals };
}
