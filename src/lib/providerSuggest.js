import { merchantKeyOf, isPersonPayment } from './merchants';
import { providerOf } from './providers';

/**
 * Providers the data is confident enough to propose on its own.
 *
 * Grouping shops by hand is the honest way to do it, and also the slow way: this household banks
 * under a thousand distinct descriptions, and Engen alone appears as 27 of them. So this reads the
 * file and offers the ones it is sure about — and the bar for "sure" is deliberately high, because
 * the cost of being wrong is not symmetric. A provider this misses leaves a few extra rows the
 * reader can group in a moment; a provider it gets wrong silently merges two real merchants into
 * one row AND one forecast, which is very hard to notice afterwards. So every suggestion is
 * offered, never applied, and each one arrives with the names it would swallow.
 *
 * WHAT SEPARATES A SHOP FROM BANKING LANGUAGE is not the string — "Engen Bron" and "Budget
 * Facility" look alike — it is what the payments are for. A real merchant's charges concentrate in
 * one category: every Engen row is Transport & Fuel, every Spar row is Groceries. Bank language
 * does not: "int" spreads across Bank Charges at 50%, "the" across General Purchases at 31%. So
 * CATEGORY PURITY is the main test, and on the real export it separates the two lists cleanly.
 *
 * Four things purity alone lets through, each excluded for its own reason:
 *   - "budget facility", "monthly account fee", "interest" — 100% pure, because a bank fee is
 *     reliably filed as a bank fee. Excluded by category, and by a list of words that describe
 *     banking rather than any shop.
 *   - payment gateways. "Paygate" looked like a perfect provider: 6 payments, 100% Eating Out. But
 *     a gateway names how the money moved, not who received it, and the next restaurant to use the
 *     same card machine would be quietly merged into it.
 *   - payments to people, which are pure and personal. Excluded by isPersonPayment.
 *   - "superspar" beside "spar" — both real, but a "spar" synonym already catches SuperSpar and
 *     Kwikspar, so the broader token wins and the reader is not offered two providers that fight
 *     over the same rows.
 *
 * The cost of the high bar is real and worth stating: Google (81% pure across four categories) and
 * Uber (79%, Transport and Eating Out) are genuine providers this will not propose. They are one
 * manual grouping each, which is the right way round.
 */

/** Words that describe banking, not a shop. A pure category cannot rescue any of these. */
const NOT_A_MERCHANT = new Set([
  'int', 'intl', 'international', 'tran', 'trans', 'transfer', 'transfers', 'payment', 'payments',
  'pymt', 'debit', 'credit', 'debits', 'credits', 'electronic', 'monthly', 'annual', 'budget',
  'interest', 'fee', 'fees', 'service', 'admin', 'charge', 'charges', 'bank', 'atm', 'pos',
  'cash', 'salary', 'salaries', 'refund', 'reversal', 'reversed', 'nca', 'vat', 'send', 'advance',
  'immediate', 'realtime', 'instant', 'scheduled', 'recurring', 'the', 'and', 'for', 'from', 'ref',
  'purchase', 'withdrawal', 'deposit', 'balance', 'settlement', 'installment', 'instalment',
  'premium', 'insurance', 'cover', 'policy', 'loan', 'facility', 'card', 'account',
  // Payment gateways — see the note above. They name the card machine, not the shop.
  'paygate', 'payfast', 'yoco', 'zapper', 'snapscan', 'ikhokha', 'ozow', 'peach', 'netcash',
  'stripe', 'paypal', 'payu', 'sagepay', 'masterpass',
]);

/** Categories whose rows are the bank talking about itself, whatever the description says. */
const NOT_A_MERCHANT_CATEGORY = new Set([
  'Bank Charges',
  'Interest',
  'Home Loan / Bond',
  'Vehicle Loan / Car Loan',
  'Personal Loan',
  'Credit Card Repayment',
  'Other Insurance',
  'Donations (Out)',
]);

/**
 * One shop, several unrelated strings. Purity cannot find these — "Pnp Crp Glengarry" and "Pick N
 * Pay Asap Kenilworth" share no prefix at all — and no amount of string similarity will either.
 * It is knowledge about who owns what, so it is a short hand-checked list rather than a heuristic,
 * and it does only two things: it names the provider properly, and it lets one suggestion cover
 * every spelling. An alias absent from the file is dropped, so a suggestion never offers a synonym
 * that catches nothing.
 */
