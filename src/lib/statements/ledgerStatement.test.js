import { describe, expect, it } from 'vitest';
import { looksLikeFnbStatement, parseFnbStatement } from './ledgerStatement';

/**
 * A statement as pdf.js hands it over: positioned fragments, not lines. The x positions are the
 * ones measured on a real FNB cheque statement — description at 38, amounts ending near 475,
 * balances at 507, the accrued-charges column at 568 — so the column logic is exercised on the
 * geometry it will meet, with invented figures.
 */
const fmt = (n) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function header(items, { number, from, to, opening, facility }) {
  items.push({ str: `FNB Fusion Private Clients Acc : ${number}`, x: 410, y: 567 });
  items.push({ str: `Statement Period : ${from} to ${to}`, x: 389, y: 544 });
  items.push({ str: `Statement Date : ${to}`, x: 462, y: 535 });
  items.push({ str: 'Tax Invoice/Statement Number : 144', x: 456, y: 553 });
  items.push({ str: 'Opening Balance', x: 20, y: 510 });
  items.push({ str: `${fmt(opening)} ${opening >= 0 ? 'Cr' : 'Dr'}`, x: 180, y: 510 });
  items.push({ str: 'Facility Limit', x: 434, y: 491 });
  items.push({ str: fmt(facility), x: 546, y: 491 });
}

function tableHeader(items, y = 433) {
  items.push({ str: 'Date', x: 16, y: y + 1 });
  items.push({ str: 'Description', x: 209, y });
  items.push({ str: 'Amount', x: 437, y });
  items.push({ str: 'Balance', x: 499, y });
  items.push({ str: 'Accrued', x: 548, y: y + 10 });
  items.push({ str: 'Bank', x: 554, y: y + 1 });
  items.push({ str: 'Charges', x: 548, y: y - 8 });
  // The page footer also says "Date" — it must not be taken for the table's.
  items.push({ str: 'Date', x: 245, y: 45 });
}

function line(items, y, { day, description, amount, balance, accrued, reference }) {
  items.push({ str: day, x: 12, y });
  if (description) items.push({ str: description, x: 38, y });
  if (reference) items.push({ str: reference, x: 309, y });
  items.push({ str: `${fmt(amount)}${amount > 0 ? 'Cr' : ''}`, x: amount > 0 ? 444 : 447, y });
  items.push({ str: `${fmt(balance)}${balance >= 0 ? 'Cr' : ''}`, x: 507, y });
  if (accrued) items.push({ str: fmt(accrued), x: 568, y });
}

function statement({
  lines,
  opening = 1000,
  number = '62500009986',
  from = '8 September 2026',
  to = '8 October 2026',
  split = lines.length,
  closing,
  turnover,
}) {
  const first = { items: [] };
  header(first.items, { number, from, to, opening, facility: 5000 });
  tableHeader(first.items);
  lines.slice(0, split).forEach((l, i) => line(first.items, 412 - i * 10, l));
  const second = { items: [] };
  if (split < lines.length) {
    second.items.push({ str: `Transactions in RAND (ZAR) : ${number}`, x: 11, y: 457 });
    tableHeader(second.items);
    lines.slice(split).forEach((l, i) => line(second.items, 412 - i * 10, l));
  }
  const end = closing ?? lines[lines.length - 1].balance;
  second.items.push({ str: 'Closing Balance', x: 45, y: 200 });
  second.items.push({ str: `${fmt(end)}${end >= 0 ? 'Cr' : ''}`, x: 500, y: 200 });
  if (turnover) {
    second.items.push({ str: 'Turnover for Statement Period', x: 102, y: 180 });
    second.items.push({ str: `No. Credit Transactions ${turnover.credits[0]}`, x: 104, y: 170 });
    second.items.push({ str: `${fmt(turnover.credits[1])} Cr`, x: 452, y: 170 });
    second.items.push({ str: `No. Debit Transactions ${turnover.debits[0]}`, x: 104, y: 160 });
    second.items.push({ str: `${fmt(turnover.debits[1])} Dr`, x: 452, y: 160 });
  }
  return [first, second];
}

