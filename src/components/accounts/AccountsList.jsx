import { useState } from 'react';
import { Landmark, Archive, EyeOff, Pencil, TrendingDown, TrendingUp } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { ACCOUNT_TYPE_ORDER, compareAccountTypes } from '../../lib/accounts';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';
import { CloseAccountModal } from './CloseAccountModal';
import { EditAccountModal } from './EditAccountModal';
import { ExternalAccounts } from './ExternalAccounts';
import { ShelvedAccounts } from './ShelvedAccounts';
import { isoOf, provenanceOf } from './accountBits';

const GROUP_NAME = { 'Credit Card': 'Cards', Loan: 'Loans', Bank: 'Bank accounts', Savings: 'Savings', Other: 'Other' };

const ACTION =
  'press flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-label-2 hover:bg-fill hover:text-label max-md:min-h-11';

/** What the account holds, the way it is said: debt as "owe R …", money as a plain amount. */
function Balance({ account }) {
  if (account.currentBalance == null) return <span className="text-sm text-warn">Not set</span>;
  const amount = Math.abs(account.currentBalance);
  if (account.isLiability) return <span className="num text-sm font-semibold text-label">owe {formatCurrencyAbs(amount)}</span>;
  return (
    <span className="num text-sm font-semibold text-label">
      {account.currentBalance < 0 ? '−' : ''}
      {formatCurrencyAbs(amount)}
    </span>
  );
}

/** Why the app is pointing at an account, when it is: it looks finished, or it has gone quiet for good. */
const hintOf = (suggestion, quiet) =>
  suggestion
    ? `${suggestion.kind === 'paid-off' ? 'Looks paid off' : 'Looks closed'} — ${suggestion.reason}`
    : quiet
      ? 'No activity for over a year'
      : null;

