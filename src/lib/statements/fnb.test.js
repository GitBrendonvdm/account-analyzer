import { describe, expect, it } from 'vitest';
import { looksLikeFnb, parseFnb, typeFromName } from './fnb';
import { looksLikeNedbank } from './nedbank';
import { parseStatement } from './index';
import { linesFromTextItems } from './extract';

// Account numbers in these fixtures are synthetic; only the last four digits are realistic.

// The two-page "My Bank Accounts" overview as a naive extractor gives it: cells run together,
// headings out of order, totals and a rewards account mixed in with the money.
const FNB_RUN = [
  'Available BalanceBalanceAccount NumberAccount Name',
  'Savings And Investments',
  'Available BalanceBalanceAccount NumberAccount Name',
  'Global Accounts',
  'Rewards',
  'Day To Day',
  ' ',
  'My Bank Accounts',
  'R 8,956.43R -9,341.9755500019986FNB Gold Cheque Account',
  'R 1,722.00R 0.00411111******2000FNB Premier Credit Card',
  'R 67,761.00R -55,066.92422222******0000FNB Private Clients Credit Card',
  '78,439.43-64,408.89 Total',
  'eB 7,655.00eB 7,655.0055500018452eBucks Account',
  '7,655.007,655.00 Total',
  'R 38.04R 38.0455500029547Day To Day Savings',
  'Loans',
  'Smart Device',
  'This is the advanced search div!!!',
  'R 168.44R 168.4455500034359Emergency Fund',
  'R 17,227.87R 17,227.87555001412Retirement Annuity',
  '17,434.3517,434.35 Total',
  'R 0.00R -606,845.075550000006996FNB Private Clients Home Loan',
  'R 1,239.97R -77,506.7555500044081Mazda Cx5 Load',
  'R 0.00R -171,031.415550000001143Personal Loan',
  '1,239.97-855,383.23 Total',
];

// The same file as PDF.js positions it: cells separated, and the columns the other way round —
// name, number, balance, available.
const FNB_SPACED = [
  'My Bank Accounts',
  'Day To Day',
  'Account Name Account Number Balance Available Balance',
  'FNB Gold Cheque Account 55500019986 R -9,341.97 R 8,956.43',
  'FNB Premier Credit Card 411111******2000 R 0.00 R 1,722.00',
  'FNB Private Clients Credit Card 422222******0000 R -55,066.92 R 67,761.00',
  'Total -64,408.89 78,439.43',
  'Rewards',
  'Account Name Account Number Balance Available Balance',
  'eBucks Account 55500018452 eB 7,655.00 eB 7,655.00',
  'Total 7,655.00 7,655.00',
  'Global Accounts',
  'Account Name Account Number Balance Available Balance',
  'Savings And Investments',
  'Account Name Account Number Balance Available Balance',
  'Day To Day Savings 55500029547 R 38.04 R 38.04',
  'Emergency Fund 55500034359 R 168.44 R 168.44',
  'Retirement Annuity 555001412 R 17,227.87 R 17,227.87',
  'Total 17,434.35 17,434.35',
  'Smart Device',
  'Account Name Account Number Balance Available Balance',
  'Loans',
  'Account Name Account Number Balance Available Balance',
  'FNB Private Clients Home Loan 5550000006996 R -606,845.07 R 0.00',
  'Mazda Cx5 Load 55500044081 R -77,506.75 R 1,239.97',
  'Personal Loan 5550000001143 R -171,031.41 R 0.00',
  'Total -855,383.23 1,239.97',
  'This is the advanced search div!!!',
];

const NAMES = [
  'FNB Gold Cheque Account',
  'FNB Premier Credit Card',
  'FNB Private Clients Credit Card',
  'Day To Day Savings',
  'Emergency Fund',
  'Retirement Annuity',
  'FNB Private Clients Home Loan',
  'Mazda Cx5 Load',
  'Personal Loan',
];

