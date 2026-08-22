import { useState } from 'react';
import { Landmark, Check } from 'lucide-react';
import { accountLabel } from '../db/accountIdentity';
import { compareAccountTypes } from '../lib/accounts';
import { formatCurrencyAbs } from '../utils/format';
import { Field } from './ui/Field';
import { ExternalAccounts } from './accounts/ExternalAccounts';

const DAY_MS = 86400000;
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toIso = (v) => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : isoOf(d);
};
const fmtIso = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
};
const parseAmount = (s) => {
  const v = parseFloat(String(s ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(v) ? Math.abs(v) : null;
};

/**
 * Where a balance came from, and when. A typed number says "typed 22 Aug"; a statement says which
 * bank's summary and its date; a balance older than the data by more than two months gets a
 * warning, because every past cycle is re-based from it and a stale anchor bends the whole line.
 */
function Provenance({ account, dataThrough }) {
  if (account.currentBalance == null) return <span className="text-xs text-warn">not set</span>;
  const asOf = toIso(account.balanceAsOf);
  const date = fmtIso(asOf);
  const text =
    account.source === 'statement'
      ? `as of ${date ?? '—'} · from your ${account.bank || 'bank'} summary`
      : account.source === 'manual'
        ? `typed${date ? ` ${date}` : ''}`
        : date
          ? `as of ${date}`
          : 'from the export';
  const through = toIso(dataThrough);
  const staleDays = asOf && through ? Math.round((new Date(through) - new Date(asOf)) / DAY_MS) : 0;
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-label-2">{text}</span>
      {staleDays > 60 && (
        <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10.5px] text-warn">{staleDays} days older than the data</span>
      )}
    </span>
  );
}

/**
 * One number per account, and the app stops apologising for not knowing balances.
 *
 * It asks what each account holds TODAY rather than an opening balance from two years ago, because
 * that's a number you can read off a banking app in one glance — and because it re-bases every
 * historical figure the moment you update it. Debt is entered as a positive amount owed, since
 * that's how people say it; the sign is applied here.
 *
 * The as-of date matters as much as the number: a balance read on the 22nd anchors the ledger on
 * the 22nd, and rows after it move the line from there. It defaults to the last day in the data
 * and can never be in the future. Every save sends only the keys that changed, and a balance save
 * always carries `source: 'manual'` and the as-of date, so the provenance chip tells the truth.
 */
