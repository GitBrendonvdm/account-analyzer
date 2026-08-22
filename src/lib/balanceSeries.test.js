import { describe, expect, it } from 'vitest';
import { buildBalanceBands } from './balanceSeries';
import { processTransactionData } from './processTransactionData';
import { parseTransactionDate } from '../utils/date';

/**
 * Three cycles on the 23rd boundary: 2026-06 (23 May–22 Jun, 31 days), 2026-07 (23 Jun–22 Jul,
 * 30 days), 2026-08 (23 Jul–22 Aug, 31 days).
 */
const BANK = 'FNB Bank *1111';
const OTHER = 'FNB Bank *4444';

let nextId = 1;
function row(date, account, amount) {
  const d = parseTransactionDate(date);
  const payMonth = d.getDate() >= 23 ? `${d.getFullYear()}-${String(d.getMonth() + 2).padStart(2, '0')}` : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return {
    id: nextId++,
    Date: date,
    DateObj: d,
    Description: 'row',
    Account: account,
    Category: 'Groceries',
    'Pay Month': payMonth,
    AmountNum: amount,
  };
}

function fixture() {
  const rows = [];
  ['2026-05-23', '2026-06-23', '2026-07-23'].forEach((start) => {
    rows.push(row(start, BANK, 50000)); // salary on the boundary
    const d = parseTransactionDate(start);
    for (let k = 2; k <= 20; k += 3) {
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
      rows.push(row(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, BANK, -1500));
    }
  });
  rows.push(row('2026-05-23', OTHER, 100), row('2026-06-23', OTHER, 100), row('2026-07-23', OTHER, 100));
  return rows;
}

const record = (id, rawName, type, extra = {}) => ({
  id,
  rawName,
  type,
  typeOverride: null,
  seenNames: [rawName],
  currentBalance: null,
  balanceAsOf: null,
  ...extra,
});

const asOf = new Date(2026, 7, 10); // 10 Aug 2026, cycle day 19 of 2026-08
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('buildBalanceBands — as-of anchoring', () => {
  it('reads the stated balance on the as-of day, and a later import cannot move it', () => {
    const data = fixture();
    const names = [BANK, OTHER];
    const accounts = [
      record('fnb|1111', BANK, 'Bank', { currentBalance: 120000, balanceAsOf: '2026-07-30' }),
      record('fnb|4444', OTHER, 'Bank', { currentBalance: 300, balanceAsOf: '2026-07-30' }),
    ];
    const processed = processTransactionData(data, names, 3, asOf);
    const bands = buildBalanceBands(data, names, accounts, processed, { cycles: 3 });
    expect(bands.anchored).toBe(true);
    expect(bands.anchoredCount).toBe(2);

    // 30 Jul is day 8 of the current cycle (23 Jul = day 1): the summed series reads the two balances.
    const current = bands.series.find((s) => s.isCurrent);
    expect(current.points[7]).toBeCloseTo(120300, 6);

    // Rows after the as-of date: the as-of day still reads the stated balance.
    const more = [...data, row('2026-08-05', BANK, -7000)];
    const later = buildBalanceBands(more, names, accounts, processTransactionData(more, names, 3, asOf), { cycles: 3 });
    expect(later.series.find((s) => s.isCurrent).points[7]).toBeCloseTo(120300, 6);
    expect(later.series.find((s) => s.isCurrent).points[13]).toBeCloseTo(current.points[13] - 7000, 6);
  });

  it('starts every cycle at zero and never reads a 30-day cycle past its own end', () => {
    const data = fixture();
    const names = [BANK, OTHER];
    const processed = processTransactionData(data, names, 3, asOf);
    const bands = buildBalanceBands(data, names, [], processed, { cycles: 3 });
    expect(bands.anchored).toBe(false);
    expect(bands.length).toBe(31);
    bands.series.forEach((s) => {
      expect(s.change[0]).toBe(0);
      expect(s.change).toHaveLength(bands.changeLength);
    });
    const july = bands.series.find((s) => s.month === '2026-07');
    expect(iso(processed.cycleStarts['2026-07'])).toBe('2026-06-23');
    expect(july.points[29]).not.toBeNull();
    expect(july.points[30]).toBeNull(); // 23 Jul is the next cycle's payday, not July's day 31
    // Day 1's movement counts as movement: the boundary salary shows up on day 1.
    expect(july.change[1]).toBeCloseTo(50000 + 100, 6);
    // The current cycle stops at the data.
    const current = bands.series.find((s) => s.isCurrent);
    expect(current.points[18]).not.toBeNull();
    expect(current.points[19]).toBeNull();
  });

  it('honours the record type: an account overridden to Loan leaves the chart', () => {
    const data = fixture();
    const names = [BANK, OTHER];
    const processed = processTransactionData(data, names, 3, asOf);
    const asLoan = [record('fnb|4444', OTHER, 'Bank', { typeOverride: 'Loan', type: 'Loan' })];
    const bands = buildBalanceBands(data, names, asLoan, processed, { cycles: 3 });
    expect(bands.accountCount).toBe(1);
    const july = bands.series.find((s) => s.month === '2026-07');
    expect(july.change[1]).toBeCloseTo(50000, 6);
  });
});
