import { merchantKeyOf } from './merchants';

/**
 * One payment written twice, because the account it was paid to was renumbered.
 *
 * Upgrade a loan or an account and its number changes. For one cycle the bank writes the debit
 * order under both references, so a R6 675 home-loan instalment arrives as two rows on the same
 * day, from the same account, for the same amount — and is counted as R13 350. Each row is real
 * and each looks fine alone, which is why nothing else here catches it: transfer pairing wants
 * opposite signs and finds none, and the two descriptions differ, so the clusterer keeps them apart.
 *
 * RESEMBLANCE IS NOT EVIDENCE. On the real export, "Budget Facility Instalm x *002" and "…*003"
 * land on the same day, on the same card, for R444.41 each, every month for nineteen cycles. They
 * are two facilities and two real payments. Two Apple charges of R79.99 on the same day differ only
 * by the card that paid. A rule reading same-day-same-amount-similar-description would delete a
 * genuine payment about forty times over this file.
 *
 * WHAT SEPARATES A RENUMBERING IS SUCCESSION, not similarity: one reference has years behind it and
 * the other has never been seen before. Both budget facilities have nineteen cycles, so neither is
 * new and the pair is rejected; both Apple charges are new, so neither is a successor. The home
 * loan has *6996 across twenty-four cycles beside *1106 in its first, and the Toyota finance
 * account has *1001 across three beside *7408 in its first. Those two are the only pairs in 3 346
 * rows that clear it, and they are exactly the two the reader reported.
 *
 * History is counted per REFERENCE, not per description, because these descriptions carry the
 * month: "Fnb Home * Xx0825 Fnb Home *6996" is a different string every cycle, so counting whole
 * descriptions makes everything look new. The reference is the part that identifies the account.
 *
 * NOTHING IS DROPPED AUTOMATICALLY. A wrong guess deletes a real payment and the totals quietly
 * shrink, which is the hardest kind of error to notice — so this only ever proposes, and the reader
 * marks the copy a duplicate. The verdict is stored per transaction key, so it survives the import
 * that follows.
 */

/** Cycles a reference must have behind it to count as the established one. */
export const DUPLICATE_MIN_HISTORY = 3;

const text = (v) => (v ?? '').toString().toLowerCase().trim();
const cents = (t) => Math.round((t.AmountNum ?? 0) * 100);

/**
 * The account reference a description ends with — "*6996" in "Fnb Home * Xx0825 Fnb Home *6996".
 * Returns null when the description carries no such thing, which excludes the group: without a
 * reference there is nothing to tell the two rows apart except the noise that made them differ.
 */
export function referenceOf(description) {
  const matches = text(description).match(/\*\s?\d{3,}/g);
  return matches ? matches[matches.length - 1].replace(/\s/g, '') : null;
}

/**
 * Payments that look like one charge reported under an old reference and a new one.
 *
 * @param data every row, carrying `key`, `Pay Month`, `Account`, `Date`, `AmountNum`, `Description`
 * @returns [{ date, account, amount, merchant, keep, drop, keepRef, dropRef, keepCycles }]
 *          `drop` is the row whose reference has no history — the copy to strike.
 */
export function findDuplicatePayments(data) {
  const rows = (data ?? []).filter((t) => t?.Description && t?.Account && t?.Date);

  // How many cycles each (merchant, reference) has ever been seen in — the whole file, not a window,
  // because "has this account been paid before" is a question about all of history.
  const history = new Map();
  rows.forEach((t) => {
    const reference = referenceOf(t.Description);
    if (!reference) return;
    const id = `${merchantKeyOf(t.Description)}|${reference}`;
    if (!history.has(id)) history.set(id, new Set());
    history.get(id).add(t['Pay Month']);
  });
  const cyclesOf = (t) =>
    history.get(`${merchantKeyOf(t.Description)}|${referenceOf(t.Description)}`)?.size ?? 0;

  const groups = new Map();
  rows.forEach((t) => {
    const id = `${t.Account}|${t.Date}|${cents(t)}|${merchantKeyOf(t.Description)}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(t);
  });

  const found = [];
  groups.forEach((list) => {
    if (list.length < 2) return;
    // Identical descriptions are a charge that genuinely happened twice — nothing distinguishes
    // them, so there is nothing to reason about.
    if (new Set(list.map((t) => text(t.Description))).size < 2) return;
    if (list.some((t) => !referenceOf(t.Description))) return;

    const fresh = list.filter((t) => cyclesOf(t) === 1);
    const established = list.filter((t) => cyclesOf(t) >= DUPLICATE_MIN_HISTORY);
    // Exactly one newcomer beside at least one long-running reference. Two newcomers are two new
    // things; two veterans are two standing commitments.
    if (fresh.length !== 1 || established.length === 0) return;

    const drop = fresh[0];
    const keep = established.sort((a, b) => cyclesOf(b) - cyclesOf(a))[0];
    if (drop === keep) return;
    found.push({
      date: keep.Date,
      account: keep.Account,
      amount: keep.AmountNum,
      merchant: merchantKeyOf(keep.Description),
      keep,
      drop,
      keepRef: referenceOf(keep.Description),
      dropRef: referenceOf(drop.Description),
      keepCycles: cyclesOf(keep),
    });
  });
  return found.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
