import { useCallback, useEffect, useMemo, useState } from 'react';
import Dexie from 'dexie';
import { db } from '../db/db';
import * as api from '../api/client';
import { parseTransactionDate } from '../utils/date';

/**
 * Loans start switched off.
 *
 * A loan account records no spending of its own — only the instalment arriving and the interest,
 * fees and insurance the lender charges against it, all of which are already contained in the
 * instalment leaving your bank. The pipeline drops them from the flows for exactly that reason, so
 * leaving them switched on adds rows to the account list and noise to per-account views without
 * adding a figure anyone reads. They stay one click away for when the balance sheet is the subject.
 */
function defaultSelection(accounts) {
  const spending = accounts.filter((a) => a.type !== 'Loan');
  // Unless loans are all there is — an empty selection would show nothing at all.
  return (spending.length ? spending : accounts).map((a) => a.id);
}

/** Set once the browser's copy has been moved up, so the offer is never made twice. */
const MIGRATED_KEY = 'mv:migrated';

/**
 * What this browser still holds from before the server existed — read, never written.
 *
 * `Dexie.exists` is checked first because opening the database would create an empty one, and a
 * browser that never imported anything should leave no trace. The old store stays in place after
 * a move; it is the user's data and deleting it from here buys nothing.
 */
async function readLocalDump() {
  try {
    if (!(await Dexie.exists(db.name))) return null;
    await db.open();
    const transactions = await db.transactions.toArray();
    if (!transactions.length) return null;
    const [accounts, imports, budgets, goals, settings] = await Promise.all([
      db.accounts.toArray(),
      db.imports.toArray(),
      db.budgets.toArray(),
      db.goals.toArray(),
      db.settings.toArray(),
    ]);
    return { transactions, accounts, imports, budgets, goals, settings };
  } catch {
    return null;
  }
}

/**
 * Everything the app holds, now fetched from the server rather than read from IndexedDB.
 *
 * The shape handed to App is unchanged: rows sorted oldest first with `DateObj` set, accounts by
 * stable id, the selection and cycle range restored from settings. What changed is where it comes
 * from and what stands in front of it — a passphrase, so `auth` and `signIn` are here too, and
 * the one-time offer to move this browser's old copy up (`localDump`, `migrateLocal`).
 *
 * Accounts are selected by their stable id, not by display name, so switching an account on stays
 * switched on when the next export renames it. The pipeline still wants raw names, so the ids are
 * expanded back out at the boundary.
 */
