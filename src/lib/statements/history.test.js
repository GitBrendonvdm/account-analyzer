import { describe, expect, it } from 'vitest';
import { balanceFacts, kindOfHistory, looksLikeFnbHistory, parseFnbHistory, tidyDescription } from './history';

// Invented figures in the real file's shape: newest first, a running balance, the odd line that is
// not money.
const CHEQUE = `ACCOUNT TRANSACTION HISTORY

Name:, A, Person
Account:, 62500000001, [FNB Gold Cheque Account]
Balance:, 100.00, 5100.00

Date, Amount, Balance, Description
2026/10/15, -400.00, 100.00, TRANSFER
2026/10/15, 50.00, 500.00, Pay in eB - MONTHLYACCOUNTFEE
2026/10/15, 50.00, 450.00, Pay in eB - MONTHLYACCOUNTFEE
2026/10/12, 0.00, 400.00, CR.INT.RATE   5,90000
2026/10/10, 2000.00, 400.00, EDO ATTEMPT   SOMEBANK
2026/10/10, -300.00, 400.00, DEBIT ORDER
2026/10/08, -1,50.00, 700.00, BROKEN
2026/10/08, -25.00, 1000.00, #SERVICE FEES
2026/10/01, 1025.00, 1025.00, SALARY
`;

describe('parseFnbHistory', () => {
  it('reads the header and the lines', () => {
    const p = parseFnbHistory(CHEQUE.replace('-1,50.00', '-150.00').replace('700.00, BROKEN', '850.00, BROKEN'));
    expect(p.ok).toBe(true);
    expect(p.account).toEqual({ number: '62500000001', last4: '0001', name: 'FNB Gold Cheque Account', balance: 100, available: 5100 });
    expect(p.hasBalances).toBe(true);
    expect(p.newest).toBe('2026/10/15'.replace(/\//g, '-'));
    expect(p.oldest).toBe('2026-10-01');
  });

  it('sets aside announcements and lines that never moved the balance', () => {
    const p = parseFnbHistory(CHEQUE);
    expect(p.informational.map((i) => i.description)).toEqual(['CR.INT.RATE 5,90000']);
    expect(p.creditRate).toBe(5.9);
    expect(p.nonPosting).toEqual([{ date: '2026-10-10', amount: 2000, description: 'EDO ATTEMPT SOMEBANK' }]);
    expect(p.rows.map((r) => r.description)).not.toContain('EDO ATTEMPT SOMEBANK');
  });

  it('proves its own running balance and says where the chain breaks', () => {
    const clean = parseFnbHistory(
      CHEQUE.replace('2026/10/08, -1,50.00, 700.00, BROKEN\n', '2026/10/08, -300.00, 700.00, ANOTHER\n'),
    );
    expect(clean.chain.breaks).toEqual([]);
    const gap = parseFnbHistory(CHEQUE.replace('2026/10/08, -1,50.00, 700.00, BROKEN\n', ''));
    expect(gap.chain.breaks.length).toBe(1);
    expect(gap.chain.breaks[0]).toMatchObject({ date: '2026-10-10', expected: 700, actual: 1000 });
  });

  it('reads a card whose balance cells are all zero without a chain', () => {
    const card = parseFnbHistory(`ACCOUNT TRANSACTION HISTORY

Name:, A, Person
Account:, 448008******0000, [FNB Private Clients Credit Card]
Balance:, -29974.96, 129869

Date, Amount, Balance, Description
2026/10/12, -227.33, 0, DIS CHEM BRACKENFELL     BRACKENFELL  ZA
2026/10/10, -45.00, 0, VIDA E CAFFE BRACKENFE   Cape Town    ZA
`);
    expect(card.hasBalances).toBe(false);
    expect(card.chain).toEqual({ checked: 0, breaks: [] });
    expect(card.rows).toHaveLength(2);
    expect(card.account.last4).toBe('0000');
    expect(kindOfHistory(card)).toMatchObject({ type: 'Credit Card' });
    expect(balanceFacts(card, 'Credit Card')).toMatchObject({
      currentBalance: -29974.96,
      balanceAsOf: '2026-10-12',
      creditLimit: 159843.96,
    });
  });

  it('keeps a comma inside the description', () => {
    const p = parseFnbHistory(CHEQUE);
    expect(parseFnbHistory(`${CHEQUE}2026/09/30, -10.00, 1015.00, SHOP, BRANCH 1\n`).rows.at(-1).description).toBe('SHOP, BRANCH 1');
    expect(p.rows.at(-1).description).toBe('SALARY');
  });

  it('refuses a file that is not one', () => {
    expect(parseFnbHistory('Date,Description,Account\n1,2,3').ok).toBe(false);
    expect(looksLikeFnbHistory('Date,Description,Account\n1,2,3')).toBe(false);
    expect(looksLikeFnbHistory(CHEQUE)).toBe(true);
  });
});

describe('balanceFacts', () => {
  it('derives an overdraft from the header and signs a liability negative', () => {
    const p = parseFnbHistory(CHEQUE);
    expect(balanceFacts(p, 'Bank')).toMatchObject({ currentBalance: 100, overdraftLimit: 5000, balanceAsOf: '2026-10-15' });
  });

  it('takes a loan whose header says N/A from the figure beside it', () => {
    const loan = parseFnbHistory(`ACCOUNT TRANSACTION HISTORY

Name:, A, Person
Account:, 3000021106996, [FNB Private Clients Home Loan]
Balance:, N/A, -603423.20

Date, Amount, Balance, Description
2026/09/25, 6674.53, -603423.20, DC DEBIT ORDER
2026/09/25, -69.00, -610097.73, MONTHLY SERVICE FEE
`);
    expect(kindOfHistory(loan)).toMatchObject({ type: 'Loan', kind: 'home' });
    expect(balanceFacts(loan, 'Loan').currentBalance).toBe(-603423.2);
  });

  it('reads a revolving facility as a loan with nothing left to draw', () => {
    const rf = parseFnbHistory(`ACCOUNT TRANSACTION HISTORY

Name:, A, Person
Account:, 63200000001, [FNB Revolving Facility]
Balance:, -362000.00, 0.00

Date, Amount, Balance, Description
2026/10/15, -793.00, -362000.00, TRANSFER
2026/10/15, -360000.00, -361207.00, TRANSFER
2026/10/15, -1207.00, -1207.00, #5GE #RF INITIATION FEE
`);
    expect(kindOfHistory(rf)).toMatchObject({ type: 'Loan', kind: 'revolving' });
    expect(balanceFacts(rf, 'Loan')).toMatchObject({ currentBalance: -362000, undrawn: 0 });
    expect(rf.chain.breaks).toEqual([]);
  });
});

describe('kindOfHistory and tidyDescription', () => {
  it('leaves eBucks out: those amounts are points', () => {
    const e = { account: { name: 'eBucks Account', number: '80100000001' } };
    expect(kindOfHistory(e)).toMatchObject({ rewards: true });
  });

  it('tidies the bank shouting but leaves mixed case alone', () => {
    expect(tidyDescription('#MONTHLY ACCOUNT FEE')).toBe('Monthly Account Fee');
    expect(tidyDescription('B-SURELIFEBLP6738057    261008')).toBe('B-Surelifeblp6738057 261008');
    expect(tidyDescription('Spar Brackenfell         Western Cape ZA')).toBe('Spar Brackenfell Western Cape ZA');
  });
});
