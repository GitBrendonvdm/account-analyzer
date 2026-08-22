import { describe, expect, it } from 'vitest';
import {
  accountRows,
  anchorOffset,
  balanceAt,
  dailyPositions,
  positionAt,
  selfAnchored,
} from './ledger';
import { parseAccount } from './accounts';
import { loadRealExport } from '../test/realData';

const ACCOUNT = 'FNB Bank *9986';

function row(date, amount, extra = {}) {
  return {
    Date: date,
    Description: extra.Description ?? 'Row',
    Account: extra.Account ?? ACCOUNT,
    Category: 'Groceries',
    'Pay Month': date.slice(0, 7),
    AmountNum: amount,
    ...extra,
  };
}

// Days 1, 5 and 9 of March 2026: +100, −30, −20.
const ROWS = [row('2026-03-01', 100), row('2026-03-05', -30), row('2026-03-09', -20)];
const iso = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

describe('positionAt', () => {
  it('sums rows up to and including the date, and reads 0 before the file', () => {
    expect(positionAt(ROWS, '2026-03-06')).toBe(70);
    expect(positionAt(ROWS, '2026-03-05')).toBe(70);
    expect(positionAt(ROWS, new Date(2026, 2, 9))).toBe(50);
    expect(positionAt(ROWS, '2026-02-28')).toBe(0);
    expect(positionAt(ROWS, null)).toBe(0);
    expect(positionAt([], '2026-03-06')).toBe(0);
  });
});

describe('anchorOffset and balanceAt', () => {
  it('anchors at balanceAsOf', () => {
    const account = { currentBalance: 1000, balanceAsOf: '2026-03-06' };
    expect(anchorOffset(ROWS, account)).toBe(930);
    expect(balanceAt(ROWS, account, '2026-03-09')).toBe(980);
    expect(balanceAt(ROWS, account, '2026-03-06')).toBe(1000);
    expect(balanceAt(ROWS, account, '2026-02-01')).toBe(930);
  });

  it('does not drift when later rows are appended', () => {
    const account = { currentBalance: 1000, balanceAsOf: '2026-03-06' };
    const before = balanceAt(ROWS, account, '2026-03-06');
    const appended = [...ROWS, row('2026-03-12', -500)];
    expect(balanceAt(appended, account, '2026-03-06')).toBe(before);
    expect(balanceAt(appended, account, '2026-03-12')).toBe(480);
  });

  it('falls back to the last row when no as-of date is recorded', () => {
    const account = { currentBalance: 1000 };
    expect(anchorOffset(ROWS, account)).toBe(950);
    expect(balanceAt(ROWS, account, '2026-03-09')).toBe(1000);
  });

  it('reads an as-of date before the first row as the balance itself', () => {
    const account = { currentBalance: 250, balanceAsOf: '2026-01-01' };
    expect(anchorOffset(ROWS, account)).toBe(250);
    expect(balanceAt(ROWS, account, '2026-03-09')).toBe(300);
    expect(anchorOffset([], { currentBalance: 250 })).toBe(250);
  });

  it('is null without a finite balance', () => {
    expect(anchorOffset(ROWS, { currentBalance: null })).toBeNull();
    expect(anchorOffset(ROWS, {})).toBeNull();
    expect(anchorOffset(ROWS, null)).toBeNull();
    expect(balanceAt(ROWS, { currentBalance: NaN }, '2026-03-09')).toBeNull();
  });
});

describe('accountRows', () => {
  it('selects by raw names or by stable id, sorted by date then key then id', () => {
    const data = [
      { ...row('2026-03-05', -30), Account: 'FNB Bank *9547', key: 'b', id: 1 },
      { ...row('2026-03-05', -10), Account: 'FNB Savings *9547', key: 'a', id: 2 },
      { ...row('2026-03-01', 100), Account: 'FNB Bank *9547', key: 'c', id: 3 },
      { ...row('2026-03-02', -1), Account: ACCOUNT, key: 'd', id: 4 },
      { ...row('', -1), Account: ACCOUNT, key: 'e', id: 5 },
    ];
    const byId = accountRows(data, { accountId: 'fnb|9547' });
    expect(byId.map((t) => t.id)).toEqual([3, 2, 1]);
    const byName = accountRows(data, { rawNames: ['FNB Bank *9547'] });
    expect(byName.map((t) => t.id)).toEqual([3, 1]);
    // A row with no readable date cannot be positioned and is left out.
    expect(accountRows(data, { rawNames: [ACCOUNT] }).map((t) => t.id)).toEqual([4]);
    expect(accountRows(data, {})).toEqual([]);
  });
});