const LINES = [
  { day: '14 Sep', description: 'POS Purchase 199.99 Apple.Com/Bi', reference: '410588*1547 13 Sep', amount: -199.99, balance: 800.01 },
  { day: '16 Sep', amount: -5.5, balance: 794.51 }, // a fee: the bank prints no description
  { day: '21 Sep', description: 'Electricity Prepaid', amount: -100, balance: 694.51, accrued: 2.5 },
  { day: '25 Sep', description: 'Edo Collection Attempt Somebank', amount: 450, balance: 694.51 }, // never happened
  { day: '25 Sep', description: 'Magtape Credit Pay From Elsewhere', amount: 500, balance: 1194.51 },
  { day: '26 Sep', description: 'DebiCheck Lender', amount: -1500, balance: -305.49 }, // overdrawn: no Cr
  { day: '01 Oct', description: 'Salary', amount: 2000, balance: 1694.51 },
];
const TURNOVER = { credits: [2, 2500], debits: [4, 1805.49] };

describe('parseFnbStatement', () => {
  it('reads the columns, the signs and the totals', () => {
    const s = parseFnbStatement(statement({ lines: LINES, turnover: TURNOVER }));
    expect(s.ok).toBe(true);
    expect(s.account).toEqual({ number: '62500009986', last4: '9986', name: 'FNB Fusion Private Clients Acc' });
    expect(s.period).toEqual({ from: '2026-09-08', to: '2026-10-08' });
    expect(s).toMatchObject({ opening: 1000, closing: 1694.51, facilityLimit: 5000, statementNumber: '144' });
    expect(s.lines).toHaveLength(7);
    expect(s.lines[0]).toMatchObject({ date: '2026-09-14', amount: -199.99, balance: 800.01 });
    // A description's own 199.99 is not the amount.
    expect(s.lines[0].description).toBe('POS Purchase 199.99 Apple.Com/Bi 410588*1547 13 Sep');
    expect(s.lines[1].description).toBe('');
    expect(s.lines[2].accrued).toBe(2.5);
    expect(s.lines[5]).toMatchObject({ amount: -1500, balance: -305.49 });
    expect(s.checks).toEqual({ chain: true, closing: true, turnover: true });
    expect(s.warnings).toEqual([]);
  });

  it('marks a credit that never moved the balance, and leaves it out of the totals', () => {
    const s = parseFnbStatement(statement({ lines: LINES, turnover: TURNOVER }));
    const attempt = s.lines.find((l) => /Edo/.test(l.description));
    expect(attempt).toMatchObject({ nonPosting: true, verified: true });
    expect(s.counted.credits).toEqual({ count: 2, sum: 2500 });
  });

  it('follows a table across a page break', () => {
    const s = parseFnbStatement(statement({ lines: LINES, split: 3, turnover: TURNOVER }));
    expect(s.lines).toHaveLength(7);
    expect(s.lines.map((l) => l.page)).toEqual([1, 1, 1, 2, 2, 2, 2]);
    expect(s.checks.chain).toBe(true);
  });

  it('does not vouch for a line that breaks the running balance', () => {
    const broken = LINES.map((l) => (l.day === '21 Sep' ? { ...l, balance: 600 } : l));
    const s = parseFnbStatement(statement({ lines: broken, closing: 1694.51, turnover: TURNOVER }));
    expect(s.lines[2].verified).toBe(false);
    expect(s.checks.chain).toBe(false);
    expect(s.warnings.join(' ')).toMatch(/misread/);
  });

  it('puts a statement that straddles the new year in the right years', () => {
    const s = parseFnbStatement(
      statement({
        from: '8 December 2026',
        to: '8 January 2027',
        opening: 100,
        lines: [
          { day: '28 Dec', description: 'Shop', amount: -10, balance: 90 },
          { day: '03 Jan', description: 'Shop', amount: -10, balance: 80 },
        ],
      }),
    );
    expect(s.lines.map((l) => l.date)).toEqual(['2026-12-28', '2027-01-03']);
  });

  it('says so when a document is not a table it can read', () => {
    expect(looksLikeFnbStatement([{ items: [{ str: 'Hello', x: 0, y: 0 }] }])).toBe(false);
    expect(parseFnbStatement([{ items: [{ str: 'Hello', x: 0, y: 0 }] }])).toMatchObject({ ok: false });
    const noTable = [
      { items: [{ str: 'FNB Credit Card : 4480080587390000', x: 10, y: 500 }, { str: 'Statement Period : 8 September 2026 to 8 October 2026', x: 10, y: 480 }, { str: 'Opening Balance', x: 10, y: 460 }, { str: 'Closing Balance', x: 10, y: 440 }] },
    ];
    expect(parseFnbStatement(noTable)).toMatchObject({ ok: false });
  });
});
