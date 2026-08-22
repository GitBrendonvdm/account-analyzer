import { describe, expect, it } from 'vitest';
import { buildAccountRecord } from '../../db/accountIdentity';
import { SIGN_NOTE, adoptKnownTypes, externalRecord, matchStatement } from './match';
import { parseFnb } from './fnb';
import { parseNedbank } from './nedbank';
import { parseStatement } from './index';

// Account numbers in these fixtures are synthetic; only the last four digits are realistic.

const NEDBANK = parseNedbank(
  [
    'Date: 22/08/2026 Time: 2:25 PM',
    '2 Private Bundle 1000001825 Current R1 761.12 R1 761.12',
    '4 Credit Card Plastic 370000000004714 AMEX - R117 863.55 R12 385.06',
    '5 Credit Card Plastic 4000000000000117 VISA - R117 863.55 R12 385.06',
    '6 BOND 8000000002801 Home loan R2 747 082.69 R0.00',
  ],
  { knownMasks: ['4714'] },
);

// The real OCR of the same page: no type cells, "BOND" read as "Bon".
const OCR = [
  'N  All balances',
  'Date: 22/08/2026 Time: 2:25 PM',
  'Private Bundle          1000001825         R1 761.12          R1 761.12',
  '[4 [Credit Card Plastic          370000000004714 | AMEX                            -R117 863.55             R12 385.06',
  'Credit Card Plastic         4000000000000117 | VISA                            R117 863.55            R12 385.06',
  '[6 [Bon                          8000000002801        R2 747 082.69                     R0.00',
];

const FNB = parseFnb(
  [
    'FNB Gold Cheque Account 55500019986 R -9,341.97 R 8,956.43',
    'Day To Day Savings 55500029547 R 38.04 R 38.04',
    'Retirement Annuity 555001412 R 17,227.87 R 17,227.87',
  ],
  { asOf: '2026-08-22' },
);

const record = (name, existing = null) => buildAccountRecord([name], existing, '2026-08-21');