describe.each([
  ['run-together', FNB_RUN],
  ['spaced', FNB_SPACED],
])('parseFnb, %s layout', (_, FIXTURE) => {
  const parsed = parseFnb(FIXTURE, { asOf: '2026-08-22' });
  const byName = (name) => parsed.accounts.find((a) => a.name === name);

  it('reads every account row, in order, and nothing else', () => {
    expect(parsed.bank).toBe('FNB');
    expect(parsed.asOf).toBe('2026-08-22');
    expect(parsed.accounts.map((a) => a.name)).toEqual(NAMES);
  });

  it('reads the cheque account and derives its overdraft', () => {
    expect(byName('FNB Gold Cheque Account')).toMatchObject({
      bank: 'FNB',
      number: '55500019986',
      numbers: ['55500019986'],
      last4: '9986',
      type: 'Bank',
      kind: 'cheque',
      typeFrom: 'label',
      balance: -9341.97,
      printedBalance: -9341.97,
      available: 8956.43,
      overdraftLimit: 18298.4,
      creditLimit: null,
      signFromType: false,
      currency: 'ZAR',
    });
  });

  it('keeps the last four of a masked card number', () => {
    expect(byName('FNB Premier Credit Card')).toMatchObject({
      number: '411111******2000',
      last4: '2000',
      type: 'Credit Card',
      kind: 'card',
      balance: 0,
      available: 1722,
      creditLimit: 1722,
      overdraftLimit: null,
    });
  });

  it('derives a card limit from available credit plus what is owed', () => {
    expect(byName('FNB Private Clients Credit Card')).toMatchObject({
      last4: '0000',
      balance: -55066.92,
      available: 67761,
      creditLimit: 122827.92,
    });
  });

  it('types savings, funds and annuities from their names, nine-digit numbers included', () => {
    expect(byName('Day To Day Savings')).toMatchObject({ type: 'Savings', kind: 'savings', balance: 38.04, last4: '9547' });
    expect(byName('Emergency Fund')).toMatchObject({ type: 'Savings', kind: 'savings', balance: 168.44, last4: '4359' });
    expect(byName('Retirement Annuity')).toMatchObject({
      type: 'Savings',
      kind: 'investment',
      balance: 17227.87,
      number: '555001412',
      last4: '1412',
    });
  });

  it('types the loans, including the bank\'s own "Load" typo', () => {
    expect(byName('FNB Private Clients Home Loan')).toMatchObject({
      type: 'Loan',
      kind: 'home',
      balance: -606845.07,
      available: 0,
      last4: '6996',
    });
    expect(byName('Mazda Cx5 Load')).toMatchObject({ type: 'Loan', kind: 'vehicle', balance: -77506.75, available: 1239.97, last4: '4081' });
    expect(byName('Personal Loan')).toMatchObject({ type: 'Loan', kind: 'personal', balance: -171031.41, last4: '1143' });
  });

  it('never invents a limit for a loan or a savings account', () => {
    for (const a of parsed.accounts.filter((x) => x.type === 'Loan' || x.type === 'Savings')) {
      expect(a.creditLimit).toBeNull();
      expect(a.overdraftLimit).toBeNull();
    }
  });

  it('skips eBucks as points, drops the furniture silently, and reports everything else', () => {
    expect(parsed.skipped).toEqual([
      { line: expect.stringContaining('eBucks'), reason: 'rewards points, not money' },
      { line: 'This is the advanced search div!!!', reason: 'Not an account row' },
    ]);
  });

  it('is recognised as FNB and not as Nedbank', () => {
    expect(looksLikeFnb(FIXTURE)).toBe(true);
    expect(looksLikeNedbank(FIXTURE)).toBe(false);
    expect(parseStatement(FIXTURE, { asOf: '2026-08-22' })).toMatchObject({ bank: 'FNB', asOf: '2026-08-22' });
    expect(parseStatement(FIXTURE).accounts).toHaveLength(9);
  });
});

describe('parseFnb, edges', () => {
  it('reads a row the same with or without spaces between the cells', () => {
    const tight = parseFnb(['R 8,956.43R -9,341.9755500019986FNB Gold Cheque Account']);
    const loose = parseFnb(['R 8,956.43 R -9,341.97 55500019986 FNB Gold Cheque Account']);
    for (const out of [tight, loose]) {
      expect(out.accounts[0]).toMatchObject({
        name: 'FNB Gold Cheque Account',
        number: '55500019986',
        balance: -9341.97,
        available: 8956.43,
        overdraftLimit: 18298.4,
      });
    }
  });

  it('signs a card in credit as owed, and says the type did it', () => {
    const out = parseFnb(['FNB Premier Credit Card 411111******2000 R 200.00 R 1,922.00']);
    expect(out.accounts[0]).toMatchObject({
      balance: -200,
      printedBalance: 200,
      signFromType: true,
      creditLimit: 2122,
    });
  });

  it('leaves a foreign-currency account out, with a reason', () => {
    const out = parseFnb(['$ 100.00$ 100.0055500012345Global USD Account']);
    expect(out.accounts).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/foreign currency/);
  });

  it('has no date of its own', () => {
    expect(parseFnb(FNB_SPACED).asOf).toBeNull();
  });
});

