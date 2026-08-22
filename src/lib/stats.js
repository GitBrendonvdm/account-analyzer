import { WINSOR_LOWER, WINSOR_MIN_OBSERVATIONS, WINSOR_UPPER } from '../constants';

/**
 * The handful of statistics every analytics module leans on, written once.
 *
 * Nearly all of them are the robust versions — median, median absolute deviation, Theil–Sen —
 * rather than mean, standard deviation and least squares, and that is a design decision rather
 * than taste. Twenty-six pay cycles is a short series, and it contains a R578k windfall, a doubled
 * instalment, a month where the pharmacy charged three times: one such point moves a mean by
 * thousands and a standard deviation by more, while the median and the MAD barely notice. The
 * exceptions are deliberate too — `mean` where the spec wants a pooled average, and `ols` for the
 * rate regression, where the fit is meant to be rejected outright (R² < 0.99) rather than made
 * tolerant of its outliers.
 *
 * Every function takes a plain array of numbers, never mutates it, and returns 0 (or a zero-ish
 * object) for an empty input so callers can sum and compare without guarding.
 */

const ascending = (xs) => [...xs].sort((a, b) => a - b);

/** Median of numbers; [] → 0. */
export function median(xs) {
  if (!xs || xs.length === 0) return 0;
  const sorted = ascending(xs);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Arithmetic mean; [] → 0. */
export function mean(xs) {
  if (!xs || xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Median absolute deviation, unscaled; [] → 0. */
export function mad(xs) {
  if (!xs || xs.length === 0) return 0;
  const mid = median(xs);
  return median(xs.map((x) => Math.abs(x - mid)));
}

/** 1.4826 × mad — the MAD scaled to estimate a normal standard deviation. */
export function robustSd(xs) {
  return 1.4826 * mad(xs);
}

/**
 * Linear-interpolated quantile: pos = (n − 1)·q, lo = floor(pos), hi = ceil(pos), then interpolate
 * between the sorted values at lo and hi. `q` is clamped to [0, 1]; [] → 0.
 */
export function quantile(xs, q) {
  if (!xs || xs.length === 0) return 0;
  const sorted = ascending(xs);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * mad / median over the MAGNITUDES of `xs` — the same contract as missedPayments.amountDispersion,
 * so a series of negative amounts reads the same as its positive mirror. Infinity when the median
 * magnitude is 0 (nothing to compare against), so an all-zero series can never look regular.
 */
export function dispersion(xs) {
  const magnitudes = (xs ?? []).map((x) => Math.abs(x));
  const mid = median(magnitudes);
  if (mid <= 0) return Infinity;
  return mad(magnitudes) / mid;
}

/** Most frequent value; ties → smallest. [] → null. */
export function mode(xs) {
  if (!xs || xs.length === 0) return null;
  const counts = new Map();
  xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  let best = null;
  let bestCount = -1;
  counts.forEach((count, value) => {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  });
  return best;
}

/**
 * Theil–Sen line through (i, y_i) for i = 0..n−1: slope = median of every pairwise
 * (y_j − y_i)/(j − i), intercept = median(y_i − slope·i). Robust to a third of the points being
 * wild, which is what a per-cycle series with one doubled month needs. n < 2 → {slope 0,
 * intercept y_0 ?? 0}.
 *
 * The slope uses the LOWER median (the smaller of the two middle values when the pair count is
 * even) rather than the interpolated one. With four points and one outlier, half of the six
 * pairwise slopes pass through the outlier, and interpolating between the clean and the
 * contaminated middle values would hand the outlier a vote; taking the lower middle value keeps
 * `theilSen([1, 2, 3, 40]).slope` at 1, which is the robustness the series modules rely on.
 */
export function theilSen(ys) {
  const n = ys?.length ?? 0;
  if (n < 2) return { slope: 0, intercept: ys?.[0] ?? 0 };
  const slopes = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) slopes.push((ys[j] - ys[i]) / (j - i));
  }
  const slope = ascending(slopes)[Math.floor((slopes.length - 1) / 2)];
  const intercept = median(ys.map((y, i) => y - slope * i));
  return { slope, intercept };
}

/**
 * Ordinary least squares of y on x. r2 = 1 − SSres/SStot, and 1 when both are 0 (a perfect fit to
 * a flat line). n < 2 → {slope 0, intercept 0, r2 0, n}. When every x is the same there is no
 * slope to fit: slope 0, intercept = mean(y), r2 as defined.
 */
export function ols(xs, ys) {
  const n = Math.min(xs?.length ?? 0, ys?.length ?? 0);
  if (n < 2) return { slope: 0, intercept: 0, r2: 0, n };
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const fit = intercept + slope * xs[i];
    ssRes += (ys[i] - fit) * (ys[i] - fit);
    ssTot += (ys[i] - my) * (ys[i] - my);
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;
  return { slope, intercept, r2, n };
}

/**
 * Clamp to [quantile(lower), quantile(upper)] when there are at least `minObs` values; below that
 * the percentiles are meaningless and the series comes back unchanged. Never mutates the input.
 */
export function winsorise(
  xs,
  { lower = WINSOR_LOWER, upper = WINSOR_UPPER, minObs = WINSOR_MIN_OBSERVATIONS } = {},
) {
  if (!xs || xs.length < minObs) return [...(xs ?? [])];
  const lo = quantile(xs, lower);
  const hi = quantile(xs, upper);
  return xs.map((x) => Math.min(hi, Math.max(lo, x)));
}
