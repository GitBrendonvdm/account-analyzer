import { merchantKeyOf } from './merchants';

/**
 * Categorising raw bank transactions, learned from your own history.
 *
 * This is the piece an aggregator was doing for you. A bank export gives a date, a description and
 * an amount — no category, no spending group — and without those the whole app is inert: no
 * grouping, no targets, no exceptions, no habits.
 *
 * Nothing here is a general-purpose model. It is a lookup built from transactions YOU have already
 * had categorised, which is the one training set that matters: it knows that "Nedbhl" is the bond
 * and "Bok Lounge" is eating out because that is how they were labelled in your data. Two years of
 * labelled rows is a lot of supervision for a few hundred merchants.
 *
 * Three passes, most specific first:
 *
 *   1. Exact description. Repeated bank strings ("Monthly Account Fee") are unambiguous.
 *   2. Merchant key. The normalised merchant from merchants.js, so a new Checkers with a different
 *      branch code and reference still lands on Groceries.
 *   3. Keyword. A small set of patterns for merchants never seen before, so a first-ever purchase
 *      at an unfamiliar filling station isn't simply Uncategorised.
 *
 * Every result carries its confidence and which pass produced it, because a category the app
 * guessed should be correctable and visibly different from one that came off the statement.
 */

/** Fallbacks for merchants with no history at all. Deliberately small — the data does the work. */
const KEYWORD_RULES = [
  // Money to your own loans and cards, in the bank's own words. These come first because they are
  // the lines a first-ever statement from the bank itself is full of, and the aggregator's wording
  // for them ("Fnb Home * Xx0725 Fnb Home *6996") is never the bank's ("FNB HOME 3000021106996").
  [/\b(fnb ?home|home ?loan|nedbhl|nedbank ?home)\b/i, 'Home Loan / Bond', 'Debt'],
  [/\b(toyota_? ?fin|wesbank|vw ?fin|bmw ?fin|car ?payoff|vehicle (loan|finance))\b/i, 'Vehicle Loan / Car Loan', 'Debt'],
  [/\b(fnb ?ploan|personal ?loan|settlement)\b/i, 'Personal Loan', 'Debt'],
  [/\b(fnb ?card|fnbcc|credit ?card (payment|repayment))\b/i, 'Credit Card Repayment', 'Debt'],
  [/fnb ?st ?ins(?![a-z])|short.?term ?ins|surelife/i, 'Other Insurance'],
  [/\b(rates (and|&) taxes|municipal)\b/i, 'Home Utility & Service'],
  [/\b(domestic ?worker|housekeep|maid|gardener)\b/i, 'Housekeeping'],
  [/\b(engen|shell|sasol|bp|total|caltex|astron)\b/i, 'Transport & Fuel'],
  [/\b(uber|bolt|taxify|gautrain)\b/i, 'Transport & Fuel'],
  [/\b(checkers|woolworths|pick ?n ?pay|pnp|spar|shoprite|makro|food ?lovers)\b/i, 'Groceries'],
  [/\b(mcd|kfc|nandos|steers|debonairs|romans|wimpy|burger|pizza|sushi|spur|mugg|vida|starbucks|kauai)\b/i, 'Eating Out & Takeaways'],
  [/\b(dischem|clicks|medirite|pharmacy|mediclinic|netcare|bestmed|discovery ?health)\b/i, 'Medical'],
  [/\b(netflix|spotify|showmax|dstv|youtube ?premium|playstation|xbox|steam|apple\.com|google ?play)\b/i, 'Entertainment'],
  [/\b(vodacom|mtn|telkom|cell ?c|rain|afrihost|webafrica|axxess)\b/i, 'Other Phone & Internet'],
  [/\b(outsurance|santam|momentum|sanlam|old ?mutual|discovery ?insure|king ?price|budget ?insurance)\b/i, 'Other Insurance'],
  [/\b(interest|finance charge|service fee|admin fee|bank charge|account fee|initiation fee)\b/i, 'Bank Charges'],
  [/\b(vet|petshop|petworld|crazy ?pets|pet ?wellness)\b/i, 'Pets'],
  [/\b(takealot|amazon|shein|temu|superbalist|zando)\b/i, 'General Purchases'],
  [/\b(salary|wages|payroll)\b/i, 'Salaries & Wages'],
  [/\b(tops|liquor|bottle ?store|makro ?liquor)\b/i, 'Alcohol'],
  [/\b(builders|mica|leroy|cashbuild|plumber|electrician)\b/i, 'Home & Garden'],
];

