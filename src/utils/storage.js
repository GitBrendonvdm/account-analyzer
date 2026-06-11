import { STORAGE_KEY } from '../constants';
import { normalizeTransactionAmount, parseAmount } from './amount';

export function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.data) || saved.data.length === 0) return null;
    const accounts = [...new Set(saved.data.map((t) => t.Account))];
    const selectedAccounts = Array.isArray(saved.selectedAccounts)
      ? saved.selectedAccounts.filter((a) => accounts.includes(a))
      : accounts;
    const data = saved.data.map((row, idx) => ({
      ...row,
      id: row.id ?? idx,
      AmountNum: normalizeTransactionAmount(
        row.Description,
        row.Amount != null && row.Amount !== '' ? parseAmount(row.Amount) : row.AmountNum ?? 0,
      ),
    }));
    const monthCount = new Set(data.map((t) => t['Pay Month'])).size;

    return {
      data,
      selectedAccounts: selectedAccounts.length > 0 ? selectedAccounts : accounts,
      monthRange: Math.min(monthCount, Math.max(3, saved.monthRange ?? 6)),
      fileName: saved.fileName ?? null,
    };
  } catch {
    return null;
  }
}

export function saveState({ data, selectedAccounts, monthRange, fileName }) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ data, selectedAccounts, monthRange, fileName }),
    );
  } catch {
    // localStorage full or unavailable — ignore
  }
}
