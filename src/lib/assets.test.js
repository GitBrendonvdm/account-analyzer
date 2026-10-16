import { describe, expect, it } from 'vitest';
import { equityOf, makeAsset, movedSince, normaliseAssets, valueOn, withAssets } from './assets';

const house = (extra = {}) => ({
  id: 'asset-house',
  name: 'Our house',
  kind: 'house',
  valuations: [
    { date: '2025-03-01', value: 600_000 },
    { date: '2026-03-01', value: 630_000 },
  ],
  loanIds: ['nedbank|2801'],
  ...extra,
});

describe('valueOn', () => {
  it('moves in a straight line, day by day, between two valuations', () => {
    expect(valueOn(house(), '2025-03-01')).toBe(600_000);
    expect(valueOn(house(), '2026-03-01')).toBe(630_000);
    expect(valueOn(house(), '2025-08-30')).toBeCloseTo(615_000, -2); // half way through the year
    expect(valueOn(house(), '2025-04-01')).toBeCloseTo(600_000 + (30_000 * 31) / 365, 0);
  });

  it('spreads a year’s gain across its months rather than into the month it was checked', () => {
    const monthly = ['2025-04-01', '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'].map((d) => valueOn(house(), d));
    const steps = monthly.slice(1).map((v, i) => v - monthly[i]);
    steps.forEach((s) => {
      expect(s).toBeGreaterThan(2_000);
      expect(s).toBeLessThan(3_100);
    });
  });

  it('follows a car down, further down, and then up', () => {
    const car = {
      id: 'c',
      name: 'Toyota',
      kind: 'car',
      loanIds: [],
      valuations: [
        { date: '2024-01-01', value: 400_000 },
        { date: '2025-01-01', value: 300_000 },
        { date: '2026-01-01', value: 100_000 },
        { date: '2027-01-01', value: 150_000 },
      ],
    };
    expect(valueOn(car, '2024-07-02')).toBeCloseTo(350_000, -3);
    expect(valueOn(car, '2025-07-02')).toBeCloseTo(200_000, -3);
    expect(valueOn(car, '2026-07-02')).toBeCloseTo(125_000, -3);
    expect(valueOn(car, '2025-01-01')).toBe(300_000);
    expect(valueOn(car, '2026-01-01')).toBe(100_000);
  });

  it('holds the last valuation from then on', () => {
    expect(valueOn(house(), '2030-01-01')).toBe(630_000);
  });

  it('is worth nothing before it was received', () => {
    expect(valueOn(house(), '2025-02-28')).toBe(0);
  });

  it('is null with nothing to go on', () => {
    expect(valueOn({ valuations: [] }, '2026-10-01')).toBeNull();
    expect(valueOn(null, '2026-10-01')).toBeNull();
  });
});

describe('movedSince', () => {
  it('says how far it has moved since it was received, up or down', () => {
    expect(movedSince(house(), '2026-03-01')).toEqual({ change: 30_000, since: '2025-03-01' });
    expect(movedSince(house(), '2025-08-30').change).toBeCloseTo(15_000, -2);
    const down = house({ valuations: [{ date: '2025-03-01', value: 400_000 }, { date: '2026-03-01', value: 300_000 }] });
    expect(movedSince(down, '2026-06-01')).toEqual({ change: -100_000, since: '2025-03-01' });
  });

  it('is null when it has not moved, or was not yet received', () => {
    expect(movedSince(house({ valuations: [{ date: '2025-03-01', value: 600_000 }] }), '2026-03-01')).toBeNull();
    expect(movedSince(house(), '2024-01-01')).toBeNull();
  });
});

describe('makeAsset', () => {
  it('is received on a day, worth something then, with the loans it was bought with', () => {
    const a = makeAsset({ name: ' Toyota ', kind: 'car', value: 400_000, date: '2024-01-01', loanIds: ['fnb|4081'] }, 'asset-x');
    expect(a).toEqual({ id: 'asset-x', name: 'Toyota', kind: 'car', valuations: [{ date: '2024-01-01', value: 400_000 }], loanIds: ['fnb|4081'] });
    expect(makeAsset({ name: 'Boat', kind: 'yacht', value: 1, date: '2026-10-16' }, 'b').kind).toBe('other');
  });
});

