/**
 * Account names arrive as one opaque string — "Nedbank Credit Card *4714". Splitting out the bank,
 * the type and the mask lets the Accounts view group cards together and read direction correctly:
 * a credit card going more negative is debt increasing, while a loan going less negative is debt
 * being paid down. Both are just "higher is better" once you're looking at a position.
 */

const PATTERN = /^(.+?)\s+(Credit Card|Bank|Savings|Loan)\s+\*?(\w+)$/i;

export const ACCOUNT_TYPE_ORDER = ['Credit Card', 'Loan', 'Bank', 'Savings', 'Other'];

/** Debt shown as a negative position: spending on it makes the number worse, repaying improves it. */
const LIABILITY = new Set(['Credit Card', 'Loan']);

export function parseAccount(raw) {
  const name = (raw ?? '').trim();
  const m = name.match(PATTERN);
  if (!m) {
    return { raw: name, bank: '', type: 'Other', mask: '', short: name, isLiability: false };
  }
  const [, bank, typeRaw, mask] = m;
  const type = typeRaw.replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    raw: name,
    bank: bank.trim(),
    type,
    mask,
    short: `${type} *${mask}`,
    isLiability: LIABILITY.has(type),
  };
}

/**
 * Stable identity for an account across exports: bank + mask, never the full display string.
 *
 * The 21 August export renamed "FNB Savings *9547" to "FNB Bank *9547" — same account, same mask,
 * new type label. Keyed on the display string that reads as one account vanishing and another
 * appearing, splitting its history and detaching anything stored against it.
 */
export function accountIdOf(rawName) {
  const { bank, mask } = parseAccount(rawName);
  if (!bank || !mask) return `raw|${(rawName ?? '').trim().toLowerCase()}`;
  return `${bank.toLowerCase()}|${mask.toLowerCase()}`;
}

export function compareAccountTypes(a, b) {
  const ia = ACCOUNT_TYPE_ORDER.indexOf(a);
  const ib = ACCOUNT_TYPE_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}