describe('typeFromName', () => {
  it('reads type and kind from a bank label or a description', () => {
    expect(typeFromName('FNB Premier Credit Card')).toEqual({ type: 'Credit Card', kind: 'card' });
    expect(typeFromName('Credit Card Plastic')).toEqual({ type: 'Credit Card', kind: 'card' });
    expect(typeFromName('Home Loan')).toEqual({ type: 'Loan', kind: 'home' });
    expect(typeFromName('BOND')).toEqual({ type: 'Loan', kind: 'home' });
    expect(typeFromName('Bon')).toEqual({ type: 'Loan', kind: 'home' });
    expect(typeFromName('Mortgage')).toEqual({ type: 'Loan', kind: 'home' });
    expect(typeFromName('Mazda Cx5 Load')).toEqual({ type: 'Loan', kind: 'vehicle' });
    expect(typeFromName('Vehicle Finance Loan')).toEqual({ type: 'Loan', kind: 'vehicle' });
    expect(typeFromName('Personal Loan')).toEqual({ type: 'Loan', kind: 'personal' });
    expect(typeFromName('Student Loan')).toEqual({ type: 'Loan', kind: 'other' });
    expect(typeFromName('Gold Cheque Account')).toEqual({ type: 'Bank', kind: 'cheque' });
    expect(typeFromName('Private Bundle')).toEqual({ type: 'Bank', kind: 'cheque' });
    expect(typeFromName('MiGoals')).toEqual({ type: 'Bank', kind: 'cheque' });
    expect(typeFromName('Emergency Fund')).toEqual({ type: 'Savings', kind: 'savings' });
    expect(typeFromName('Save')).toEqual({ type: 'Savings', kind: 'savings' });
    expect(typeFromName('Retirement Annuity')).toEqual({ type: 'Savings', kind: 'investment' });
    expect(typeFromName('Tax-Free Investment')).toEqual({ type: 'Savings', kind: 'investment' });
    expect(typeFromName('Smart Device')).toEqual({ type: 'Other', kind: null });
    expect(typeFromName('other')).toEqual({ type: 'Other', kind: null });
  });
});

describe('detection', () => {
  it('recognises a lone FNB row by its label', () => {
    expect(looksLikeFnb(['FNB Gold Cheque Account 55500019986 R -9,341.97 R 8,956.43'])).toBe(true);
  });

  it('parseStatement defaults the date to today when FNB gives none', () => {
    expect(parseStatement(FNB_SPACED).asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parseStatement gives up cleanly on something that is neither', () => {
    expect(parseStatement(['Dear customer', 'Thank you for banking with us'])).toMatchObject({
      bank: null,
      accounts: [],
      skipped: [],
    });
  });
});

// The line builder lives in extract.js, next to the PDF.js call that feeds it; it is pure, and the
// FNB format is the one that depends on how it joins cells, so it is tested here.
describe('linesFromTextItems', () => {
  const item = (str, x, y, width) => ({ str, transform: [1, 0, 0, 1, x, y], width });

  it('joins abutting cells with no space, reproducing the run-together FNB row', () => {
    const items = [
      item('R 8,956.43', 40, 700, 60),
      item('R -9,341.97', 100, 700, 66),
      item('55500019986', 166, 700, 66),
      item('FNB Gold Cheque Account', 232, 700, 138),
    ];
    expect(linesFromTextItems(items)).toEqual([
      'R 8,956.43R -9,341.9755500019986FNB Gold Cheque Account',
    ]);
  });

  it('puts a space where the gap is wider than a character and a half', () => {
    const items = [
      item('FNB Gold Cheque Account', 40, 700, 138),
      item('55500019986', 230, 700, 66),
      item('R -9,341.97', 330, 700, 66),
      item('R 8,956.43', 430, 700, 60),
    ];
    expect(linesFromTextItems(items)).toEqual([
      'FNB Gold Cheque Account 55500019986 R -9,341.97 R 8,956.43',
    ]);
  });

  it('groups by baseline within tolerance and orders top to bottom, left to right', () => {
    const items = [
      item('second', 40, 680, 36),
      item('Account', 300, 701.5, 42),
      item('R 1.00', 40, 700, 36),
      item('', 10, 700, 0),
      { type: 'beginMarkedContent' },
    ];
    expect(linesFromTextItems(items)).toEqual(['R 1.00 Account', 'second']);
  });
});
