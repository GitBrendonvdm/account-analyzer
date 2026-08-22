import { describe, expect, it } from 'vitest';
import { buildAccountRecord } from '../../db/accountIdentity';
import { matchStatement, parseStatement, patchIsNoop } from './index';

// Account numbers in these fixtures are synthetic; only the last four digits are realistic.

const FNB_PAGE = [
  'My Bank Accounts',
  'Day To Day',
  'Account Name Account Number Balance Available Balance',
  'FNB Gold Cheque Account 55500019986 R -9,341.97 R 8,956.43',
  'FNB Premier Credit Card 411111******2000 R 0.00 R 1,722.00',
  'Total -9,341.97 10,678.43',
  'Rewards',
  'Account Name Account Number Balance Available Balance',
  'eBucks Account 55500018452 eB 7,655.00 eB 7,655.00',
  'Savings And Investments',
  'Account Name Account Number Balance Available Balance',
  'Retirement Annuity 555001412 R 17,227.87 R 17,227.87',
];

const NEDBANK_PAGE = [
  '22/08/2026 Account summary',
  'All balances',
  'Date: 22/08/2026 Time: 2:25 PM',
  'No Account description Account number Account type Current balance Available balance',
  '1 MiGoals 1000005284 Current R0.00 R0.00',
  '2 Private Bundle 1000001825 Current R1 761.12 R1 761.12',
  '3 other 2000009530 Savings R0.00 R0.00',
  '4 Credit Card Plastic 370000000004714 AMEX - R117 863.55 R12 385.06',
  '5 Credit Card Plastic 4000000000000117 VISA - R117 863.55 R12 385.06',
  '6 BOND 8000000002801 Home loan R2 747 082.69 R0.00',
];

const OTHER = "Other bank's page";
const record = (name) => buildAccountRecord([name], null, '2026-08-21');

describe('parseStatement with both banks in one upload', () => {
  it('lets the bank with more accounts win and reports the other page\'s rows', () => {
    // Three FNB accounts against five Nedbank ones: Nedbank is the statement.
    const out = parseStatement([...FNB_PAGE, ...NEDBANK_PAGE], { asOf: '2026-08-01' });
    expect(out.bank).toBe('Nedbank');
    expect(out.asOf).toBe('2026-08-22');
    expect(out.accounts).toHaveLength(5);
    expect(out.accounts.every((a) => a.bank === 'Nedbank')).toBe(true);

    const foreign = out.skipped.filter((s) => s.reason === OTHER).map((s) => s.line);
    expect(foreign).toEqual([
      'FNB Gold Cheque Account 55500019986 R -9,341.97 R 8,956.43',
      'FNB Premier Credit Card 411111******2000 R 0.00 R 1,722.00',
      'Retirement Annuity 555001412 R 17,227.87 R 17,227.87',
    ]);
    // The other page's own skips come along with their own reasons.
    expect(out.skipped).toContainEqual({
      line: 'eBucks Account 55500018452 eB 7,655.00 eB 7,655.00',
      reason: 'rewards points, not money',
    });
  });

  it('goes the other way when FNB has more, whichever page comes first', () => {
    const out = parseStatement([...NEDBANK_PAGE.slice(0, 6), ...FNB_PAGE], { asOf: '2026-08-01' });
    expect(out.bank).toBe('FNB');
    expect(out.asOf).toBe('2026-08-01');
    expect(out.accounts.map((a) => a.name)).toEqual([
      'FNB Gold Cheque Account',
      'FNB Premier Credit Card',
      'Retirement Annuity',
    ]);
    expect(out.skipped.filter((s) => s.reason === OTHER).map((s) => s.line)).toEqual([
      '1 MiGoals 1000005284 Current R0.00 R0.00',
      '2 Private Bundle 1000001825 Current R1 761.12 R1 761.12',
    ]);
    // Nothing from the winning page is reported as foreign.
    for (const a of out.accounts) expect(out.skipped.map((s) => s.line)).not.toContain(a.line);
  });

  it('never reports anything as foreign on a single-bank upload', () => {
    expect(parseStatement(FNB_PAGE).skipped.some((s) => s.reason === OTHER)).toBe(false);
    expect(parseStatement(NEDBANK_PAGE).skipped.some((s) => s.reason === OTHER)).toBe(false);
  });

  it('keeps the line every account was read from', () => {
    const fnb = parseStatement(FNB_PAGE);
    expect(fnb.accounts[0].line).toBe('FNB Gold Cheque Account 55500019986 R -9,341.97 R 8,956.43');
    const ned = parseStatement(NEDBANK_PAGE);
    expect(ned.accounts.find((a) => a.name === 'BOND').line).toBe('6 BOND 8000000002801 Home loan R2 747 082.69 R0.00');
  });
});

