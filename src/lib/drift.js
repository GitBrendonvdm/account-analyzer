import {
  DRIFT_BASELINE_CYCLES,
  DRIFT_MIN_BASELINE,
  DRIFT_MIN_BASELINE_CYCLES,
  DRIFT_MIN_DELTA,
  DRIFT_MIN_Z,
  DRIFT_RECENT_CYCLES,
  DRIFT_SD_FLOOR_RAND,
  DRIFT_SD_FLOOR_SHARE,
} from '../constants';
import { formatCurrencyAbs } from '../utils/format';
import { completeMonths, spendRows } from './flows';
import { merchantKeyOf, merchantLabel } from './merchants';
import { median, robustSd } from './stats';

/**
 * Category drift: which categories have moved out of their own usual range.
 *
 * The old "what's changing" list compared the mean of the second half of the window with the mean
 * of the first, which reports a category as rising whenever one big month lands in the second
 * half — on this data that was a R56k General Purchases month, not a habit. Here each category is
 * judged against ITSELF: the median of twelve baseline cycles is where it usually sits, the median
 * absolute deviation (scaled, so it reads as a standard deviation) is how much it usually wanders,
 * and the median of the last three cycles is where it sits now. A category is flagged only when
 * now is two and a half of those deviations away AND the move is worth at least R300 a cycle AND
 * the baseline was real money to begin with.
 *
 * The deviation has a floor. A fixed bill has a MAD of exactly 0, which would make a R1 change
 * infinitely significant; five percent of the median or R50, whichever is larger, keeps the
 * z-score meaning what it says. Everything is reported as "what changed", never as money found —
 * a category that rose may have risen for a reason the data cannot see.
 */

const R = (n) => formatCurrencyAbs(n);
const TOP_MERCHANTS = 2;

function totalsByCycle(rows, cycles) {
  const totals = new Map(cycles.map((c) => [c, 0]));
  rows.forEach((t) => {
    if (totals.has(t['Pay Month'])) totals.set(t['Pay Month'], totals.get(t['Pay Month']) + Math.abs(t.AmountNum));
  });
  return cycles.map((c) => totals.get(c));
}

function topMerchantsOf(rows, cycleCount) {
  const byKey = new Map();
  rows.forEach((t) => {
    const key = merchantKeyOf(t.Description);
    if (!key) return;
    byKey.set(key, (byKey.get(key) ?? 0) + Math.abs(t.AmountNum));
  });
  return [...byKey.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_MERCHANTS)
    .map(([key, total]) => ({ label: merchantLabel(key), recentPerCycle: total / Math.max(1, cycleCount) }));
}

/**
 * @param data  every row
 * @param opts  transfers: buildFullTransfers(data); calendar: buildCycleCalendar(...);
 *              accounts: AccountRecord[]; selectedAccounts: raw names to keep;
 *              recentCycles (3), baselineCycles (12)
 * @returns {{
 *   categories: [{ category, baselineMedian, baselineSd, recentMedian, delta, z, direction: 'up'|'down',
 *                  flagged, perYear, share, series: [{ month, total }], topMerchants: [{ label, recentPerCycle }], sentence }],
 *   flagged: [same],                 // |z| ≥ DRIFT_MIN_Z, |delta| ≥ DRIFT_MIN_DELTA, baseline ≥ DRIFT_MIN_BASELINE
 *   upPerCycle, downPerCycle,        // Σ delta of flagged up / Σ |delta| of flagged down (both positive)
 *   recent: string[], baseline: string[], assumptions: string[],
 * }}
 * Categories are sorted by |delta| descending; a category with no baseline spend is skipped (that
 * is a new charge, not drift), and the in-progress cycle is never part of `recent`.
 */
export function buildDrift(
  data,
  {
    transfers,
    calendar,
    accounts = null,
    selectedAccounts = null,
    recentCycles = DRIFT_RECENT_CYCLES,
    baselineCycles = DRIFT_BASELINE_CYCLES,
  } = {},
) {
  const cycles = completeMonths(calendar);
  const assumptions = [
    `Usual spread is the scaled median absolute deviation, floored at ${Math.round(DRIFT_SD_FLOOR_SHARE * 100)}% of the median or ${R(DRIFT_SD_FLOOR_RAND)}.`,
  ];
  const empty = { categories: [], flagged: [], upPerCycle: 0, downPerCycle: 0, recent: [], baseline: [], assumptions };

  const recent = cycles.slice(-recentCycles);
  const earlier = cycles.slice(0, Math.max(0, cycles.length - recentCycles));
  let baseline;
  if (earlier.length >= baselineCycles) baseline = earlier.slice(-baselineCycles);
  else if (earlier.length >= DRIFT_MIN_BASELINE_CYCLES) {
    baseline = earlier;
    assumptions.push(`Only ${earlier.length} baseline cycles are available; the usual range is read off all of them.`);
  } else return empty;
  if (recent.length < recentCycles) return empty;

  const rows = spendRows(data, { transfers, accounts, selectedAccounts, months: [...baseline, ...recent] });
  const recentSet = new Set(recent);
  const byCategory = new Map();
  let recentTotal = 0;
  rows.forEach((t) => {
    const category = t.Category || 'Uncategorised';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(t);
    if (recentSet.has(t['Pay Month'])) recentTotal += Math.abs(t.AmountNum);
  });

  const categories = [];
  byCategory.forEach((catRows, category) => {
    const baselineSeries = totalsByCycle(catRows, baseline);
    if (!baselineSeries.some((x) => x > 0)) return;
    const recentSeries = totalsByCycle(catRows, recent);
    const bm = median(baselineSeries);
    const sd = Math.max(robustSd(baselineSeries), DRIFT_SD_FLOOR_SHARE * bm, DRIFT_SD_FLOOR_RAND);
    const rm = median(recentSeries);
    const delta = rm - bm;
    const z = delta / sd;
    const flagged = Math.abs(z) >= DRIFT_MIN_Z && Math.abs(delta) >= DRIFT_MIN_DELTA && bm >= DRIFT_MIN_BASELINE;
    const recentRows = catRows.filter((t) => recentSet.has(t['Pay Month']));
    const recentSpend = recentRows.reduce((s, t) => s + Math.abs(t.AmountNum), 0);
    categories.push({
      category,
      baselineMedian: bm,
      baselineSd: sd,
      recentMedian: rm,
      delta,
      z,
      direction: delta >= 0 ? 'up' : 'down',
      flagged,
      perYear: delta * 12,
      share: recentTotal > 0 ? recentSpend / recentTotal : 0,
      series: [...baseline, ...recent].map((month, i) => ({
        month,
        total: i < baseline.length ? baselineSeries[i] : recentSeries[i - baseline.length],
      })),
      topMerchants: topMerchantsOf(recentRows, recent.length),
      sentence: flagged
        ? `${category}: ${R(rm)} a cycle, ${Math.abs(z) >= 4 ? 'far' : 'well'} outside the usual ${R(bm)} ± ${R(sd)}`
        : `${category}: ${R(rm)} a cycle against the usual ${R(bm)}.`,
    });
  });
  categories.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const flagged = categories.filter((c) => c.flagged);
  return {
    categories,
    flagged,
    upPerCycle: flagged.filter((c) => c.direction === 'up').reduce((s, c) => s + c.delta, 0),
    downPerCycle: flagged.filter((c) => c.direction === 'down').reduce((s, c) => s - c.delta, 0),
    recent,
    baseline,
    assumptions,
  };
}
