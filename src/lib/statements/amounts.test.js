import { describe, expect, it } from 'vitest';
import {
  digitRuns,
  findAmounts,
  headroom,
  isoDateFromDmy,
  last4,
  longestDigitRun,
  parseZar,
  todayIso,
} from './amounts';

describe('parseZar', () => {
  it('reads FNB figures exactly as printed', () => {
    expect(parseZar('R 8,956.43')).toBe(8956.43);
    expect(parseZar('R -9,341.97')).toBe(-9341.97);
    expect(parseZar('R 0.00')).toBe(0);
    expect(parseZar('-606,845.07')).toBe(-606845.07);
    expect(parseZar('eB 7,655.00')).toBe(7655);
  });

  it('accepts every thousands separator OCR produces, including none', () => {
    expect(parseZar('R1 761.12')).toBe(1761.12);
    expect(parseZar('R1 761.12')).toBe(1761.12);
    expect(parseZar('R1 761.12')).toBe(1761.12);
    expect(parseZar('R1 761.12')).toBe(1761.12);
    expect(parseZar('R1761.12')).toBe(1761.12);
    expect(parseZar('R2 747 082.69')).toBe(2747082.69);
    expect(parseZar('R2747082.69')).toBe(2747082.69);
  });

  it('reads a negative wherever the sign landed', () => {
    expect(parseZar('- R117 863.55')).toBe(-117863.55);
    expect(parseZar('-R117 863.55')).toBe(-117863.55);
    expect(parseZar('R-117 863.55')).toBe(-117863.55);
    expect(parseZar('R -117 863.55')).toBe(-117863.55);
  });

  it('tolerates the rand sign being misread or dropped', () => {
    expect(parseZar('Rr1 761.12')).toBe(1761.12);
    expect(parseZar('B1 761.12')).toBe(1761.12);
    expect(parseZar('1 761.12')).toBe(1761.12);
    // "R" read as "8": a four-digit leading group ahead of three-digit groups cannot be real.
    expect(parseZar('8117 863.55')).toBe(117863.55);
    expect(parseZar('- 8117 863.55')).toBe(-117863.55);
  });

  it('does not touch a bare run of digits, which is ambiguous', () => {
    expect(parseZar('8117863.55')).toBe(8117863.55);
  });

  it('is null for anything that is not money', () => {
    expect(parseZar('')).toBeNull();
    expect(parseZar('Total')).toBeNull();
    expect(parseZar('12.345')).toBeNull();
    expect(parseZar('22/08/2026')).toBeNull();
    expect(parseZar(null)).toBeNull();
    expect(parseZar(42)).toBeNull();
  });

  it('never returns negative zero', () => {
    expect(Object.is(parseZar('R -0.00'), 0)).toBe(true);
  });
});

describe('findAmounts', () => {
  it('finds every amount on a Nedbank row, in order, with positions', () => {
    const line = '4 Credit Card Plastic 370000000004714 AMEX - R117 863.55 R12 385.06';
    const found = findAmounts(line);
    expect(found.map((a) => a.value)).toEqual([-117863.55, 12385.06]);
    expect(line.slice(found[0].index, found[0].end)).toBe('- R117 863.55');
    expect(found[1].index).toBeGreaterThan(found[0].end);
  });

  it('reads a minus glued to the rand sign and amounts without separators', () => {
    expect(findAmounts('AMEX  -R117 863.55  R12 385.06').map((a) => a.value)).toEqual([-117863.55, 12385.06]);
    expect(findAmounts('R1761.12  R1761.12').map((a) => a.value)).toEqual([1761.12, 1761.12]);
  });

  it('never mistakes an account number for money', () => {
    expect(findAmounts('1 MiGoals 1000005284 Current R0.00 R0.00').map((a) => a.value)).toEqual([0, 0]);
    expect(findAmounts('6 BOND 8000000002801 2 747 082.69 0.00').map((a) => a.value)).toEqual([
      2747082.69, 0,
    ]);
  });

  it('ignores times and dates', () => {
    expect(findAmounts('Date: 22/08/2026 Time: 2:25 PM')).toEqual([]);
  });
});

describe('last4', () => {
  it('is the trailing digits of a number, masked or not', () => {
    expect(last4('55500019986')).toBe('9986');
    expect(last4('411111******2000')).toBe('2000');
    expect(last4('4000000000000117')).toBe('0117');
  });

  it('gives what there is when there are fewer than four', () => {
    expect(last4('123')).toBe('123');
    expect(last4('')).toBe('');
    expect(last4(null)).toBe('');
  });
});

describe('digit runs', () => {
  it('finds account numbers and not amounts', () => {
    const line = '2 Private Bundle 1000001825 Current R1 761.12 R1 761.12';
    expect(digitRuns(line).map((r) => r.digits)).toEqual(['1000001825']);
    expect(longestDigitRun(line)).toMatchObject({ digits: '1000001825', index: 17, end: 27 });
  });

  it('accepts a nine-digit number, as FNB gives an annuity', () => {
    expect(digitRuns('Retirement Annuity 555001412 R 17,227.87').map((r) => r.digits)).toEqual(['555001412']);
  });

  it('leaves an amount alone even when it has seven digits and no separators', () => {
    expect(digitRuns('R2747082.69 R0.00')).toEqual([]);
    expect(digitRuns('2747082.69')).toEqual([]);
  });

  it('prefers the longest run', () => {
    expect(longestDigitRun('1234567890 and 4000000000000117').digits).toBe('4000000000000117');
    expect(longestDigitRun('no numbers here')).toBeNull();
  });

  it('skips runs that are part of something longer', () => {
    expect(digitRuns('12345678901234567890')).toEqual([]);
  });
});

describe('headroom', () => {
  it('is available plus what is owed', () => {
    expect(headroom(-55066.92, 67761)).toBe(122827.92);
    expect(headroom(-9341.97, 8956.43)).toBe(18298.4);
    expect(headroom(0, 1722)).toBe(1722);
  });

  it('is null when there is no facility to speak of', () => {
    expect(headroom(38.04, 38.04)).toBeNull();
    expect(headroom(1000, 900)).toBeNull();
    expect(headroom(null, 100)).toBeNull();
  });
});

describe('dates', () => {
  it('turns day/month/year into ISO', () => {
    expect(isoDateFromDmy('22', '08', '2026')).toBe('2026-08-22');
    expect(isoDateFromDmy('1', '1', '2026')).toBe('2026-01-01');
    expect(isoDateFromDmy('32', '08', '2026')).toBeNull();
    expect(isoDateFromDmy('22', '13', '2026')).toBeNull();
  });

  it('gives today as a local date', () => {
    expect(todayIso(new Date(2026, 7, 22, 23, 30))).toBe('2026-08-22');
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
