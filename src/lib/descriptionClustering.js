import { DESCRIPTION_SIMILARITY_THRESHOLD } from '../constants';

export function normalizeDescription(desc) {
  const normalized = desc
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(?=[a-z0-9]*\d)[a-z0-9]+\b/gi, '#')
    .replace(/\b(?=[a-z0-9]*\d)(?:[a-z0-9]{5,})\b/gi, '#')
    .replace(/\b\d{6,}\b/g, '#');

  // Some bank-generated payment descriptions are mostly recipient/reference noise.
  // "1Sa Brendon Vodszn6nf 4Cq" and "1Sa Ellene ... Vodspyt2x P2p" should cluster.
  if (/^1sa\b/i.test(desc.trim())) return '1sa';

  return normalized;
}

/**
 * Levenshtein distance, but only accurate up to `maxDist` — beyond that it returns `maxDist + 1`.
 *
 * Only the diagonal band of width 2*maxDist+1 can hold a distance <= maxDist, so everything outside
 * it is skipped, and a row whose best cell already exceeds maxDist ends the comparison early.
 */
function levenshteinWithin(a, b, maxDist) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (!la) return lb;
  if (!lb) return la;

  const OVER = maxDist + 1;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j <= maxDist ? j : OVER;

  for (let i = 1; i <= la; i += 1) {
    const lo = Math.max(1, i - maxDist);
    const hi = Math.min(lb, i + maxDist);
    curr[0] = i <= maxDist ? i : OVER;
    let best = OVER;
    for (let j = lo; j <= hi; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const left = j > lo ? curr[j - 1] : OVER;
      curr[j] = Math.min(left + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < best) best = curr[j];
    }
    for (let j = hi + 1; j <= lb; j += 1) curr[j] = OVER;
    if (best > maxDist) return OVER;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return Math.min(prev[lb], OVER);
}

export function buildDescriptionClusters(descriptions) {
  const unique = [...new Set(descriptions.filter(Boolean))];
  const parent = new Map(unique.map((d) => [d, d]));

  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let curr = x;
    while (parent.get(curr) !== curr) {
      const next = parent.get(curr);
      parent.set(curr, root);
      curr = next;
    }
    return root;
  };

  const union = (a, b) => parent.set(find(b), find(a));

  // Normalise once per unique description. This used to run inside the pair loop, on both operands,
  // so four regexes executed ~2x per comparison — roughly 890k times on a 944-description file, and
  // by far the dominant cost.
  const norm = new Map(unique.map((d) => [d, normalizeDescription(d)]));

  // Descriptions that normalise identically are similarity 1 by definition: union them without
  // measuring anything, and compare only one representative per normalised form afterwards.
  const byNorm = new Map();
  unique.forEach((d) => {
    const n = norm.get(d);
    const first = byNorm.get(n);
    if (first === undefined) byNorm.set(n, d);
    else union(first, d);
  });

  // Sort by length so the length-difference bound can stop a scan early: Levenshtein distance is at
  // least the length difference, so once |la - lb| exceeds the budget, every longer candidate is
  // out too.
  const reps = [...byNorm.values()].sort((a, b) => norm.get(a).length - norm.get(b).length);
  const slack = 1 - DESCRIPTION_SIMILARITY_THRESHOLD;

  for (let i = 0; i < reps.length; i += 1) {
    const a = norm.get(reps[i]);
    for (let j = i + 1; j < reps.length; j += 1) {
      const b = norm.get(reps[j]);
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) {
        union(reps[i], reps[j]);
        continue;
      }
      const budget = Math.floor(slack * maxLen);
      if (b.length - a.length > budget) break; // sorted by length — nothing further can qualify
      if (levenshteinWithin(a, b, budget) <= budget) union(reps[i], reps[j]);
    }
  }

  const clusterMembers = new Map();
  unique.forEach((d) => {
    const root = find(d);
    if (!clusterMembers.has(root)) clusterMembers.set(root, []);
    clusterMembers.get(root).push(d);
  });

  const descToCluster = new Map();
  const clusterInfo = new Map();
  clusterMembers.forEach((members) => {
    const canonical = [...members].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    const variants = [...members].sort((a, b) => a.localeCompare(b));
    clusterInfo.set(canonical, { canonical, variants });
    members.forEach((m) => descToCluster.set(m, canonical));
  });

  return { descToCluster, clusterInfo };
}

export function clusterKey(desc, descToCluster) {
  return descToCluster.get(desc) ?? desc;
}
