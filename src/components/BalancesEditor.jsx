import { useState } from 'react';
import { Landmark, Check } from 'lucide-react';
import { accountLabel } from '../db/accountIdentity';
import { compareAccountTypes } from '../lib/accounts';
import { formatCurrencyAbs } from '../utils/format';

/**
 * One number per account, and the app stops apologising for not knowing balances.
 *
 * It asks what each account holds TODAY rather than an opening balance from two years ago, because
 * that's a number you can read off a banking app in one glance — and because it re-bases every
 * historical figure the moment you update it. Debt is entered as a positive amount owed, since
 * that's how people say it; the sign is applied here.
 */
function AccountRow({ account, onSave }) {
  const owed = account.isLiability;
  const stored = account.currentBalance;
  const [value, setValue] = useState(stored == null ? '' : String(Math.abs(stored)));
  const [limit, setLimit] = useState(account.creditLimit == null ? '' : String(account.creditLimit));
  const [label, setLabel] = useState(account.label ?? '');
  const [saved, setSaved] = useState(false);

  const commit = () => {
    const raw = parseFloat(value.replace(/[^\d.-]/g, ''));
    const patch = {
      currentBalance: Number.isFinite(raw) ? (owed ? -Math.abs(raw) : raw) : null,
      creditLimit: limit === '' ? null : Math.abs(parseFloat(limit.replace(/[^\d.-]/g, ''))) || null,
      label: label.trim() || null,
    };
    onSave(account.id, patch);
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
          placeholder={accountLabel(account)}
          aria-label={`Name for ${accountLabel(account)}`}
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-blue-400 focus:bg-white focus:outline-none"
        />
        <div className="px-1.5 text-[11px] text-slate-400">
          {account.rawName}
          {account.seenNames?.length > 1 && ' · renamed by the export'}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-slate-500">{account.type}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">{owed ? 'owe R' : 'R'}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            inputMode="decimal"
            placeholder="—"
            aria-label={`Current balance for ${accountLabel(account)}`}
            className="w-28 rounded border px-2 py-1 text-right text-sm tabular-nums focus:border-blue-400 focus:outline-none"
          />
        </div>
      </td>
      <td className="px-4 py-2.5">
        {account.type === 'Credit Card' ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">R</span>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              inputMode="decimal"
              placeholder="limit"
              aria-label={`Credit limit for ${accountLabel(account)}`}
              className="w-24 rounded border px-2 py-1 text-right text-sm tabular-nums focus:border-blue-400 focus:outline-none"
            />
          </div>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {saved ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <Check size={13} /> saved
          </span>
        ) : stored != null ? (
          <span className="text-xs text-slate-400 tabular-nums">
            {owed ? `−${formatCurrencyAbs(stored)}` : formatCurrencyAbs(stored)}
          </span>
        ) : (
          <span className="text-xs text-amber-600">not set</span>
        )}
      </td>
    </tr>
  );
}

export function BalancesEditor({ accounts, onSave, typeOverrideHint }) {
  const sorted = [...accounts].sort(
    (a, b) => compareAccountTypes(a.type, b.type) || a.rawName.localeCompare(b.rawName),
  );
  const missing = sorted.filter((a) => a.currentBalance == null).length;

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b bg-slate-50 px-6 py-4">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-800">Balances</h2>
        </div>
        <p className="max-w-prose text-xs text-slate-500">
          What each account holds <b>today</b>. Every past cycle is re-based from it, so re-entering
          these after an import keeps the whole history honest.
          {missing > 0 && (
            <span className="text-amber-700"> {missing} still to fill in.</span>
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Balance today</th>
              <th className="px-4 py-2.5">Card limit</th>
              <th className="px-4 py-2.5 text-right">Stored</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <AccountRow key={a.id} account={a} onSave={onSave} />
            ))}
          </tbody>
        </table>
      </div>
      {typeOverrideHint && (
        <p className="border-t bg-amber-50/60 px-6 py-3 text-xs text-amber-800">{typeOverrideHint}</p>
      )}
    </div>
  );
}