function Row({ account, dataThrough, suggestion, quiet, onEdit, onClose }) {
  const label = accountLabel(account);
  const origin = provenanceOf(account, dataThrough);
  const hint = hintOf(suggestion, quiet);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 last:border-0 md:px-6">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-label">{label}</div>
        <div className="t-caption truncate">
          {account.rawName !== label && `${account.rawName} · `}
          {origin ? origin.text : 'no balance given yet'}
          {origin?.staleDays > 60 && <span className="text-warn"> · {origin.staleDays} days older than the data</span>}
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-warn">{hint}</div>}
      </div>
      <div className="flex items-center gap-1">
        <Balance account={account} />
        {suggestion && (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${label}`}
            className={`${ACTION} ml-2 bg-info/15 font-semibold text-info hover:bg-info/25 hover:text-info`}
          >
            <Archive size={13} />
            Close
          </button>
        )}
        <button type="button" onClick={onEdit} aria-label={`Edit ${label}`} className={`${ACTION} ${suggestion ? '' : 'ml-2'}`}>
          <Pencil size={13} />
          Edit
        </button>
      </div>
    </li>
  );
}

/**
 * Accounts as a list you read, not a form you fill in.
 *
 * Each account is one line: its name, what it holds and where that came from. Everything you can do
 * to it — retype its balance, rename it, close it, hide it — is one Edit away, in a dialog. The few
 * accounts the app thinks are finished say why on their line and have a Close button ready; the ones
 * quiet for good get one line above the list to hide them together; what is already closed or hidden
 * is behind "Manage" at the foot.
 *
 * `manage` is everything that needs the app's state — see App.jsx; without it the list is read-only.
 */
export function AccountsList({ accounts, onSave, onDeleteAccount, dataThrough, typeOverrideHint, manage, trend }) {
  const todayIso = isoOf(new Date());
  const [editing, setEditing] = useState(null);
  const [closing, setClosing] = useState(null);
  const [shelf, setShelf] = useState(false);
  const [hiding, setHiding] = useState(false);

  const list = (accounts ?? []).filter((a) => a && !a.external);
  const sorted = [...list].sort(
    (a, b) => compareAccountTypes(a.type, b.type) || (a.rawName ?? '').localeCompare(b.rawName ?? ''),
  );
  const groups = ACCOUNT_TYPE_ORDER.map((type) => ({ type, rows: sorted.filter((a) => (a.type ?? 'Other') === type) })).filter(
    (g) => g.rows.length,
  );
  const known = new Set(ACCOUNT_TYPE_ORDER);
  const strays = sorted.filter((a) => !known.has(a.type ?? 'Other'));
  if (strays.length) groups.push({ type: 'Other', rows: strays });
  const missing = sorted.filter((a) => a.currentBalance == null).length;

  const suggestionOf = new Map((manage?.suggestions ?? []).map((s) => [s.accountId, s]));
  const quietIds = new Set((manage?.dormant ?? []).map((a) => a.id));
  const quiet = sorted.filter((a) => quietIds.has(a.id));
  const editingAccount = editing ? sorted.find((a) => a.id === editing) : null;
  const closingAccount = closing ? sorted.find((a) => a.id === closing) : null;
  const closedCount = manage?.closed?.length ?? 0;
  const hiddenCount = manage?.hidden?.length ?? 0;
  const up = (trend?.sinceLast ?? 0) >= 0;
  const TrendIcon = up ? TrendingUp : TrendingDown;

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-4 md:px-6 md:py-5">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-label-3" />
          <h2 className="t-head">Your accounts</h2>
        </div>
        {trend && (
          <div className="text-right">
            <div className={`num text-lg font-semibold ${trend.now < 0 ? 'text-bad' : 'text-label'}`}>
              {formatCurrency(trend.now)} <span className="t-caption font-normal">net worth</span>
            </div>
            <div className={`flex items-center justify-end gap-1.5 text-xs ${up ? 'text-good' : 'text-bad'}`}>
              <TrendIcon size={13} />
              {up ? 'Up' : 'Down'} {formatCurrencyAbs(trend.sinceLast)} this cycle
            </div>
          </div>
        )}
        <p className="w-full text-xs text-label-2">
          What each account holds, and the day you read it. Every past cycle is re-based from it.
          {missing > 0 && <span className="text-warn"> {missing} still to fill in.</span>}
          <span className="block text-label-3">Upload your bank's account summary PDF to fill these in one go.</span>
        </p>
      </div>

      {quiet.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-fill/40 px-4 py-3 md:px-6">
          <span className="text-sm text-label-2">
            <b className="font-semibold text-label">{quiet.length}</b> account{quiet.length === 1 ? ' has' : 's have'} had no
            activity for over a year and {quiet.length === 1 ? 'holds' : 'hold'} nothing.
          </span>
          <button
            type="button"
            disabled={hiding}
            onClick={async () => {
              setHiding(true);
              try {
                await manage.onHide(quiet.map((a) => a.id));
              } finally {
                setHiding(false);
              }
            }}
            className="press flex items-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11 max-md:w-full max-md:justify-center"
          >
            <EyeOff size={15} />
            Hide {quiet.length === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

      {groups.length === 0 && (
        <p className="t-caption px-4 py-4 md:px-6">No accounts yet — import an export or upload an account summary.</p>
      )}
      {groups.map((g) => (
        <section key={g.type}>
          <h3 className="t-label border-b bg-fill/30 px-4 py-2 md:px-6">{GROUP_NAME[g.type] ?? g.type}</h3>
          <ul>
            {g.rows.map((a) => (
              <Row
                key={a.id}
                account={a}
                dataThrough={dataThrough}
                suggestion={suggestionOf.get(a.id)}
                quiet={quietIds.has(a.id)}
                onEdit={() => setEditing(a.id)}
                onClose={() => setClosing(a.id)}
              />
            ))}
          </ul>
        </section>
      ))}

      {manage && closedCount + hiddenCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-label-3 md:px-6">
          <span>{[closedCount > 0 && `${closedCount} closed`, hiddenCount > 0 && `${hiddenCount} hidden`].filter(Boolean).join(' · ')}</span>
          <button type="button" onClick={() => setShelf(true)} className="press text-info hover:brightness-110 max-md:min-h-11 max-md:px-3">
            Manage
          </button>
        </div>
      )}
      <ExternalAccounts accounts={accounts} onDeleteAccount={onDeleteAccount} className="border-t px-4 py-4 md:px-6 md:py-5" />
      {typeOverrideHint && <p className="border-t bg-warn/10 px-4 py-3 text-xs text-warn md:px-6">{typeOverrideHint}</p>}

      {editingAccount && (
        <EditAccountModal
          account={editingAccount}
          dataThrough={dataThrough}
          todayIso={todayIso}
          onSave={onSave}
          onClose={manage ? () => { setEditing(null); setClosing(editingAccount.id); } : undefined}
          onHide={manage ? () => { setEditing(null); manage.onHide([editingAccount.id]); } : undefined}
          onDone={() => setEditing(null)}
        />
      )}
      {manage && closingAccount && (
        <CloseAccountModal
          account={closingAccount}
          suggestion={suggestionOf.get(closingAccount.id)}
          today={manage.today}
          preview={manage.preview}
          onClose={manage.onClose}
          onDismiss={manage.onDismiss}
          onDone={() => setClosing(null)}
        />
      )}
      {manage && shelf && (
        <ShelvedAccounts
          closed={manage.closed}
          hidden={manage.hidden}
          onReopen={manage.onReopen}
          onShow={manage.onShow}
          onDone={() => setShelf(false)}
        />
      )}
    </div>
  );
}
