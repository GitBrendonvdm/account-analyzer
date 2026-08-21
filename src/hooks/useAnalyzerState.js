import { useCallback, useEffect, useMemo, useState } from 'react';
import { STORAGE_KEY } from '../constants';
import { parseCsv } from '../utils/csv';
import {
  db,
  getSettings,
  listAccounts,
  listImports,
  loadAllTransactions,
  openDatabase,
  setSetting,
} from '../db/db';
import { importTransactions, migrateFromLocalStorage } from '../db/importTransactions';
import { parseTransactionDate } from '../utils/date';

/**
 * Everything the app holds, backed by IndexedDB rather than a JSON blob.
 *
 * Accounts are selected by their stable id, not by display name, so switching an account on stays
 * switched on when the next export renames it. The pipeline still wants raw names, so the ids are
 * expanded back out at the boundary.
 */
export function useAnalyzerState() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [monthRange, setMonthRangeState] = useState(6);
  const [imports, setImports] = useState([]);
  const [lastImport, setLastImport] = useState(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const accountRows = await listAccounts();
    const rows = await loadAllTransactions(accountRows);
    rows.forEach((t) => { t.DateObj = parseTransactionDate(t.Date); });
    setAccounts(accountRows);
    setData(rows.length ? rows : null);
    setImports(await listImports());
    return { accountRows, rows };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await openDatabase();
      const migrated = await migrateFromLocalStorage(STORAGE_KEY);
      const { accountRows } = await refresh();
      const saved = await getSettings(['selectedAccountIds', 'monthRange']);
      if (cancelled) return;
      const known = new Set(accountRows.map((a) => a.id));
      const restored = (saved.selectedAccountIds ?? []).filter((id) => known.has(id));
      setSelectedIds(restored.length ? restored : accountRows.map((a) => a.id));
      if (saved.monthRange) setMonthRangeState(saved.monthRange);
      if (migrated) setLastImport(migrated);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const availableMonthCount = useMemo(
    () => (data ? new Set(data.map((t) => t['Pay Month'])).size : 3),
    [data],
  );

  /** Raw account names for the current selection — every name an account has ever been called. */
  const selectedAccounts = useMemo(() => {
    const chosen = new Set(selectedIds);
    return accounts.filter((a) => chosen.has(a.id)).flatMap((a) => a.seenNames ?? [a.rawName]);
  }, [accounts, selectedIds]);

  const setMonthRange = useCallback((value) => {
    setMonthRangeState(value);
    setSetting('monthRange', value);
  }, []);

  const toggleAccount = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id];
      setSetting('selectedAccountIds', next);
      return next;
    });
  }, []);

  const handleFileUpload = useCallback(
    (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImporting(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const summary = await importTransactions(parseCsv(event.target.result), file.name);
          const { accountRows } = await refresh();
          // Newly-seen accounts start switched on; anything already chosen stays chosen.
          setSelectedIds((prev) => {
            const known = new Set(prev);
            const next = [...prev, ...accountRows.map((a) => a.id).filter((id) => !known.has(id))];
            setSetting('selectedAccountIds', next);
            return next;
          });
          setLastImport(summary);
        } finally {
          setImporting(false);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [refresh],
  );

  /** Opening balance, credit limit, label or type set by hand on one account. */
  const updateAccount = useCallback(
    async (id, patch) => {
      const existing = await db.accounts.get(id);
      if (!existing) return;
      const next = { ...existing, ...patch };
      // Type is user-authoritative once set, and it decides whether the account is a liability.
      if (patch.typeOverride !== undefined) {
        next.type = patch.typeOverride ?? existing.type;
        next.isLiability = next.type === 'Credit Card' || next.type === 'Loan';
      }
      await db.accounts.put(next);
      await refresh();
    },
    [refresh],
  );

  const fileName = imports[0]?.fileName ?? null;

  return {
    ready,
    data,
    accounts,
    selectedIds,
    selectedAccounts,
    monthRange,
    setMonthRange,
    fileName,
    availableMonthCount,
    toggleAccount,
    handleFileUpload,
    updateAccount,
    imports,
    lastImport,
    dismissLastImport: useCallback(() => setLastImport(null), []),
    importing,
  };
}
