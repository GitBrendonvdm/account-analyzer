import { normalizeTransactionAmount, parseAmount } from './amount';

export function parseCsv(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines
    .slice(1)
    .filter((l) => l.length > 5)
    .map((row, idx) => {
      const values = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const o = { id: idx };
      headers.forEach((h, i) => {
        o[h] = values[i]?.replace(/^"|"$/g, '').trim();
      });
      o.AmountNum = normalizeTransactionAmount(o.Description, parseAmount(o.Amount));
      return o;
    });
}
