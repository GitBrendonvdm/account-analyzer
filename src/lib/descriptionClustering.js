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

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function descriptionSimilarity(a, b) {
  const na = normalizeDescription(a);
  const nb = normalizeDescription(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
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

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      if (descriptionSimilarity(unique[i], unique[j]) >= DESCRIPTION_SIMILARITY_THRESHOLD) {
        union(unique[i], unique[j]);
      }
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