describe('dailyPositions', () => {
  it('carries the closing position across a quiet gap', () => {
    const rows = [row('2026-03-01', 100), row('2026-03-12', -40)];
    const days = dailyPositions(rows, '2026-03-01', '2026-03-14');
    expect(days).toHaveLength(14);
    expect(iso(days[0].date)).toBe('2026-03-01');
    expect(days[0].position).toBe(100);
    expect(days.slice(1, 11).every((d) => d.position === 100)).toBe(true);
    expect(days[11].position).toBe(60);
    expect(days[13].position).toBe(60);
  });

  it('folds rows before the window into the opening', () => {
    const days = dailyPositions(ROWS, '2026-03-06', '2026-03-10');
    expect(days.map((d) => d.position)).toEqual([70, 70, 70, 50, 50]);
    expect(dailyPositions(ROWS, '2026-03-10', '2026-03-06')).toEqual([]);
  });
});

describe('selfAnchored', () => {
  const instalment = (date) => row(date, 2224.44, { Description: 'Instalment' });

  it('anchors a loan that begins with its disbursement', () => {
    const rows = [
      row('2025-01-05', -100000, { Description: 'Loan disbursement' }),
      instalment('2025-02-05'),
      instalment('2025-03-05'),
      instalment('2025-04-05'),
    ];
    const r = selfAnchored(rows);
    expect(r.anchored).toBe(true);
    expect(r.balanceOwed).toBeCloseTo(93326.68, 2);
    expect(iso(r.disbursementDate)).toBe('2025-01-05');
    expect(r.drawAmount).toBe(100000);
  });

  it('never anchors a loan exported mid-life', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`2026-0${i + 2}-05`, 4990.67));
    expect(selfAnchored(rows)).toEqual({
      anchored: false,
      balanceOwed: null,
      disbursementDate: null,
      drawAmount: null,
    });
    expect(selfAnchored([]).anchored).toBe(false);
  });

  it('needs the draw to dwarf the instalment, and to be in the first rows', () => {
    const small = [row('2025-01-05', -60000), ...Array.from({ length: 3 }, (_, i) => row(`2025-0${i + 2}-05`, 5000))];
    expect(selfAnchored(small).anchored).toBe(false);
    const late = [
      ...Array.from({ length: 5 }, (_, i) => row(`2025-0${i + 1}-05`, -800, { Description: 'Interest' })),
      row('2025-06-05', -100000),
      row('2025-07-05', 2224.44),
    ];
    expect(selfAnchored(late).anchored).toBe(false);
  });

  it('ignores rebates when sizing the typical repayment', () => {
    const rows = [
      row('2025-01-05', -100000),
      row('2025-01-06', 12, { Description: 'Interest rebate' }),
      instalment('2025-02-05'),
      instalment('2025-03-05'),
      instalment('2025-04-05'),
    ];
    const r = selfAnchored(rows);
    expect(r.anchored).toBe(true);
    expect(r.balanceOwed).toBeCloseTo(93314.68, 2);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('ledger on the real export', () => {
  it('self-anchors at least three of the loan accounts', () => {
    const loans = [...new Set(real.map((t) => t.Account))].filter((a) => parseAccount(a).type === 'Loan');
    expect(loans.length).toBeGreaterThanOrEqual(3);
    const anchored = loans.map((name) => selfAnchored(accountRows(real, { rawNames: [name] })));
    expect(anchored.filter((a) => a.anchored).length).toBeGreaterThanOrEqual(3);
    anchored
      .filter((a) => a.anchored)
      .forEach((a) => {
        expect(a.balanceOwed).toBeGreaterThan(0);
        expect(a.drawAmount).toBeGreaterThanOrEqual(50000);
        expect(a.disbursementDate).toBeInstanceOf(Date);
      });
  });

  it('keeps a typed balance fixed at its as-of date whatever rows follow', () => {
    const name = [...new Set(real.map((t) => t.Account))].find((a) => parseAccount(a).type === 'Bank');
    const rows = accountRows(real, { rawNames: [name] });
    const mid = rows[Math.floor(rows.length / 2)].Date;
    const account = { currentBalance: 1234.56, balanceAsOf: mid };
    const truncated = rows.filter((t) => t.Date <= mid);
    expect(balanceAt(rows, account, mid)).toBeCloseTo(1234.56, 6);
    expect(balanceAt(truncated, account, mid)).toBeCloseTo(1234.56, 6);
  });
});
