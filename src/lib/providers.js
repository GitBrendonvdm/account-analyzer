/**
 * Providers: the handful of shops you actually use, behind the hundreds of names they bank under.
 *
 * The export writes a branch, not a merchant. One household's groceries arrive as "Pick N Pay Asap
 * Kenilworth Za", "Pnp Crp Glengarry Cape Town Za", "Pnp Hpr Brackenfell Brackenfell Za",
 * "Kwikspar Vierlanden Mi Western Cape Za", "Spar Vredekloof Western Cape Za" and "Spar Brackenfell
 * Western Cape Za" — six rows, two shops. The description clusterer folds truncation variants of
 * ONE string together, which is a different job: it cannot know that "Pnp Hpr" and "Pick N Pay" are
 * the same company, because as strings they are not similar at all.
 *
 * The cost is not only clutter. Every forecast in this app is built per row from that row's own
 * history, so splitting one shop across six rows splits its history six ways: each fragment has too
 * few cycles to earn a range, and the one number it does show rests on a couple of observations. A
 * provider puts the history back together, and "we expect R4 200 at Pick n Pay" becomes a sentence
 * the data can actually support.
 *
 * A provider is a name and a list of synonyms — plain case-insensitive substrings, because that is
 * what a person means by "the PnP ones" and it is inspectable in a way a regex is not. Order
 * matters only in that the first match wins, so a narrower synonym should be listed above a broader
 * one. Nothing is inferred automatically: a wrong guess here silently merges two real merchants and
 * would be very hard to notice afterwards, so every provider is one the reader made.
 */

const text = (v) => (v ?? '').toString().toLowerCase();

/** A provider needs a name and at least one synonym; anything less would match everything or nothing. */
export function providerIsUsable(provider) {
  return Boolean(
    provider?.name?.trim() && (provider.synonyms ?? []).some((s) => text(s).trim().length >= 2),
  );
}

/** The provider a description belongs to, or null. First match wins. */
export function providerOf(description, providers) {
  const d = text(description);
  if (!d) return null;
  const match = (providers ?? [])
    .filter(providerIsUsable)
    .find((p) => (p.synonyms ?? []).some((s) => text(s).trim().length >= 2 && d.includes(text(s).trim())));
  return match ? match.name.trim() : null;
}

/** Every payment a provider currently covers — shown before the reader commits to it. */
export function paymentsOf(data, provider) {
  if (!providerIsUsable(provider)) return [];
  return (data ?? []).filter((t) => providerOf(t.Description, [provider]));
}

/**
 * Turn a set of descriptions into a synonym list, by finding what they share.
 *
 * Selecting "Pnp Crp Glengarry Cape Town Za" and "Pnp Hpr Brackenfell Brackenfell Za" should not
 * produce two synonyms that each match one row — it should notice they both start "pnp" and offer
 * that. So the leading words common to all of them become one synonym where such a prefix exists,
 * and anything left over keeps a synonym of its own. The reader can edit the result; this only has
 * to save them the typing, and it must never widen beyond what was selected — a one-word prefix
 * like "the" would match half the file, so a prefix under MIN_PREFIX characters is not offered.
 */
const MIN_PREFIX = 3;

export function suggestSynonyms(descriptions) {
  const cleaned = [...new Set((descriptions ?? []).map((d) => text(d).trim()).filter(Boolean))];
  if (!cleaned.length) return [];
  const words = cleaned.map((d) => d.split(/\s+/));
  const shared = [];
  for (let i = 0; i < Math.min(...words.map((w) => w.length)); i += 1) {
    const word = words[0][i];
    if (!words.every((w) => w[i] === word)) break;
    shared.push(word);
  }
  const prefix = shared.join(' ');
  if (prefix.length >= MIN_PREFIX) return [prefix];
  // No common opening, so each description stands for itself — trimmed to its first two words,
  // which is where a branch name usually starts and the chain name usually ends.
  return cleaned.map((d) => d.split(/\s+/).slice(0, 2).join(' ')).filter((s) => s.length >= MIN_PREFIX);
}

/**
 * A name for a provider, guessed from what was selected — the shared opening, title-cased. Only a
 * starting point for the text box; the reader names their own shops.
 */
export function suggestName(descriptions) {
  const [first] = suggestSynonyms(descriptions);
  if (!first) return '';
  return first
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * How many rows a set of providers would remove from the ledger: the descriptions they cover,
 * minus one row for each provider that covers any. The headline the feature is for.
 */
export function rowsSaved(data, providers) {
  const usable = (providers ?? []).filter(providerIsUsable);
  if (!usable.length) return 0;
  const covered = new Map();
  (data ?? []).forEach((t) => {
    const name = providerOf(t.Description, usable);
    if (!name) return;
    if (!covered.has(name)) covered.set(name, new Set());
    covered.get(name).add(text(t.Description));
  });
  let saved = 0;
  covered.forEach((descriptions) => {
    saved += Math.max(0, descriptions.size - 1);
  });
  return saved;
}
