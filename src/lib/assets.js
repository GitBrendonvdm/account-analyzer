/**
 * Things you own that no bank statement shows: a house, a car.
 *
 * Net worth is what you hold minus what you owe, and until now the "hold" side was only what sits in
 * accounts. A bond on a house with no house against it reads as a debt with nothing behind it. An
 * asset here is a name, a kind, the day you got it, and what it was worth on the days you looked — and
 * things go up and down, so what it is worth in between is worked out, not guessed.
 *
 *   valuations   [{ date, value }] — the first is the day it was received and what it was worth then;
 *                each later one is a day the reader checked. Between two of them the worth moves in a
 *                straight line, day by day, so a house that went from R600k to R630k over a year adds
 *                R2.5k to net worth each month rather than R30k in the month it was looked at. After
 *                the last it holds that figure until told otherwise. Before the first, it was not yet
 *                owned and is worth nothing.
 *
 *                A car bought at R400k that is R300k a year later, R100k the year after and R150k the
 *                year after that falls for two years and then rises, and net worth follows it month by
 *                month.
 *   loanIds      the loans that were taken out against it, so the page can say what is left of it once
 *                they are paid: its equity. Display only — the loans are already counted as debt.
 *
 * Stored in the settings as one list (`assets`), so it needs no schema of its own.
 */

export const ASSET_KINDS = [
  { id: 'house', label: 'House' },
  { id: 'car', label: 'Car' },
  { id: 'other', label: 'Something else' },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KIND_IDS = new Set(ASSET_KINDS.map((k) => k.id));
const DAY_MS = 86400000;
const dayNumber = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

/** The kind's label, and "Something else" for one this version does not know. */
export const kindLabel = (kind) => ASSET_KINDS.find((k) => k.id === kind)?.label ?? 'Something else';

/** Whatever was stored, as a clean list: no bad dates or values, valuations oldest first, no repeats. */
export function normaliseAssets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && a.name.trim())
    .map((a) => {
      const byDate = new Map();
      (Array.isArray(a.valuations) ? a.valuations : []).forEach((v) => {
        if (v && ISO.test(v.date) && Number.isFinite(v.value) && v.value >= 0) byDate.set(v.date, v.value);
      });
      const valuations = [...byDate.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([date, value]) => ({ date, value }));
      return {
        id: a.id,
        name: a.name.trim(),
        kind: KIND_IDS.has(a.kind) ? a.kind : 'other',
        valuations,
        loanIds: Array.isArray(a.loanIds) ? a.loanIds.filter((id) => typeof id === 'string') : [],
      };
    })
    .filter((a) => a.valuations.length);
}

/** A new asset: received on a day, worth something then. */
export function makeAsset(
  { name, kind, value, date, loanIds = [] },
  id = `asset-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
) {
  return { id, name: String(name).trim(), kind: KIND_IDS.has(kind) ? kind : 'other', valuations: [{ date, value }], loanIds };
}

/**
 * What it is worth on a day: nothing before it was received, a straight line between the two
 * valuations either side of the day, and the last valuation from then on.
 */
export function valueOn(asset, iso) {
  const list = asset?.valuations;
  if (!list?.length) return null;
  if (iso < list[0].date) return 0;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (iso >= a.date && iso < b.date) {
      const span = dayNumber(b.date) - dayNumber(a.date);
      return a.value + ((b.value - a.value) * (dayNumber(iso) - dayNumber(a.date))) / span;
    }
  }
  return list[list.length - 1].value;
}

/**
 * How far it has moved since it was received, up or down.
 *
 * @returns {{ change, since }|null} null when it has not moved by a rand
 */
export function movedSince(asset, iso) {
  const first = asset?.valuations?.[0];
  if (!first || iso < first.date) return null;
  const change = (valueOn(asset, iso) ?? first.value) - first.value;
  return Math.abs(change) >= 1 ? { change, since: first.date } : null;
}

/**
 * Net worth with the assets in it, month by month.
 *
 * @param summary  summariseNetWorth's result
 * @param assets   normaliseAssets' result
 * @param endOf    (month) => the YYYY-MM-DD the cycle ended, or today for the one still running
 * @returns the summary again with every month's net and assets raised by what the assets were worth
 *   that month, the change over the window with it, and `owned` (their names) so a page can say so
 */
export function withAssets(summary, assets, endOf) {
  if (!summary || !assets?.length || !summary.byMonth?.length) return summary;
  const held = (month) => assets.reduce((s, a) => s + (valueOn(a, endOf(month)) ?? 0), 0);
  const byMonth = summary.byMonth.map((p) => {
    const h = held(p.month);
    return { ...p, net: p.net + h, assets: p.assets + h };
  });
  const now = held(summary.byMonth[summary.byMonth.length - 1].month);
  const first = held(summary.byMonth[0].month);
  return {
    ...summary,
    assets: summary.assets + now,
    net: summary.net + now,
    change: summary.change + (now - first),
    byMonth,
    knownCount: summary.knownCount + assets.length,
    totalCount: summary.totalCount + assets.length,
    owned: assets.map((a) => a.name),
  };
}

/**
 * What is left of an asset once the loans against it are paid: its worth less what is owed on them.
 *
 * @param owedById Map<account id, amount owed, positive> — a loan not in it has no known balance
 * @returns {{ value, owed, equity, unknown: string[] }|null} null when no loan is linked
 */
export function equityOf(asset, iso, owedById) {
  if (!asset?.loanIds?.length) return null;
  const value = valueOn(asset, iso) ?? 0;
  const known = asset.loanIds.filter((id) => owedById?.has(id));
  const owed = known.reduce((s, id) => s + owedById.get(id), 0);
  return { value, owed, equity: value - owed, unknown: asset.loanIds.filter((id) => !owedById?.has(id)) };
}
