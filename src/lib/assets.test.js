import { describe, expect, it } from 'vitest';
import { equityOf, makeAsset, normaliseAssets, valueOn, withAssets, withValuation } from './assets';

const house = (extra = {}) => ({
  id: 'asset-house',
  name: 'Our house',
  kind: 'house',
  valuations: [
    { date: '2026-03-01', value: 3_500_000 },
    { date: '2026-09-01', value: 3_600_000 },
  ],
  loanIds: ['nedbank|2801'],
  ...extra,
});

describe('valueOn', () => {
  it('is the latest valuation on or before the day', () => {
    expect(valueOn(house(), '2026-09-01')).toBe(3_600_000);
    expect(valueOn(house(), '2026-08-31')).toBe(3_500_000);
    expect(valueOn(house(), '2027-01-01')).toBe(3_600_000);
  });

  it('is the first valuation before it, so a new asset does not make the past leap', () => {
    expect(valueOn(house(), '2025-01-01')).toBe(3_500_000);
  });

  it('is null with nothing to go on', () => {
    expect(valueOn({ valuations: [] }, '2026-10-01')).toBeNull();
    expect(valueOn(null, '2026-10-01')).toBeNull();
  });
});

describe('withValuation', () => {
  it('adds a valuation in order, and replaces the one on the same day', () => {
    const a = withValuation(house(), { date: '2026-06-01', value: 3_550_000 });
    expect(a.valuations.map((v) => v.date)).toEqual(['2026-03-01', '2026-06-01', '2026-09-01']);
    const b = withValuation(a, { date: '2026-06-01', value: 3_560_000 });
    expect(b.valuations).toHaveLength(3);
    expect(valueOn(b, '2026-06-15')).toBe(3_560_000);
  });
});

describe('makeAsset', () => {
  it('values it once and keeps the loans it was bought with', () => {
    const a = makeAsset({ name: ' Toyota ', kind: 'car', value: 180_000, date: '2026-10-16', loanIds: ['fnb|4081'] }, 'asset-x');
    expect(a).toEqual({ id: 'asset-x', name: 'Toyota', kind: 'car', valuations: [{ date: '2026-10-16', value: 180_000 }], loanIds: ['fnb|4081'] });
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
      { month: '2026-08', net: -38_000, assets: 15_000, debt: 53_000 },
      { month: '2026-09', net: -33_000, assets: 18_000, debt: 51_000 },
      { month: '2026-10', net: -30_000, assets: 20_000, debt: 50_000 },
    ],
  };
  const endOf = (m) => ({ '2026-08': '2026-08-22', '2026-09': '2026-09-22', '2026-10': '2026-10-16' })[m];

  it('raises each month by what the assets were worth then, so a revaluation shows in its own month', () => {
    const out = withAssets(summary, [house({ valuations: [{ date: '2026-01-01', value: 1000 }, { date: '2026-09-10', value: 1500 }] })], endOf);
    expect(out.byMonth.map((p) => p.net)).toEqual([-37_000, -31_500, -28_500]);
    expect(out.byMonth.map((p) => p.assets)).toEqual([16_000, 19_500, 21_500]);
    expect(out.net).toBe(-28_500);
    expect(out.assets).toBe(21_500);
    expect(out.change).toBe(8_500);
    expect(out.knownCount).toBe(4);
    expect(out.owned).toEqual(['Our house']);
  });

  it('does not make net worth leap when an asset is added today', () => {
    const out = withAssets(summary, [makeAsset({ name: 'House', kind: 'house', value: 3_600_000, date: '2026-10-16' }, 'h')], endOf);
    expect(out.change).toBe(summary.change);
    expect(out.net).toBe(summary.net + 3_600_000);
  });

  it('is the summary untouched with no assets', () => {
    expect(withAssets(summary, [], endOf)).toBe(summary);
    expect(withAssets(null, [house()], endOf)).toBeNull();
  });
});

describe('equityOf', () => {
  const owed = new Map([['nedbank|2801', 2_747_083]]);

  it('is what is left of the asset once the loans against it are paid', () => {
    expect(equityOf(house(), '2026-10-16', owed)).toEqual({ value: 3_600_000, owed: 2_747_083, equity: 852_917, unknown: [] });
  });

  it('says which loans it could not value, and counts the rest', () => {
    const a = house({ loanIds: ['nedbank|2801', 'fnb|9999'] });
    expect(equityOf(a, '2026-10-16', owed).unknown).toEqual(['fnb|9999']);
    expect(equityOf(a, '2026-10-16', owed).equity).toBe(852_917);
  });

  it('is null when no loan is linked', () => {
    expect(equityOf(house({ loanIds: [] }), '2026-10-16', owed)).toBeNull();
  });
});