function normaliseDescription(description) {
  return (description ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The most frequent value in a list, with how dominant it was. */
function mode(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let best = null;
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return { value: best, count: bestCount, total: values.length, share: bestCount / values.length };
}

/**
 * Build the lookup from rows that already carry a category.
 *
 * A label is only learned when it is consistent: a merchant categorised three different ways across
 * five visits teaches nothing, and guessing from it would be worse than admitting ignorance.
 */
export function trainCategoriser(rows, { minShare = 0.6 } = {}) {
  const byDescription = new Map();
  const byMerchant = new Map();
  const groupsOfCategory = new Map();

  rows.forEach((t) => {
    const category = (t.Category ?? '').trim();
    if (!category) return;
    // A row left Uncategorised can still carry a telling group: "Pay From Nedbank" is
    // Uncategorised / Transfer in twenty-six rows, and "Transfer" is exactly what a new one is.
    // Plain day-to-day Uncategorised teaches nothing, so only a group that says something counts.
    if (/^uncategori[sz]ed$/i.test(category) && (!t['Spending Group'] || t['Spending Group'] === 'Day-to-day')) return;
    if (t['Spending Group']) {
      const g = groupsOfCategory.get(category) ?? [];
      g.push(t['Spending Group']);
      groupsOfCategory.set(category, g);
    }

    const description = normaliseDescription(t.Description);
    if (description) {
      if (!byDescription.has(description)) byDescription.set(description, []);
      byDescription.get(description).push({ category, group: t['Spending Group'] });
    }

    const merchant = merchantKeyOf(t.Description);
    if (merchant) {
      if (!byMerchant.has(merchant)) byMerchant.set(merchant, []);
      byMerchant.get(merchant).push({ category, group: t['Spending Group'] });
    }
  });

  const settle = (source) => {
    const out = new Map();
    source.forEach((entries, key) => {
      const category = mode(entries.map((e) => e.category));
      if (category.share < minShare) return;
      const group = mode(entries.filter((e) => e.category === category.value).map((e) => e.group));
      out.set(key, {
        category: category.value,
        group: group.value ?? null,
        share: category.share,
        observations: entries.length,
      });
    });
    return out;
  };

  return {
    descriptions: settle(byDescription),
    merchants: settle(byMerchant),
    // The group a category usually sits in, for a keyword hit that has no group of its own.
    groups: new Map([...groupsOfCategory].map(([category, groups]) => [category, mode(groups).value])),
    trainedOn: rows.length,
  };
}

/**
 * A key that is a whole-word prefix of a learned key, or the other way round. The aggregator wrote
 * "Toyota_Fin *0727 Toyota_Fin *1001", which keys to "toyota fin"; the bank writes
 * "TOYOTA_FIN86133574081001260927", whose reference is welded on and which keys to "toyota". Neither
 * equals the other and both mean the same lender. The first word must agree and the shorter key must
 * be at least six characters — "spar" is a prefix of every Spar in the country — and the most-seen
 * learned key wins.
 */
function prefixLookup(key, learned) {
  if (!key || !learned) return null;
  const first = key.split(' ')[0];
  let best = null;
  learned.forEach((entry, other) => {
    if (other.split(' ')[0] !== first) return;
    const [short, long] = key.length <= other.length ? [key, other] : [other, key];
    // Whole words ("toyota" → "toyota fin"), or a word the bank cut short ("checkershyper brack" →
    // "checkershyper brackenf"); either way the shorter is specific enough to be a name.
    if (short.length < 6 || !long.startsWith(short)) return;
    if (!best || entry.observations > best.observations) best = entry;
  });
  return best;
}

/**
 * Categorise one transaction.
 * @returns { category, group, confidence, source } — source is 'description' | 'merchant' |
 *   'keyword' | 'none', so the UI can mark a guess as a guess.
 */
export function categorise(row, model) {
  const description = normaliseDescription(row.Description);

  const exact = model?.descriptions?.get(description);
  if (exact) {
    return { category: exact.category, group: exact.group, confidence: exact.share, source: 'description' };
  }

  const merchant = merchantKeyOf(row.Description);
  const learned = merchant ? model?.merchants?.get(merchant) : null;
  if (learned) {
    return { category: learned.category, group: learned.group, confidence: learned.share, source: 'merchant' };
  }

  const near = prefixLookup(merchant, model?.merchants);
  if (near) {
    return { category: near.category, group: near.group, confidence: near.share * 0.8, source: 'merchant' };
  }

  for (const [pattern, category, group] of KEYWORD_RULES) {
    if (pattern.test(row.Description ?? '')) {
      return { category, group: group ?? model?.groups?.get(category) ?? null, confidence: 0.5, source: 'keyword' };
    }
  }

  return { category: 'Uncategorised', group: null, confidence: 0, source: 'none' };
}

/**
 * Fill in Category and Spending Group on rows that lack them, leaving labelled rows untouched.
 * A row the app categorised is marked so it can be shown — and corrected — as a guess.
 */
export function categoriseAll(rows, model) {
  return rows.map((row) => {
    const has = (row.Category ?? '').trim();
    if (has && !/^uncategori[sz]ed$/i.test(has)) return row;
    const guess = categorise(row, model);
    return {
      ...row,
      Category: guess.category,
      'Spending Group': row['Spending Group'] || guess.group || 'Day-to-day',
      categorySource: guess.source,
      categoryConfidence: guess.confidence,
    };
  });
}