describe('normaliseAssets', () => {
  it('keeps what is sound and drops what is not', () => {
    const out = normaliseAssets([
      house({ valuations: [{ date: '2026-09-01', value: 2 }, { date: 'soon', value: 3 }, { date: '2026-03-01', value: 1 }, { date: '2026-04-01', value: -5 }] }),
      { id: 'x', name: '  ', valuations: [{ date: '2026-01-01', value: 1 }] },
      { id: 'y', name: 'Nothing worth anything', valuations: [] },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].valuations).toEqual([{ date: '2026-03-01', value: 1 }, { date: '2026-09-01', value: 2 }]);
    expect(normaliseAssets(undefined)).toEqual([]);
    expect(normaliseAssets([{ id: 'z', name: 'Thing', kind: 'spaceship', valuations: [{ date: '2026-01-01', value: 1 }] }])[0].kind).toBe('other');
  });
});

describe('withAssets', () => {
  const summary = {
    assets: 20_000,
    debt: 50_000,
    net: -30_000,
    change: 8_000,
    knownCount: 3,
    totalCount: 3,
    byMonth: [
      { month: '2025-04', net: -38_000, assets: 15_000, debt: 53_000 },
      { month: '2025-10', net: -33_000, assets: 18_000, debt: 51_000 },
      { month: '2026-03', net: -30_000, assets: 20_000, debt: 50_000 },
    ],
  };
  const endOf = (m) => ({ '2025-04': '2025-04-22', '2025-10': '2025-10-22', '2026-03': '2026-03-22' })[m];

  it('raises each month by what the assets were worth then, so a year’s gain arrives a little each month', () => {
    const out = withAssets(summary, [house()], endOf);
    expect(out.byMonth[0].net).toBeCloseTo(-38_000 + valueOn(house(), '2025-04-22'), 0);
    expect(out.byMonth[1].net).toBeCloseTo(-33_000 + valueOn(house(), '2025-10-22'), 0);
    expect(out.byMonth[2].net).toBe(-30_000 + 630_000);
    expect(out.byMonth[2].net - out.byMonth[1].net).toBeLessThan(20_000);
    expect(out.net).toBe(600_000);
    expect(out.knownCount).toBe(4);
    expect(out.owned).toEqual(['Our house']);
  });

  it('counts an asset from the day it was received, not before', () => {
    const late = house({ valuations: [{ date: '2025-09-01', value: 600_000 }] });
    const out = withAssets(summary, [late], endOf);
    expect(out.byMonth[0].net).toBe(-38_000);
    expect(out.byMonth[1].net).toBe(-33_000 + 600_000);
  });

  it('is the summary untouched with no assets', () => {
    expect(withAssets(summary, [], endOf)).toBe(summary);
    expect(withAssets(null, [house()], endOf)).toBeNull();
  });
});

describe('equityOf', () => {
  const owed = new Map([['nedbank|2801', 500_000]]);

  it('is what is left of the asset once the loans against it are paid', () => {
    expect(equityOf(house(), '2026-10-16', owed)).toEqual({ value: 630_000, owed: 500_000, equity: 130_000, unknown: [] });
  });

  it('says which loans it could not value, and counts the rest', () => {
    const a = house({ loanIds: ['nedbank|2801', 'fnb|9999'] });
    expect(equityOf(a, '2026-10-16', owed).unknown).toEqual(['fnb|9999']);
    expect(equityOf(a, '2026-10-16', owed).equity).toBe(130_000);
  });

  it('is null when no loan is linked', () => {
    expect(equityOf(house({ loanIds: [] }), '2026-10-16', owed)).toBeNull();
  });
});