describe('matchStatement', () => {
  it('pairs a card with the account the export knows by its last four', () => {
    const card = record('Nedbank Credit Card *4714');
    const { matched, unmatched, needsAttention, asOf } = matchStatement(NEDBANK, [card]);
    expect(asOf).toBe('2026-08-22');
    const hit = matched.find((m) => m.account.id === 'nedbank|4714');
    expect(hit.parsed.name).toBe('Credit Card Plastic');
    expect(hit.patch).toEqual({
      currentBalance: -117863.55,
      balanceAsOf: '2026-08-22',
      creditLimit: 130248.61,
      source: 'statement',
      statementName: 'Credit Card Plastic',
    });
    expect(hit.note).toBeUndefined();
    expect(unmatched.map((u) => u.parsed.name)).toEqual(['Private Bundle', 'BOND']);
    expect(needsAttention).toEqual([]);
  });

  it('accepts the records as { knownAccounts } too', () => {
    const card = record('Nedbank Credit Card *4714');
    expect(matchStatement(NEDBANK, { knownAccounts: [card] }).matched).toHaveLength(1);
  });

  it('matches on either plastic of a merged card', () => {
    const visa = record('Nedbank Credit Card *0117');
    const { matched } = matchStatement(NEDBANK, [visa]);
    expect(matched.map((m) => m.account.id)).toEqual(['nedbank|0117']);
  });

  it('prefers the account at the same bank when two share a last four', () => {
    const fnb = record('FNB Credit Card *4714');
    const ned = record('Nedbank Credit Card *4714');
    const { matched } = matchStatement(NEDBANK, [fnb, ned]);
    expect(matched.map((m) => m.account.id)).toEqual(['nedbank|4714']);
  });

  it('still matches across banks when that is the only candidate', () => {
    const fnb = record('FNB Credit Card *4714');
    const { matched } = matchStatement(NEDBANK, [fnb]);
    expect(matched.map((m) => m.account.id)).toEqual(['fnb|4714']);
  });

  it('is case-insensitive on the mask', () => {
    const account = { ...record('Nedbank Credit Card *4714'), mask: '4714'.toUpperCase() };
    expect(matchStatement(NEDBANK, [account]).matched).toHaveLength(1);
  });

  it('puts the derived limit on the field the app shows for the account\'s type', () => {
    const cheque = record('FNB Bank *9986');
    const { matched } = matchStatement(FNB, [cheque]);
    const hit = matched.find((m) => m.account.id === 'fnb|9986');
    expect(hit.patch).toEqual({
      currentBalance: -9341.97,
      balanceAsOf: '2026-08-22',
      overdraftLimit: 18298.4,
      source: 'statement',
      statementName: 'FNB Gold Cheque Account',
    });
    expect(hit.patch).not.toHaveProperty('creditLimit');
  });

  it('lets the record\'s type win over the statement\'s label, and sends no limit without headroom', () => {
    // Renamed by a later export from Savings to Bank; the statement still calls it savings.
    const older = buildAccountRecord(['FNB Savings *9547'], null, '2026-07-01');
    const savings = record('FNB Bank *9547', older);
    expect(savings.type).toBe('Bank');
    const { matched } = matchStatement(FNB, [savings]);
    const hit = matched.find((m) => m.account.id === 'fnb|9547');
    expect(hit.parsed).toMatchObject({ type: 'Bank', kind: 'cheque', typeFrom: 'record', balance: 38.04 });
    expect(hit.patch).toEqual({
      currentBalance: 38.04,
      balanceAsOf: '2026-08-22',
      source: 'statement',
      statementName: 'Day To Day Savings',
    });
  });

  it('shapes an unmatched account as a complete external record', () => {
    const { unmatched } = matchStatement(NEDBANK, []);
    const bond = unmatched.find((u) => u.parsed.name === 'BOND');
    expect(bond.record).toEqual({
      id: 'nedbank|2801',
      bank: 'Nedbank',
      type: 'Loan',
      typeOverride: null,
      mask: '2801',
      rawName: 'Nedbank Loan *2801',
      seenNames: ['Nedbank Loan *2801'],
      seenThrough: null,
      label: 'BOND',
      isLiability: true,
      currentBalance: -2747082.69,
      balanceAsOf: '2026-08-22',
      creditLimit: null,
      overdraftLimit: null,
      hidden: false,
      external: true,
      source: 'statement',
      statementName: 'BOND',
    });

    const annuity = matchStatement(FNB, []).unmatched.find((u) => u.parsed.name === 'Retirement Annuity');
    expect(annuity.record).toMatchObject({
      id: 'fnb|1412',
      type: 'Savings',
      isLiability: false,
      rawName: 'FNB Savings *1412',
      label: 'Retirement Annuity',
      currentBalance: 17227.87,
    });
  });

  it('carries a card limit onto a new external card', () => {
    const { unmatched } = matchStatement(NEDBANK, []);
    const card = unmatched.find((u) => u.parsed.type === 'Credit Card');
    expect(card.record).toMatchObject({ id: 'nedbank|4714', creditLimit: 130248.61, overdraftLimit: null });
  });

  it('finds an external record from an earlier upload instead of creating it again', () => {
    const first = matchStatement(NEDBANK, []);
    const stored = first.unmatched.map((u) => u.record);
    const second = matchStatement(NEDBANK, stored);
    expect(second.unmatched).toEqual([]);
    expect(second.matched.map((m) => m.account.id).sort()).toEqual(['nedbank|1825', 'nedbank|2801', 'nedbank|4714']);
  });

  it('never hands one app account to two statement entries', () => {
    const twice = {
      ...FNB,
      accounts: [FNB.accounts[0], { ...FNB.accounts[0], name: 'A second *9986' }],
    };
    const { matched, unmatched } = matchStatement(twice, [record('FNB Bank *9986')]);
    expect(matched).toHaveLength(1);
    expect(unmatched.map((u) => u.parsed.name)).toEqual(['A second *9986']);
  });

  it('copes with an empty or absent parse', () => {
    expect(matchStatement({ bank: null, asOf: '2026-08-22', accounts: [] }, [])).toEqual({
      matched: [],
      unmatched: [],
      needsAttention: [],
      asOf: '2026-08-22',
    });
    expect(matchStatement(null, [])).toEqual({ matched: [], unmatched: [], needsAttention: [], asOf: null });
  });
});

