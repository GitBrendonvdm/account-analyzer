import { describe, expect, it } from 'vitest';
import { buildAccountRecord } from '../../db/accountIdentity';
import { looksLikeNedbank, parseNedbank } from './nedbank';
import { looksLikeFnb } from './fnb';
import { parseStatement } from './index';

// Account numbers in these fixtures are synthetic; only the last four digits are realistic.

// The "All balances" page as it would read if OCR were perfect.
const NEDBANK = [
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

// What tesseract.js actually returned for the same page rendered at scale 2 (PSM 6): two rows of
// zeros and the column header collapsed into "HE oe", every type cell lost, row numbers leaking in
// as "[4 [", a "|" for the cell border, "BOND" read as "Bon", and one card's minus dropped.
const OCR_SCALE2 = [
  '22/08/2026                                                                Account mmmary',
  'N                                                                         All balances',
  'Date: 22/08/2026 Time: 2:25 PM',
  'HE   oe',
  'Private Bundle          1000001825         R1 761.12          R1 761.12',
  '[4 [Credit Card Plastic          370000000004714 | AMEX                            -R117 863.55             R12 385.06',
  'Credit Card Plastic         4000000000000117 | VISA                            R117 863.55            R12 385.06',
  '[6 [Bon                          8000000002801        R2 747 082.69                     R0.00',
];

// And at scale 3, which is what extract.js uses: "BOND" survives and both plastics come through
// negative, but the thousands separator can vanish and the type cells are still gone.
const OCR_SCALE3 = [
  '22/08/2026  Account summary',
  'N  All balances',
  'Date: 22/08/2026 Time: 2:25 PM',
  'NH a  om',
  'Private Bundle  1000001825  R1761.12  R1761.12',
  'Credit Card Plastic  370000000004714 | AMEX  -R117 863.55  R12 385.06',
  'Credit Card Plastic  4000000000000117 | VISA  -R117 863.55  R12 385.06',
  '6 [BOND  8000000002801  R2 747 082.69  R0.00',
];

const KNOWN = ['Nedbank Savings *1825', 'Nedbank Credit Card *4714', 'Nedbank Loan *2801'].map((n) =>
  buildAccountRecord([n], null, '2026-08-21'),
);

const parsed = parseNedbank(NEDBANK);
const byName = (name) => parsed.accounts.find((a) => a.name === name);

describe('parseNedbank, clean text', () => {
  it('reads the date off the page', () => {
    expect(parsed.bank).toBe('Nedbank');
    expect(parsed.asOf).toBe('2026-08-22');
  });

  it('finds one entry per account, with the two plastics folded into one card', () => {
    expect(parsed.accounts.map((a) => a.name)).toEqual([
      'MiGoals',
      'Private Bundle',
      'other',
      'Credit Card Plastic',
      'BOND',
    ]);
    expect(parsed.skipped).toEqual([]);
  });

  it('reads the current accounts from the type column', () => {
    expect(byName('MiGoals')).toMatchObject({
      bank: 'Nedbank',
      number: '1000005284',
      last4: '5284',
      type: 'Bank',
      kind: 'cheque',
      typeFrom: 'column',
      balance: 0,
      available: 0,
      creditLimit: null,
      overdraftLimit: null,
      currency: 'ZAR',
    });
    expect(byName('Private Bundle')).toMatchObject({ last4: '1825', balance: 1761.12, available: 1761.12 });
    expect(byName('other')).toMatchObject({ type: 'Savings', kind: 'savings', balance: 0 });
  });

  it('keeps both card numbers and derives the limit', () => {
    expect(byName('Credit Card Plastic')).toMatchObject({
      type: 'Credit Card',
      kind: 'card',
      number: '370000000004714',
      numbers: ['370000000004714', '4000000000000117'],
      last4: '4714',
      balance: -117863.55,
      printedBalance: -117863.55,
      signFromType: false,
      available: 12385.06,
      creditLimit: 130248.61,
      overdraftLimit: null,
    });
  });

  it('lets the merged card adopt whichever number the app already knows', () => {
    const visa = parseNedbank(NEDBANK, { knownMasks: ['0117'] }).accounts.find((a) => a.type === 'Credit Card');
    expect(visa).toMatchObject({ number: '4000000000000117', last4: '0117' });
    expect(visa.numbers).toHaveLength(2);

    const amex = parseNedbank(NEDBANK, { knownMasks: ['4714', '9986'] }).accounts.find((a) => a.type === 'Credit Card');
    expect(amex).toMatchObject({ number: '370000000004714', last4: '4714' });
  });

  it('signs the bond as a debt even though the bank prints it positive', () => {
    expect(byName('BOND')).toMatchObject({
      type: 'Loan',
      kind: 'home',
      typeFrom: 'column',
      number: '8000000002801',
      last4: '2801',
      balance: -2747082.69,
      printedBalance: 2747082.69,
      signFromType: true,
      available: 0,
      creditLimit: null,
      overdraftLimit: null,
    });
  });

  it('takes the caller\'s date only when the page has none', () => {
    const rows = NEDBANK.slice(4);
    expect(parseNedbank(rows, { asOf: '2026-01-01' }).asOf).toBe('2026-01-01');
    expect(parseNedbank(NEDBANK, { asOf: '2026-01-01' }).asOf).toBe('2026-08-22');
  });
});

describe('parseNedbank, real OCR output at scale 2', () => {
  const out = parseNedbank(OCR_SCALE2);
  const find = (name) => out.accounts.find((a) => a.name === name);

  it('finds the three rows OCR kept and reports the one it mangled', () => {
    expect(out.asOf).toBe('2026-08-22');
    expect(out.accounts.map((a) => a.name)).toEqual(['Private Bundle', 'Credit Card Plastic', 'Bon']);
    expect(out.skipped).toEqual([{ line: 'HE   oe', reason: 'Not an account row' }]);
  });

  it('strips the leaked row numbers and cell borders', () => {
    expect(find('Credit Card Plastic').numbers).toEqual(['370000000004714', '4000000000000117']);
    expect(find('Bon').number).toBe('8000000002801');
  });

  it('guesses types from the description when the type cell is gone', () => {
    expect(find('Private Bundle')).toMatchObject({ type: 'Bank', typeFrom: 'name', balance: 1761.12 });
    expect(find('Credit Card Plastic')).toMatchObject({
      type: 'Credit Card',
      typeFrom: 'column',
      balance: -117863.55,
      available: 12385.06,
      creditLimit: 130248.61,
      last4: '4714',
    });
    expect(find('Bon')).toMatchObject({
      type: 'Loan',
      kind: 'home',
      typeFrom: 'name',
      balance: -2747082.69,
      printedBalance: 2747082.69,
      signFromType: true,
    });
  });

  it('takes the type from the app\'s own record when the app knows the account', () => {
    const typed = parseStatement(OCR_SCALE2, { knownAccounts: KNOWN });
    const bundle = typed.accounts.find((a) => a.name === 'Private Bundle');
    expect(bundle).toMatchObject({ type: 'Savings', kind: 'savings', typeFrom: 'record', balance: 1761.12 });
    expect(typed.accounts.find((a) => a.name === 'Bon')).toMatchObject({
      type: 'Loan',
      typeFrom: 'record',
      balance: -2747082.69,
    });
    expect(typed.accounts.find((a) => a.type === 'Credit Card')).toMatchObject({ last4: '4714', typeFrom: 'record' });
  });
});

describe('parseNedbank, real OCR output at scale 3', () => {
  const out = parseNedbank(OCR_SCALE3, { knownMasks: ['0117'] });

  it('reads three accounts, amounts without separators included', () => {
    expect(out.accounts.map((a) => a.name)).toEqual(['Private Bundle', 'Credit Card Plastic', 'BOND']);
    expect(out.accounts[0]).toMatchObject({ type: 'Bank', balance: 1761.12, available: 1761.12 });
    expect(out.accounts[1]).toMatchObject({
      type: 'Credit Card',
      last4: '0117',
      balance: -117863.55,
      creditLimit: 130248.61,
      signFromType: false,
    });
    expect(out.accounts[1].numbers).toHaveLength(2);
    expect(out.accounts[2]).toMatchObject({ type: 'Loan', kind: 'home', balance: -2747082.69, last4: '2801' });
    expect(out.skipped).toEqual([{ line: 'NH a  om', reason: 'Not an account row' }]);
  });
});

describe('parseNedbank, noise', () => {
  it('accepts a thin space or a no-break space for the thousands', () => {
    const thin = parseNedbank(['2 Private Bundle 1000001825 Current R1 761.12 R1 761.12']);
    const nbsp = parseNedbank(['2 Private Bundle 1000001825 Current R1 761.12 R1 761.12']);
    expect(thin.accounts[0]).toMatchObject({ balance: 1761.12, available: 1761.12 });
    expect(nbsp.accounts[0]).toMatchObject({ balance: 1761.12, available: 1761.12 });
  });

  it('survives OCR noise in the rand sign', () => {
    const eight = parseNedbank(['4 Credit Card Plastic 370000000004714 AMEX - 8117 863.55 R12 385.06']);
    expect(eight.accounts[0]).toMatchObject({ balance: -117863.55, available: 12385.06, creditLimit: 130248.61 });

    const dropped = parseNedbank(['2 Private Bundle 1000001825 Current 1 761.12 1 761.12']);
    expect(dropped.accounts[0]).toMatchObject({ balance: 1761.12, available: 1761.12 });

    const doubled = parseNedbank(['2 Private Bundle 1000001825 Current Rr1 761.12 B1 761.12']);
    expect(doubled.accounts[0]).toMatchObject({ balance: 1761.12, available: 1761.12 });
  });

  it('collapses doubled spaces in the description', () => {
    const out = parseNedbank(['2  Private  Bundle  1000001825  Current  R1 761.12   R1 761.12']);
    expect(out.accounts[0]).toMatchObject({ name: 'Private Bundle', balance: 1761.12 });
  });

  it('takes a leading one- or two-digit token as the row number, junk or not', () => {
    expect(parseNedbank(['1 MiGoals 1000005284 Current R0.00 R0.00']).accounts[0].name).toBe('MiGoals');
    expect(parseNedbank(['4 | Credit Card Plastic 370000000004714 AMEX -R117 863.55 R12 385.06']).accounts[0].name).toBe(
      'Credit Card Plastic',
    );
    // The cost of that rule: a description that itself opens with a number loses it.
    expect(parseNedbank(['32 Day Notice 2000009530 Savings R500.00 R500.00']).accounts[0].name).toBe('Day Notice');
  });

  it('treats a card printed without a minus as owed all the same', () => {
    const out = parseNedbank(['4 Credit Card Plastic 370000000004714 AMEX R117 863.55 R12 385.06']);
    expect(out.accounts[0]).toMatchObject({ balance: -117863.55, signFromType: true, creditLimit: 130248.61 });
  });

  it('derives an overdraft for a current account in the red', () => {
    const out = parseNedbank(['2 Private Bundle 1000001825 Current - R500.00 R4 500.00']);
    expect(out.accounts[0]).toMatchObject({ type: 'Bank', balance: -500, available: 4500, overdraftLimit: 5000 });
  });

  it('reports a row it could not read both balances on', () => {
    const out = parseNedbank(['2 Private Bundle 1000001825 Current R1 761.12']);
    expect(out.accounts).toHaveLength(0);
    expect(out.skipped[0]).toMatchObject({ reason: 'Could not read both balances' });
  });
});

describe('detection', () => {
  it('recognises the Nedbank page by its title and never as FNB', () => {
    for (const fixture of [NEDBANK, OCR_SCALE2, OCR_SCALE3]) {
      expect(looksLikeNedbank(fixture)).toBe(true);
      expect(looksLikeFnb(fixture)).toBe(false);
    }
  });

  it('does not take a row alone as a Nedbank signal, since the structure is shared with FNB', () => {
    expect(looksLikeNedbank(['2 Private Bundle 1000001825 Current R1 761.12 R1 761.12'])).toBe(false);
  });

  it('parseStatement still reads a page with no title, trying both parsers', () => {
    const rows = NEDBANK.slice(4);
    const out = parseStatement(rows, { asOf: '2026-01-01' });
    expect(out.bank).toBe('Nedbank');
    expect(out.accounts).toHaveLength(5);
  });

  it('parseStatement routes to Nedbank and passes the known masks through', () => {
    const out = parseStatement(NEDBANK, { asOf: '2026-01-01', knownMasks: ['0117'] });
    expect(out.bank).toBe('Nedbank');
    expect(out.asOf).toBe('2026-08-22');
    expect(out.accounts.find((a) => a.type === 'Credit Card').last4).toBe('0117');
  });
});
