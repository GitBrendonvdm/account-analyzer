/**
 * Fold a transfer pair's matches into one row per description pairing.
 *
 * Plain data work, kept out of the component file so Fast Refresh can hot-swap the component.
 */
export function groupMatches(matches, months) {
  const groups = new Map();
  matches.forEach((match) => {
    if (!months.includes(match.month)) return;
    const key = `${match.credit.Description}⇄${match.debit.Description}`;
    if (!groups.has(key)) {
      groups.set(key, {
        creditLabel: match.credit.Description,
        debitLabel: match.debit.Description,
        isReversal: Boolean(match.isReversal),
        amountsByMonth: Object.fromEntries(months.map((m) => [m, null])),
      });
    }
    groups.get(key).amountsByMonth[match.month] = match.amount;
  });
  return [...groups.values()];
}