describe('matchStatement, the scan that lost its type column', () => {
  const KNOWN = ['Nedbank Savings *1825', 'Nedbank Credit Card *4714', 'Nedbank Loan *2801'].map((n) => record(n));

  it('types every known account from its record and signs the bond as owed, with a note', () => {
    const parsed = parseStatement(OCR, { knownAccounts: KNOWN });
    const { matched, unmatched, needsAttention } = matchStatement(parsed, { knownAccounts: KNOWN });
    expect(unmatched).toEqual([]);
    expect(needsAttention).toEqual([]);

    const bond = matched.find((m) => m.account.id === 'nedbank|2801');
    expect(bond.parsed).toMatchObject({ name: 'Bon', type: 'Loan', typeFrom: 'record' });
    expect(bond.patch).toEqual({
      currentBalance: -2747082.69,
      balanceAsOf: '2026-08-22',
      source: 'statement',
      statementName: 'Bon',
    });
    expect(bond.note).toBe(SIGN_NOTE);

    const bundle = matched.find((m) => m.account.id === 'nedbank|1825');
    expect(bundle.parsed).toMatchObject({ type: 'Savings', kind: 'savings', typeFrom: 'record' });
    expect(bundle.patch.currentBalance).toBe(1761.12);
    expect(bundle.note).toBeUndefined();

    const card = matched.find((m) => m.account.id === 'nedbank|4714');
    expect(card.patch).toMatchObject({ currentBalance: -117863.55, creditLimit: 130248.61 });
  });

  it('holds a large account back for a type when nothing is known about it', () => {
    const parsed = parseStatement(OCR);
    const { matched, unmatched, needsAttention } = matchStatement(parsed, []);
    expect(matched).toEqual([]);
    expect(unmatched.map((u) => u.parsed.name)).toEqual(['Private Bundle', 'Credit Card Plastic']);
    expect(needsAttention).toHaveLength(1);
    expect(needsAttention[0]).toMatchObject({
      reason: 'type unknown',
      parsed: { name: 'Bon', type: 'Loan', typeFrom: 'name', balance: -2747082.69 },
    });
  });

  it('builds the record from the type the user then chooses', () => {
    const parsed = parseStatement(OCR);
    const { needsAttention } = matchStatement(parsed, []);
    const bond = needsAttention[0].parsed;

    const asLoan = externalRecord(bond, { bank: 'Nedbank', asOf: '2026-08-22', type: 'Loan' });
    expect(asLoan).toMatchObject({ id: 'nedbank|2801', type: 'Loan', isLiability: true, currentBalance: -2747082.69, label: 'Bon' });

    // Wrong, but the user's call: an asset keeps the sign the bank printed.
    const asSavings = externalRecord(bond, { bank: 'Nedbank', asOf: '2026-08-22', type: 'Savings' });
    expect(asSavings).toMatchObject({ type: 'Savings', isLiability: false, currentBalance: 2747082.69 });
  });

  it('does not hold back a small unknown account', () => {
    const parsed = parseStatement(['N  All balances', 'Something 1000007777 R400.00 R400.00']);
    const { unmatched, needsAttention } = matchStatement(parsed, []);
    expect(needsAttention).toEqual([]);
    expect(unmatched[0].record).toMatchObject({ type: 'Other', currentBalance: 400, isLiability: false });
  });
});

describe('adoptKnownTypes and the sign safety rule', () => {
  it('negates a positive figure on a liability record and says so', () => {
    const parsed = parseStatement(['N  All balances', 'Something 1000001111 R500.00 R9 500.00']);
    expect(parsed.accounts[0]).toMatchObject({ type: 'Other', balance: 500 });
    const card = record('Nedbank Credit Card *1111');
    const { matched } = matchStatement(parsed, [card]);
    expect(matched[0].parsed).toMatchObject({ type: 'Credit Card', kind: 'card', balance: -500, signFromType: true });
    expect(matched[0].patch).toMatchObject({ currentBalance: -500, creditLimit: 10000 });
    expect(matched[0].note).toBe(SIGN_NOTE);
  });

  it('leaves the parse alone when nothing is known', () => {
    expect(adoptKnownTypes(NEDBANK, [])).toBe(NEDBANK);
    expect(adoptKnownTypes(null, [record('Nedbank Loan *2801')])).toBeNull();
  });

  it('restores the printed sign when a record says an account is an asset', () => {
    const parsed = parseNedbank(['4 Credit Card Plastic 370000000004714 AMEX R117 863.55 R12 385.06']);
    const typed = adoptKnownTypes(parsed, [record('Nedbank Savings *4714')]);
    expect(typed.accounts[0]).toMatchObject({ type: 'Savings', balance: 117863.55, signFromType: false, creditLimit: null });
  });
});
