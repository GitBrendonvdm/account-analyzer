import { describe, expect, it } from 'vitest';
import { historyTextFor, reconcileStatement } from './reconcile';
import { parseFnbHistory } from './statements/history';

const ACCOUNT = 'FNB Bank *9986';
const record = (extra = {}) => ({
  id: 'fnb|9986',
  bank: 'FNB',
  mask: '9986',
  rawName: ACCOUNT,
  type: 'Bank',
  currentBalance: 1694.51,
  balanceAsOf: '2026-10-08',
  ...extra,
});

const row = (Date, AmountNum, Description = 'x') => ({ Date, AmountNum, Description, Account: ACCOUNT, key: `${Date}|${AmountNum}|${Description}` });

// What the statement says happened between 8 Sep and 8 Oct, and what the bank says the account held.
const STATEMENT = {
  ok: true,
  account: { number: '62500009986', last4: '9986', name: 'FNB Fusion Private Clients Acc' },
  period: { from: '2026-09-08', to: '2026-10-08' },
  opening: 1000,
  closing: 1694.51,
  lines: [
    { date: '2026-09-14', description: 'POS Purchase', amount: -199.99, balance: 800.01, nonPosting: false },
    { date: '2026-09-16', description: '', amount: -5.5, balance: 794.51, nonPosting: false },
    { date: '2026-09-25', description: 'Credit', amount: 1100, balance: 1894.51, nonPosting: false },
    { date: '2026-09-25', description: 'Edo attempt', amount: 450, balance: 1894.51, nonPosting: true },
    { date: '2026-10-01', description: 'Debit', amount: -200, balance: 1694.51, nonPosting: false },
  ],
};
// The app, agreeing: an old row before the window, then one row per posting line (one a day out).
const HELD = [
  row('2026-08-30', -50, 'before the period'),
  row('2026-09-14', -199.99, 'Apple'),
  row('2026-09-17', -5.5, 'Fee'),
  row('2026-09-25', 1100, 'Credit'),
  row('2026-10-01', -200, 'Debit'),
];

describe('reconcileStatement', () => {
  it('agrees when every line and both balances line up', () => {
    const r = reconcileStatement(STATEMENT, HELD, [record()]);
    expect(r.matched).toBe(true);
    expect(r.verdict).toBe('agrees');
    expect(r.pairs).toHaveLength(4);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.balances.opening).toMatchObject({ statement: 1000, app: 1000, difference: 0, agrees: true });
    expect(r.balances.closing).toMatchObject({ statement: 1694.51, app: 1694.51, agrees: true });
  });

  it('leaves out the bank’s notice of a collection that did not happen', () => {
    const r = reconcileStatement(STATEMENT, HELD, [record()]);
    expect(r.pairs.every((p) => !p.line.nonPosting)).toBe(true);
    expect(r.net).toEqual({ statement: 694.51, app: 694.51, difference: 0 });
  });

  it('names a line the app does not have, and the balance it is out by', () => {
    const r = reconcileStatement(STATEMENT, HELD.filter((h) => h.Description !== 'Fee'), [record()]);
    expect(r.verdict).toBe('differs');
    expect(r.missing.map((l) => l.amount)).toEqual([-5.5]);
    // The ledger is anchored on its stated closing balance, so a missing line shows at the OPENING.
    expect(r.balances.closing.agrees).toBe(true);
    expect(r.balances.opening).toMatchObject({ difference: -5.5, agrees: false });
  });

  it('names a row the statement does not have', () => {
    const r = reconcileStatement(STATEMENT, [...HELD, row('2026-09-20', -75, 'Mystery')], [record()]);
    expect(r.verdict).toBe('differs');
    expect(r.extra.map((x) => x.Description)).toEqual(['Mystery']);
  });

  it('does not pair across more than two days, and uses each row once', () => {
    const far = HELD.map((h) => (h.Description === 'Fee' ? { ...h, Date: '2026-09-20' } : h));
    expect(reconcileStatement(STATEMENT, far, [record()]).missing).toHaveLength(1);
    const twice = {
      ...STATEMENT,
      lines: [...STATEMENT.lines, { date: '2026-10-01', description: 'Debit', amount: -200, balance: 1494.51, nonPosting: false }],
    };
    expect(reconcileStatement(twice, HELD, [record()]).missing).toHaveLength(1);
  });

  it('still compares lines when the account has no balance to compare', () => {
    const r = reconcileStatement(STATEMENT, HELD, [record({ currentBalance: null, balanceAsOf: null })]);
    expect(r.balances.opening.agrees).toBeNull();
    expect(r.missing).toEqual([]);
    expect(r.verdict).toBe('unchecked');
  });

  it('says which account is missing rather than guessing', () => {
    const r = reconcileStatement(STATEMENT, HELD, [record({ mask: '1111', id: 'fnb|1111' })]);
    expect(r).toMatchObject({ matched: false, verdict: 'unchecked' });
    expect(r.reason).toMatch(/9986/);
    expect(reconcileStatement({ ok: false, reason: 'nope' }, HELD, [record()]).matched).toBe(false);
  });

  it('prefers FNB when two banks end the same way', () => {
    const r = reconcileStatement(STATEMENT, HELD, [record({ id: 'nedbank|9986', bank: 'Nedbank' }), record()]);
    expect(r.account.id).toBe('fnb|9986');
  });
});

describe('historyTextFor', () => {
  it('turns lines into a file the history reader accepts, chain intact', () => {
    const text = historyTextFor(STATEMENT, STATEMENT.lines.filter((l) => !l.nonPosting));
    const parsed = parseFnbHistory(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.account.last4).toBe('9986');
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.map((r) => r.description)).toContain('Bank charge');
    expect(parsed.chain.breaks).toEqual([]);
  });
});
