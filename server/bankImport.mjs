import { accountIdOf } from '../src/lib/accounts.js';
import { planBankImport } from '../src/lib/bankImport.js';
import { bumpVersion, getAccount, listAccounts, listTransactions, putAccounts } from './db/data.mjs';
import { importRowsIn } from './importer.mjs';

/**
 * FNB transaction-history files, imported.
 *
 * src/lib/bankImport.js decides what the files mean; this is the plumbing that makes the decision
 * stick, and it all happens in ONE transaction: the rows, the accounts they introduce, and the
 * balances their headers state. A file set that fails halfway leaves no trace, so "upload them again"
 * is always a safe instruction — and because every line is recognised by key the second time, it is
 * also a cheap one.
 *
 * The plan is made against the data as it is inside the transaction, not against a copy read before
 * it. That matters less on one user's database than it would elsewhere, but it costs nothing and
 * removes a whole class of "it was true when I looked".
 */

function labelFor(files) {
  const used = [...new Set(files.filter((f) => f.status === 'ok').map((f) => f.from))];
  if (used.length === 0) return 'FNB transaction history';
  if (used.length === 1) return used[0];
  return `FNB transaction history · ${used.length} files`;
}

/**
 * @param store the connection from adapter.mjs
 * @param files [{ name, from?, text }] — the history files, already unzipped
 * @returns the import summary (also written to the import log), with the bank-specific detail under `bank`
 */
export async function importBankFiles(store, files) {
  return store.transaction(async (tx) => {
    const accounts = await listAccounts(tx);
    const held = await listTransactions(tx, accounts);
    const plan = planBankImport({ files, accounts, held, asOf: new Date() });

    const bank = {
      files: plan.files.map(({ chain, balance, ...f }) => ({
        ...f,
        chain: chain && { hasBalances: chain.hasBalances, checked: chain.checked, breaks: chain.breaks.length },
        balance: balance && { currentBalance: balance.currentBalance, balanceAsOf: balance.balanceAsOf },
      })),
      totals: plan.totals,
    };

    const summary = await importRowsIn(tx, plan.rows, labelFor(plan.files), {
      format: 'fnb-history',
      keyed: true,
      extra: { bank },
    });

    // Balances. An existing account is patched; a new one has just been created by its rows.
    let changed = 0;
    const apply = async (id, patch) => {
      const record = await getAccount(tx, id);
      if (!record) return;
      changed += await putAccounts(tx, [{ ...record, ...patch }]);
    };
    for (const { id, patch } of plan.patches) await apply(id, patch);
    for (const { rawName, patch } of plan.newAccounts) await apply(accountIdOf(rawName), patch);
    if (changed > 0) await bumpVersion(tx);

    return { ...summary, bank, balancesSet: changed };
  });
}