const BRANDS = [
  { name: 'Pick n Pay', synonyms: ['pnp', 'pick n pay', 'picknpay'] },
  { name: 'Woolworths', synonyms: ['woolworths', 'woolies'] },
  { name: "McDonald's", synonyms: ['mcd', 'mcdonald'] },
  { name: 'Builders', synonyms: ['bwh', 'builders'] },
  { name: 'City of Cape Town', synonyms: ['coct', 'city of cape town'] },
  { name: 'Dis-Chem', synonyms: ['dischem', 'dis-chem'] },
  { name: 'KFC', synonyms: ['kfc'] },
  { name: 'Shoprite', synonyms: ['shoprite'] },
  { name: 'Takealot', synonyms: ['takealot'] },
];
const BRAND_BY_TOKEN = new Map(BRANDS.flatMap((b) => b.synonyms.map((s) => [s.split(' ')[0], b])));

/** The bar for proposing. Each is a floor, and all of them have to clear. */
export const SUGGEST_MIN_NAMES = 2;
export const SUGGEST_MIN_PAYMENTS = 5;
export const SUGGEST_MIN_PURITY = 0.85;
const MIN_TOKEN = 3;

const text = (v) => (v ?? '').toString().toLowerCase();
const titleCase = (s) =>
  s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/**
 * @param rows      the rows the ledger treats as SPEND (flows.spendRows) — transfers and loan
 *                  internals are already gone, which removes most banking noise before it starts
 * @param existing  providers already defined, so nothing already grouped is offered again
 * @returns [{ name, synonyms, payments, names, purity, category, sample }] strongest first
 */
export function suggestProviders(rows, existing = []) {
  const byBrand = new Map();

  (rows ?? []).forEach((row) => {
    const description = row?.Description ?? '';
    if (!description || isPersonPayment(description)) return;
    if (providerOf(description, existing)) return;
    const key = merchantKeyOf(description);
    if (!key) return;
    const token = key.split(/\s+/)[0];
    if (!new RegExp(`^[a-z]{${MIN_TOKEN},}$`).test(token) || NOT_A_MERCHANT.has(token)) return;

    // Every spelling of one brand lands in the same bucket, so its count is the whole shop.
    const brand = BRAND_BY_TOKEN.get(token);
    const id = brand ? brand.name : token;
    if (!byBrand.has(id)) {
      byBrand.set(id, { token, brand, names: new Set(), payments: 0, categories: new Map(), sample: [] });
    }
    const entry = byBrand.get(id);
    entry.names.add(key);
    entry.payments += 1;
    const category = row.Category || 'Uncategorised';
    entry.categories.set(category, (entry.categories.get(category) ?? 0) + 1);
    if (entry.sample.length < 4 && !entry.sample.includes(description)) entry.sample.push(description);
  });

  // A brand's aliases are only worth offering if the file actually contains them.
  const seen = (rows ?? []).map((r) => text(r?.Description));
  const synonymsOf = (entry) =>
    entry.brand ? entry.brand.synonyms.filter((s) => seen.some((d) => d.includes(s))) : [entry.token];

  const candidates = [...byBrand.entries()]
    .map(([id, entry]) => {
      const [category, count] = [...entry.categories.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
      return {
        token: entry.token,
        name: entry.brand ? entry.brand.name : titleCase(id),
        synonyms: synonymsOf(entry),
        names: entry.names.size,
        payments: entry.payments,
        purity: entry.payments ? count / entry.payments : 0,
        category,
        sample: entry.sample,
      };
    })
    .filter(
      (c) =>
        c.synonyms.length > 0 &&
        c.names >= SUGGEST_MIN_NAMES &&
        c.payments >= SUGGEST_MIN_PAYMENTS &&
        c.purity >= SUGGEST_MIN_PURITY &&
        !NOT_A_MERCHANT_CATEGORY.has(c.category),
    )
    .sort((a, b) => b.payments - a.payments || b.names - a.names);

  // Drop anything a broader accepted suggestion already covers: a "spar" synonym catches
  // "superspar", and offering both would hand the reader two providers fighting over the same rows.
  const kept = [];
  candidates.forEach((c) => {
    const covered = kept.some((k) => k.synonyms.some((s) => c.synonyms.every((t) => t.includes(s))));
    if (!covered) kept.push(c);
  });
  return kept;
}