export function useAnalyzerState() {
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState({
    configured: false,
    authenticated: false,
    checking: true,
    busy: false,
    error: null,
  });
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [monthRange, setMonthRangeState] = useState(6);
  const [imports, setImports] = useState([]);
  const [lastImport, setLastImport] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [localDump, setLocalDump] = useState(null);
  const [migrating, setMigrating] = useState(false);

  const refresh = useCallback(async () => {
    const payload = await api.bootstrap();
    const rows = payload.transactions;
    rows.forEach((t) => { t.DateObj = parseTransactionDate(t.Date); });
    setAccounts(payload.accounts);
    setData(rows.length ? rows : null);
    setImports(payload.imports);
    return { accountRows: payload.accounts, rows, settings: payload.settings ?? {} };
  }, []);

  /** A full load: the data, the remembered selection, and whether there is anything to migrate. */
  const loadEverything = useCallback(async () => {
    const { accountRows, rows, settings } = await refresh();
    const known = new Set(accountRows.map((a) => a.id));
    const restored = (settings.selectedAccountIds ?? []).filter((id) => known.has(id));
    // A stored selection of EVERY account is what the old default wrote, not a choice anyone
    // made — so it re-derives, and loans switch off. A selection that differs from "all" was
    // chosen deliberately and is left exactly as it is.
    const everythingSelected = restored.length === accountRows.length;
    setSelectedIds(
      restored.length && !everythingSelected ? restored : defaultSelection(accountRows),
    );
    if (settings.monthRange) setMonthRangeState(settings.monthRange);
    const offer = rows.length === 0 && !localStorage.getItem(MIGRATED_KEY);
    setLocalDump(offer ? await readLocalDump() : null);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.authStatus();
        if (cancelled) return;
        if (status.authenticated) await loadEverything();
        if (cancelled) return;
        setAuth((a) => ({ ...a, ...status, checking: false }));
      } catch (err) {
        if (cancelled) return;
        setAuth((a) => ({ ...a, checking: false, error: err.message }));
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [loadEverything]);

  // Any call answered with 401 — a session that expired overnight — drops back to the door.
  useEffect(() => {
    const onUnauthenticated = () =>
      setAuth((a) => (a.authenticated ? { ...a, authenticated: false } : a));
    window.addEventListener(api.UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(api.UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, []);

  /** First run sets the passphrase; every run after that types it. */
  const signIn = useCallback(
    async (passphrase) => {
      setAuth((a) => ({ ...a, busy: true, error: null }));
      try {
        if (auth.configured) await api.login(passphrase);
        else await api.setup(passphrase);
        await loadEverything();
        setAuth({ configured: true, authenticated: true, checking: false, busy: false, error: null });
      } catch (err) {
        // Another browser chose the passphrase first: this one should be asked for it, not for a new one.
        const raced = !auth.configured && err.status === 409;
        setAuth((a) => ({
          ...a,
          configured: a.configured || raced,
          busy: false,
          error: raced ? 'A passphrase is already set — type it to open.' : err.message,
        }));
      }
    },
    [auth.configured, loadEverything],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The session is gone either way; the screen still has to go back to the door.
    }
    api.forgetBootstrap();
    setData(null);
    setAccounts([]);
    setImports([]);
    setSelectedIds([]);
    setLastImport(null);
    setLocalDump(null);
    setAuth((a) => ({ ...a, authenticated: false, busy: false, error: null }));
  }, []);

  /** Move this browser's old IndexedDB copy to the server, once. */
  const migrateLocal = useCallback(async () => {
    if (!localDump) return null;
    setMigrating(true);
    try {
      const counts = await api.migrate(localDump);
      localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
      setLocalDump(null);
      await loadEverything();
      return counts;
    } finally {
      setMigrating(false);
    }
  }, [localDump, loadEverything]);

  const dismissLocalDump = useCallback(() => setLocalDump(null), []);

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
    api.putSetting('monthRange', value).catch(() => {});
  }, []);

  const toggleAccount = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id];
      api.putSetting('selectedAccountIds', next).catch(() => {});
      return next;
    });
  }, []);

  /** The file is read here and parsed on the server, with the same parser and the same rules. */
  const handleFileUpload = useCallback(
    (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImporting(true);
      setImportError(null);
      e.target.value = '';
      (async () => {
        try {
          const text = await file.text();
          const summary = await api.importFile(text, file.name);
          const { accountRows } = await refresh();
          // Newly-seen accounts start switched on — unless they're loans, which follow the same
          // rule as on a first run. Anything already chosen stays chosen either way.
          setSelectedIds((prev) => {
            const known = new Set(prev);
            const arriving = defaultSelection(accountRows).filter((id) => !known.has(id));
            const next = [...prev, ...arriving];
            api.putSetting('selectedAccountIds', next).catch(() => {});
            return next;
          });
          setLastImport(summary);
        } catch (err) {
          setImportError(err.message);
        } finally {
          setImporting(false);
        }
      })();
    },
    [refresh],
  );

  /** Opening balance, credit limit, label or type set by hand on one account. */
  const updateAccount = useCallback(async (id, patch) => {
    const record = await api.patchAccount(id, patch);
    setAccounts((prev) => prev.map((a) => (a.id === id ? record : a)));
  }, []);

  /** An account with no transactions behind it — a retirement annuity, a card the export never sees. */
  const createAccount = useCallback(
    async (record) => {
      const created = await api.createAccount(record);
      await refresh();
      return created;
    },
    [refresh],
  );

  const deleteAccount = useCallback(
    async (id) => {
      await api.deleteAccount(id);
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
    createAccount,
    deleteAccount,
    imports,
    lastImport,
    dismissLastImport: useCallback(() => setLastImport(null), []),
    importing,
    importError,
    dismissImportError: useCallback(() => setImportError(null), []),
    auth,
    signIn,
    signOut,
    localDump,
    migrateLocal,
    migrating,
    dismissLocalDump,
    exportUrl: api.exportUrl(),
  };
}
