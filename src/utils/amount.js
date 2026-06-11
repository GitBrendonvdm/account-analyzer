export function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  const compact = String(raw).replace(/\s/g, '').replace(/,/g, '');
  const isNegative = /^-/.test(compact) || /^R-/i.test(compact) || /^\(.*\)$/.test(compact);
  const cleaned = compact.replace(/[R()]/gi, '').replace(/^-/, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return isNegative ? -Math.abs(n) : n;
}

export function normalizeTransactionAmount(description, amount) {
  if (/budget\s*facility\s*direct\s*payment/i.test(description || '')) {
    return -Math.abs(amount);
  }
  return amount;
}

export function amountCents(amount) {
  return Math.round(Math.abs(amount) * 100);
}
