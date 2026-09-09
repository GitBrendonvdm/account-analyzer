import { describe, expect, it } from 'vitest';
import { findDuplicatePayments, referenceOf, DUPLICATE_MIN_HISTORY } from './duplicatePayments';
import { loadRealExport } from '../test/realData';
import { assignKeys } from '../db/txnKey';

const real = loadRealExport();

/** One instalment row. The description carries the month, as the real export's do. */
const row = (payMonth, Date, reference, over = {}) => ({
  key: `${Date}|${reference}|${payMonth}`,
  Date,
  'Pay Month': payMonth,
  Account: 'FNB Bank *9986',
  Description: `Fnb Home * Xx${Date.slice(8, 10)}${Date.slice(5, 7)} Fnb Home *${reference}`,
  Category: 'Home Loan / Bond',
  AmountNum: -6674.53,
  ...over,
});

/** Instalments under one reference, ending on the cycle the new reference turns up in. */
const history = (reference, count = 24) =>
  Array.from({ length: count }, (_, i) => {
    const monthsBack = count - 1 - i;
    const month = ((2026 * 12 + 7 - monthsBack) % 12) + 1;
    const year = Math.floor((2026 * 12 + 7 - monthsBack) / 12);
    const mm = String(month).padStart(2, '0');
    return row(`${year}-${mm}`, `${year}-${mm}-25`, reference);
  });

describe('referenceOf', () => {
  it('takes the account reference a description ends with', () => {
    expect(referenceOf('Fnb Home * Xx0825 Fnb Home *6996')).toBe('*6996');
    expect(referenceOf('Toyota_Fin *0827 Toyota_Fin *7408')).toBe('*7408');
  });

  it('has nothing to say about a description that carries no reference', () => {
    expect(referenceOf('Spar Brackenfell Western Cape Za')).toBeNull();
    expect(referenceOf('')).toBeNull();
    expect(referenceOf(null)).toBeNull();
  });
});

describe('findDuplicatePayments', () => {
  it('finds one payment written under an old reference and a new one', () => {
    const rows = [...history('6996'), row('2026-08', '2026-08-25', '1106')];
    const [found, ...rest] = findDuplicatePayments(rows);
    expect(rest).toEqual([]);
    expect(found.keepRef).toBe('*6996');
    expect(found.dropRef).toBe('*1106');
    expect(found.keepCycles).toBeGreaterThanOrEqual(DUPLICATE_MIN_HISTORY);
    // The copy struck is the one with no history behind it.
    expect(found.drop.Description).toContain('*1106');
  });

  it('leaves two standing commitments alone, however alike they look', () => {
    // Both budget facilities charge R444.41 on the same day, on the same card, for nineteen
    // cycles. Striking one would delete a real payment nineteen times over.
    const facility = (reference) =>
      history('x', 19).map((t) => ({
        ...t,
        key: `${t.key}|${reference}`,
        Description: `Budget Facility Instalm x *${reference} 0xx0499.00`,
        AmountNum: -444.41,
      }));
    expect(findDuplicatePayments([...facility('002'), ...facility('003')])).toEqual([]);
  });

  it('leaves two newcomers alone — neither succeeds the other', () => {
    const apple = (card) => ({
      key: `apple-${card}`,
      Date: '2024-07-23',
      'Pay Month': '2024-07',
      Account: 'FNB Bank *9986',
      Description: `79.99 Apple.Com/Bil 4**47 20 Jul *${card}`,
      AmountNum: -79.99,
    });
    expect(findDuplicatePayments([apple('1373'), apple('1399')])).toEqual([]);
  });

  it('says nothing when the same charge simply happened twice', () => {
    const twice = [
      { key: 'a', Date: '2026-08-25', 'Pay Month': '2026-08', Account: 'FNB Bank *9986', Description: 'Spar *1234', AmountNum: -120 },
      { key: 'b', Date: '2026-08-25', 'Pay Month': '2026-08', Account: 'FNB Bank *9986', Description: 'Spar *1234', AmountNum: -120 },
    ];
    expect(findDuplicatePayments(twice)).toEqual([]);
  });

  it('does not pair rows from different accounts, days or amounts', () => {
    const base = [...history('6996')];
    const elsewhere = row('2026-08', '2026-08-25', '1106', { Account: 'Nedbank Savings *1825' });
    const otherDay = row('2026-08', '2026-08-26', '1106');
    const otherAmount = row('2026-08', '2026-08-25', '1106', { AmountNum: -5000 });
    expect(findDuplicatePayments([...base, elsewhere])).toEqual([]);
    expect(findDuplicatePayments([...base, otherDay])).toEqual([]);
    expect(findDuplicatePayments([...base, otherAmount])).toEqual([]);
  });

  it('needs real history behind the surviving reference, not one earlier sighting', () => {
    const thin = [...history('6996', DUPLICATE_MIN_HISTORY - 1), row('2026-08', '2026-08-25', '1106')];
    expect(findDuplicatePayments(thin)).toEqual([]);
  });

  it('ignores a pair with no reference to tell the two rows apart', () => {
    const vague = [
      { key: 'a', Date: '2026-08-25', 'Pay Month': '2026-08', Account: 'FNB Bank *9986', Description: 'Home Loan Payment', AmountNum: -100 },
      { key: 'b', Date: '2026-08-25', 'Pay Month': '2026-08', Account: 'FNB Bank *9986', Description: 'Home Loan Debit', AmountNum: -100 },
    ];
    expect(findDuplicatePayments(vague)).toEqual([]);
  });

  it('survives an empty or absent file', () => {
    expect(findDuplicatePayments(null)).toEqual([]);
    expect(findDuplicatePayments([])).toEqual([]);
    expect(findDuplicatePayments([{}, { Description: 'x' }])).toEqual([]);
  });
});

describe.skipIf(!real)('findDuplicatePayments against the real export', () => {
  if (!real) return;
  const rows = assignKeys(real);

  /**
   * The file holds about forty same-day, same-amount, same-card pairs, and almost all of them are
   * two real payments — nineteen cycles of two budget facilities, two Apple charges on two cards.
   * Only a renumbering shows one reference with years behind it beside one in its first cycle.
   */
  it('finds the renumbered accounts and nothing else', () => {
    const found = findDuplicatePayments(rows);
    expect(found.length).toBeLessThanOrEqual(4);
    found.forEach((d) => {
      expect(d.keepCycles).toBeGreaterThanOrEqual(DUPLICATE_MIN_HISTORY);
      expect(d.keepRef).not.toBe(d.dropRef);
      expect(d.keep.Account).toBe(d.drop.Account);
      expect(d.keep.Date).toBe(d.drop.Date);
    });
    // The two the reader reported: a home loan and a vehicle loan, each renumbered.
    const merchants = found.map((d) => d.merchant);
    expect(merchants.some((m) => /fnb home/.test(m))).toBe(true);
  });

  it('never proposes striking a budget facility', () => {
    const struck = findDuplicatePayments(rows).map((d) => d.drop.Description.toLowerCase());
    expect(struck.some((d) => d.includes('budget facility'))).toBe(false);
  });
});