describe('the as-of date', () => {
  const known = [record('FNB Bank *9986'), record('FNB Credit Card *2000')];

  it('stamps an FNB page, which carries none, with the caller\'s date', () => {
    expect(parseStatement(FNB_PAGE, { asOf: '2026-08-15' }).asOf).toBe('2026-08-15');
    expect(parseStatement(FNB_PAGE).asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lets matchStatement override the date in every patch and every record', () => {
    const parsed = parseStatement(FNB_PAGE, { asOf: '2026-08-15', knownAccounts: known });
    const out = matchStatement(parsed, { knownAccounts: known, asOf: '2026-08-01' });
    expect(out.asOf).toBe('2026-08-01');
    expect(out.matched).toHaveLength(2);
    expect(out.unmatched).toHaveLength(1);
    for (const m of out.matched) expect(m.patch.balanceAsOf).toBe('2026-08-01');
    for (const u of out.unmatched) expect(u.record.balanceAsOf).toBe('2026-08-01');
  });

  it('overrides even a date the page printed', () => {
    const out = matchStatement(parseStatement(NEDBANK_PAGE), { knownAccounts: [], asOf: '2026-08-01' });
    expect(out.asOf).toBe('2026-08-01');
    expect(out.unmatched.every((u) => u.record.balanceAsOf === '2026-08-01')).toBe(true);
  });

  it('uses the statement\'s date when no override is given, in either call form', () => {
    const parsed = parseStatement(NEDBANK_PAGE);
    expect(matchStatement(parsed, []).asOf).toBe('2026-08-22');
    expect(matchStatement(parsed, { knownAccounts: [] }).asOf).toBe('2026-08-22');
  });
});

describe('limits and amounts at the edges', () => {
  it('gives a card with nothing owed and nothing available no limit, and no limit key', () => {
    const parsed = parseStatement(['R 0.00R 0.00411111******2000FNB Premier Credit Card'], { asOf: '2026-08-22' });
    expect(parsed.accounts[0]).toMatchObject({ type: 'Credit Card', balance: 0, available: 0, creditLimit: null });
    const { matched } = matchStatement(parsed, [record('FNB Credit Card *2000')]);
    expect(matched[0].patch).toEqual({
      currentBalance: 0,
      balanceAsOf: '2026-08-22',
      source: 'statement',
      statementName: 'FNB Premier Credit Card',
    });
    expect(matched[0].patch).not.toHaveProperty('creditLimit');
  });

  it('reads a Nedbank row whose available amount lost its rand sign', () => {
    const parsed = parseStatement(['All balances', '2 Private Bundle 1000001825 Current R1 761.12 1 761.12']);
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0]).toMatchObject({ name: 'Private Bundle', balance: 1761.12, available: 1761.12 });
    expect(parsed.skipped).toEqual([]);
  });
});

describe('patchIsNoop', () => {
  const account = {
    ...record('FNB Bank *9986'),
    currentBalance: -9341.97,
    balanceAsOf: '2026-08-22',
    overdraftLimit: 18298.4,
    source: 'statement',
  };
  const patch = {
    currentBalance: -9341.97,
    balanceAsOf: '2026-08-22',
    overdraftLimit: 18298.4,
    source: 'statement',
    statementName: 'FNB Gold Cheque Account',
  };

  it('is true when the record already holds what the patch says', () => {
    expect(patchIsNoop(patch, account)).toBe(true);
    expect(patchIsNoop({ ...patch, currentBalance: -9341.971 }, account)).toBe(true);
  });

  it('is false when the balance, the date or a carried limit differs', () => {
    expect(patchIsNoop({ ...patch, currentBalance: -9341.96 }, account)).toBe(false);
    expect(patchIsNoop({ ...patch, balanceAsOf: '2026-08-21' }, account)).toBe(false);
    expect(patchIsNoop({ ...patch, overdraftLimit: 18000 }, account)).toBe(false);
    expect(patchIsNoop(patch, { ...account, currentBalance: null })).toBe(false);
  });

  it('ignores a limit the patch does not carry', () => {
    const noLimit = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'overdraftLimit'));
    expect(patchIsNoop(noLimit, { ...account, overdraftLimit: null })).toBe(true);
  });

  it('is the second upload of the same page doing nothing', () => {
    const parsed = parseStatement(FNB_PAGE, { asOf: '2026-08-22' });
    const first = matchStatement(parsed, [record('FNB Bank *9986')]);
    const written = { ...first.matched[0].account, ...first.matched[0].patch };
    const second = matchStatement(parsed, [written]);
    expect(patchIsNoop(second.matched[0].patch, written)).toBe(true);
  });
});
