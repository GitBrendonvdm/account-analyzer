import { useState, useSyncExternalStore } from 'react';
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
 * Is the window narrower than Tailwind's `md` (768px)?
 *
 * The editor is a six-column table on a desktop and a stacked form on a phone, and the two cannot
 * simply both be rendered with one hidden by CSS: each row holds its draft in state, so a hidden
 * twin would carry a stale draft and show it the moment the window crossed the breakpoint. One
 * layout at a time, chosen by the same media query the CSS uses, keeps a single draft per account.
 * Under Node (the render tests) there is no window, and the table is the answer.
 */
const NARROW = '(max-width: 767.98px)';
const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
const subscribeNarrow = (onChange) => {
  if (!canQuery()) return () => {};
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const readNarrow = () => canQuery() && window.matchMedia(NARROW).matches;
const readNarrowOnServer = () => false;
const useNarrow = () => useSyncExternalStore(subscribeNarrow, readNarrow, readNarrowOnServer);

/**
 * Where a balance came from, and when. A typed number says "typed 22 Aug"; a statement says which
 * bank's summary and its date; a balance older than the data by more than two months gets a
 * warning, because every past cycle is re-based from it and a stale anchor bends the whole line.
 */
function Provenance({ account, dataThrough, align = 'end' }) {
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
    <span className={`flex flex-col gap-1 ${align === 'end' ? 'items-end' : 'flex-row flex-wrap items-center'}`}>
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
 *
 * The draft, the commit and the six controls are the same on every screen; only their arrangement
 * differs. A desktop gets a table row (one account per line, fields side by side), a phone gets a
 * stacked form per account, because six inputs across 350px is six inputs you cannot see.
 */
function useAccountDraft({ account, onSave, dataThrough, todayIso }) {
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

  return { owed, stored, value, setValue, asOf, setAsOf, limit, setLimit, overdraft, setOverdraft, label, setLabel, saved, isCard, isBank, commit };
}

const NAME_INPUT_CLASS =
  'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-hair focus:border-info/30 focus:bg-transparent focus:outline-none';

function NameInput({ account, draft }) {
  return (
    <input
      value={draft.label}
      onChange={(e) => draft.setLabel(e.target.value)}
      onBlur={draft.commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      placeholder={accountLabel(account)}
      aria-label={`Name for ${accountLabel(account)}`}
      className={NAME_INPUT_CLASS}
    />
  );
}

function BalanceField({ account, draft, ...rest }) {
  return (
    <Field
      prefix={draft.owed ? 'owe R' : 'R'}
      value={draft.value}
      onChange={draft.setValue}
      onCommit={draft.commit}
      placeholder="—"
      ariaLabel={`Current balance for ${accountLabel(account)}`}
      width="w-28"
      {...rest}
    />
  );
}

function AsOfField({ account, draft, todayIso, ...rest }) {
  return (
    <Field
      type="date"
      inputMode="none"
      value={draft.asOf}
      onChange={draft.setAsOf}
      onCommit={draft.commit}
      max={todayIso}
      ariaLabel={`Balance as of for ${accountLabel(account)}`}
      width="w-36"
      {...rest}
    />
  );
}

/** The credit limit on a card, the overdraft on a bank account, nothing on anything else. */
function LimitField({ account, draft, ...rest }) {
  if (draft.isCard) {
    return (
      <Field
        prefix="R"
        value={draft.limit}
        onChange={draft.setLimit}
        onCommit={draft.commit}
        placeholder="limit"
        ariaLabel={`Credit limit for ${accountLabel(account)}`}
        {...rest}
      />
    );
  }
  if (draft.isBank) {
    return (
      <Field
        prefix="R"
        value={draft.overdraft}
        onChange={draft.setOverdraft}
        onCommit={draft.commit}
        placeholder="overdraft"
        ariaLabel={`Overdraft limit for ${accountLabel(account)}`}
        {...rest}
      />
    );
  }
  return null;
}

function Stored({ account, draft, dataThrough, align }) {
  if (draft.saved) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-good">
        <Check size={13} /> saved
      </span>
    );
  }
  return (
    <span className={`flex gap-1 ${align === 'end' ? 'flex-col items-end' : 'flex-wrap items-center gap-x-2'}`}>
      {draft.stored != null && (
        <span className="text-xs text-label-3 tabular-nums">
          {draft.owed ? `−${formatCurrencyAbs(draft.stored)}` : formatCurrencyAbs(draft.stored)}
        </span>
      )}
      <Provenance account={account} dataThrough={dataThrough} align={align} />
    </span>
  );
}

function AccountRow({ account, onSave, dataThrough, todayIso }) {
  const draft = useAccountDraft({ account, onSave, dataThrough, todayIso });
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-2.5">
        <NameInput account={account} draft={draft} />
        <div className="px-1.5 text-[11px] text-label-3">
          {account.rawName}
          {account.seenNames?.length > 1 && ' · renamed by the export'}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-label-2">{account.type}</td>
      <td className="px-4 py-2.5">
        <BalanceField account={account} draft={draft} />
      </td>
      <td className="px-4 py-2.5">
        <AsOfField account={account} draft={draft} todayIso={todayIso} />
      </td>
      <td className="px-4 py-2.5">
        {draft.isCard || draft.isBank ? (
          <LimitField account={account} draft={draft} />
        ) : (
          <span className="text-xs text-label-4">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Stored account={account} draft={draft} dataThrough={dataThrough} align="end" />
      </td>
    </tr>
  );
}

/**
 * The phone layout: one stacked form per account. Every control is full width and at least 44px
 * tall (the Field kit's input is 30px, sized for a table cell, so the height and the 16px type —
 * which is what stops iOS zooming into a focused input — are applied from here through the
 * `[&_input]` variants rather than by giving the kit a mode).
 */
const TOUCH_FIELD =
  '[&_input]:min-h-11 [&_input]:w-full [&_input]:min-w-0 [&_input]:text-base [&_label_span]:whitespace-nowrap';

function AccountCard({ account, onSave, dataThrough, todayIso }) {
  const draft = useAccountDraft({ account, onSave, dataThrough, todayIso });
  const limitLabel = draft.isCard ? 'Credit limit' : draft.isBank ? 'Overdraft limit' : null;
  return (
    <li className={`flex flex-col gap-3 border-b px-4 py-4 last:border-0 ${TOUCH_FIELD}`}>
      <div>
        <NameInput account={account} draft={draft} />
        <div className="flex flex-wrap items-baseline gap-x-2 px-1.5 text-[11px] text-label-3">
          <span className="text-label-2">{account.type}</span>
          <span>
            {account.rawName}
            {account.seenNames?.length > 1 && ' · renamed by the export'}
          </span>
        </div>
      </div>
      {/* Two to a row: a balance and a date are short, and twelve accounts of one-per-line is a
          long way to scroll. The date column is the wider, because a native date input at 16px
          needs ~170px for its digits and picker icon and clips them at half of 360. The limit,
          when there is one, takes the next row's left half. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-3">
        <BalanceField account={account} draft={draft} label="Balance today" className="min-w-0" />
        <AsOfField account={account} draft={draft} todayIso={todayIso} label="As of" className="min-w-0" />
        {limitLabel && <LimitField account={account} draft={draft} label={limitLabel} className="min-w-0" />}
      </div>
      <div className="flex min-h-5 items-center">
        <Stored account={account} draft={draft} dataThrough={dataThrough} align="start" />
      </div>
    </li>
  );
}

export function BalancesEditor({ accounts, onSave, onDeleteAccount, dataThrough, typeOverrideHint }) {
  const todayIso = isoOf(new Date());
  const narrow = useNarrow();
  const list = (accounts ?? []).filter((a) => a && !a.external);
  const sorted = [...list].sort(
    (a, b) => compareAccountTypes(a.type, b.type) || (a.rawName ?? '').localeCompare(b.rawName ?? ''),
  );
  const missing = sorted.filter((a) => a.currentBalance == null).length;
  const empty = (
    <span className="t-caption">No accounts yet — import an export or upload an account summary.</span>
  );

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-4 md:px-6 md:py-5">
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
      {narrow ? (
        <ul className="flex flex-col">
          {sorted.map((a) => (
            <AccountCard key={a.id} account={a} onSave={onSave} dataThrough={dataThrough} todayIso={todayIso} />
          ))}
          {sorted.length === 0 && <li className="px-4 py-4">{empty}</li>}
        </ul>
      ) : (
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
                  <td colSpan={6} className="px-4 py-4">
                    {empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <ExternalAccounts accounts={accounts} onDeleteAccount={onDeleteAccount} className="border-t px-4 py-4 md:px-6 md:py-5" />
      {typeOverrideHint && (
        <p className="border-t bg-warn/10 px-4 py-3 text-xs text-warn md:px-6">{typeOverrideHint}</p>
      )}
    </div>
  );
}
