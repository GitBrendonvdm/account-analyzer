import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * Accounts the export has never seen — a retirement annuity, an emergency fund at another bank —
 * that a statement upload created so net worth could include them.
 *
 * They are listed apart from the transaction-backed accounts because they behave differently: no
 * rows anchor them, so their balance is exactly what the statement said and nothing moves until
 * the next upload. That is also why they can be deleted here and the others cannot — deleting an
 * account with rows behind it would orphan history, while an external record is only the number
 * it holds. The delete confirms inline rather than in a dialog: two clicks, both visible, no modal.
 */

const toIso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
};

function Row({ account, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const owed = account.isLiability;
  const balance = account.currentBalance;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-3 first:border-t-0">
      <div className="min-w-0 flex-grow">
        <div className="truncate text-sm font-medium text-label">{accountLabel(account)}</div>
        <div className="t-caption truncate">
          {account.type}
          {account.bank ? ` · ${account.bank}` : ''}
          {account.statementName ? ` · from statement "${account.statementName}"` : ' · from a statement'}
          {account.balanceAsOf ? ` · as of ${toIso(account.balanceAsOf)}` : ''}
        </div>
      </div>
      <span className={`num text-sm font-semibold ${owed ? 'text-bad' : 'text-label'}`}>
        {balance == null ? '—' : `${owed || balance < 0 ? '−' : ''}${formatCurrencyAbs(balance)}`}
      </span>
      {onDelete &&
        (confirming ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-label-2">Delete {accountLabel(account)}?</span>
            <button
              type="button"
              onClick={() => onDelete(account.id)}
              className="press rounded-full bg-bad/15 px-3 py-1 font-medium text-bad hover:bg-bad/25"
            >
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="press rounded-full px-3 py-1 text-label-2 hover:bg-fill">
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${accountLabel(account)}`}
            className="press flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-label-3 hover:bg-fill hover:text-bad"
          >
            <Trash2 size={13} /> Delete
          </button>
        ))}
    </li>
  );
}

export function ExternalAccounts({ accounts, onDeleteAccount, className = '' }) {
  const external = (accounts ?? []).filter((a) => a?.external);
  if (!external.length) return null;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="t-sub">Not in your transaction export</h3>
        <p className="t-caption">Added from an account summary. Their balance changes only when you upload the next one.</p>
      </div>
      <ul className="mt-2 flex flex-col">
        {external.map((a) => (
          <Row key={a.id} account={a} onDelete={onDeleteAccount} />
        ))}
      </ul>
    </div>
  );
}