function AccountRow({ account, onSave, dataThrough, todayIso }) {
  const owed = account.isLiability;
  const stored = account.currentBalance;
  const defaultAsOf = toIso(account.balanceAsOf) ?? toIso(dataThrough) ?? todayIso;
  const [value, setValue] = useState(stored == null ? '' : String(Math.abs(stored)));
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [limit, setLimit] = useState(account.creditLimit == null ? '' : String(account.creditLimit));
  const [overdraft, setOverdraft] = useState(account.overdraftLimit == null ? '' : String(account.overdraftLimit));
  const [label, setLabel] = useState(account.label ?? '');
  const [saved, setSaved] = useState(false);
  const isCard = account.type === 'Credit Card';
  const isBank = account.type === 'Bank';

  const commit = () => {
    const raw = parseAmount(value);
    const asOfClamped = asOf && asOf > todayIso ? todayIso : asOf || null;
    const before = {
      currentBalance: stored ?? null,
      balanceAsOf: toIso(account.balanceAsOf),
      creditLimit: account.creditLimit ?? null,
      overdraftLimit: account.overdraftLimit ?? null,
      label: account.label ?? null,
    };
    const after = {
      currentBalance: raw == null ? null : owed ? -raw : raw,
      balanceAsOf: asOfClamped,
      creditLimit: isCard ? parseAmount(limit) : before.creditLimit,
      overdraftLimit: isBank ? parseAmount(overdraft) : before.overdraftLimit,
      label: label.trim() || null,
    };
    const patch = {};
    for (const key of Object.keys(after)) {
      if (after[key] !== before[key]) patch[key] = after[key];
    }
    if ('currentBalance' in patch || 'balanceAsOf' in patch) {
      patch.source = 'manual';
      patch.balanceAsOf = asOfClamped ?? todayIso;
    }
    if (!Object.keys(patch).length) return;
    if (asOfClamped !== asOf) setAsOf(asOfClamped ?? '');
    onSave?.(account.id, patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-2.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder={accountLabel(account)}
          aria-label={`Name for ${accountLabel(account)}`}
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-hair focus:border-info/30 focus:bg-transparent focus:outline-none"
        />
        <div className="px-1.5 text-[11px] text-label-3">
          {account.rawName}
          {account.seenNames?.length > 1 && ' · renamed by the export'}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-label-2">{account.type}</td>
      <td className="px-4 py-2.5">
        <Field
          prefix={owed ? 'owe R' : 'R'}
          value={value}
          onChange={setValue}
          onCommit={commit}
          placeholder="—"
          ariaLabel={`Current balance for ${accountLabel(account)}`}
          width="w-28"
        />
      </td>
      <td className="px-4 py-2.5">
        <Field
          type="date"
          inputMode="none"
          value={asOf}
          onChange={setAsOf}
          onCommit={commit}
          max={todayIso}
          ariaLabel={`Balance as of for ${accountLabel(account)}`}
          width="w-36"
        />
      </td>
      <td className="px-4 py-2.5">
        {isCard ? (
          <Field
            prefix="R"
            value={limit}
            onChange={setLimit}
            onCommit={commit}
            placeholder="limit"
            ariaLabel={`Credit limit for ${accountLabel(account)}`}
          />
        ) : isBank ? (
          <Field
            prefix="R"
            value={overdraft}
            onChange={setOverdraft}
            onCommit={commit}
            placeholder="overdraft"
            ariaLabel={`Overdraft limit for ${accountLabel(account)}`}
          />
        ) : (
          <span className="text-xs text-label-4">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {saved ? (
          <span className="inline-flex items-center gap-1 text-xs text-good">
            <Check size={13} /> saved
          </span>
        ) : (
          <span className="flex flex-col items-end gap-1">
            {stored != null && (
              <span className="text-xs text-label-3 tabular-nums">
                {owed ? `−${formatCurrencyAbs(stored)}` : formatCurrencyAbs(stored)}
              </span>
            )}
            <Provenance account={account} dataThrough={dataThrough} />
          </span>
        )}
      </td>
    </tr>
  );
}

export function BalancesEditor({ accounts, onSave, onDeleteAccount, dataThrough, typeOverrideHint }) {
  const todayIso = isoOf(new Date());
  const list = (accounts ?? []).filter((a) => a && !a.external);
  const sorted = [...list].sort(
    (a, b) => compareAccountTypes(a.type, b.type) || (a.rawName ?? '').localeCompare(b.rawName ?? ''),
  );
  const missing = sorted.filter((a) => a.currentBalance == null).length;

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-6 py-5">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-label-3" />
          <h2 className="t-head">Balances</h2>
        </div>
        <p className="max-w-prose text-xs text-label-2">
          What each account holds, and the date you read it. Every past cycle is re-based from it, so re-entering
          these after an import keeps the whole history honest.
          {missing > 0 && (
            <span className="text-warn"> {missing} still to fill in.</span>
          )}
          <span className="block text-label-3">Upload your bank's account summary PDF to fill these in one go.</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase">
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Balance today</th>
              <th className="px-4 py-2.5">As of</th>
              <th className="px-4 py-2.5">Limit / overdraft</th>
              <th className="px-4 py-2.5 text-right">Stored</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <AccountRow key={a.id} account={a} onSave={onSave} dataThrough={dataThrough} todayIso={todayIso} />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="t-caption px-4 py-4">
                  No accounts yet — import an export or upload an account summary.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ExternalAccounts accounts={accounts} onDeleteAccount={onDeleteAccount} className="border-t px-6 py-5" />
      {typeOverrideHint && (
        <p className="border-t bg-warn/10 px-6 py-3 text-xs text-warn">{typeOverrideHint}</p>
      )}
    </div>
  );
}
