import { useState } from 'react';

/**
 * What the accounts list and its edit dialog share: the date helpers, how a balance's origin is
 * worded, and the draft behind the edit form.
 */

const DAY_MS = 86400000;

export const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const toIso = (v) => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : isoOf(d);
};

export const fmtIso = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
};

export const parseAmount = (s) => {
  const v = parseFloat(String(s ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(v) ? Math.abs(v) : null;
};

/**
 * Where a balance came from, and when: "typed 22 Aug", "as of 15 Oct · from your FNB history". A
 * balance older than the data by more than two months is flagged too, because every past cycle is
 * re-based from it and a stale anchor bends the whole line.
 *
 * @returns {{ text: string, staleDays: number }|null} null when no balance has been given
 */
export function provenanceOf(account, dataThrough) {
  if (account.currentBalance == null) return null;
  const asOf = toIso(account.balanceAsOf);
  const date = fmtIso(asOf);
  const bank = account.bank || 'bank';
  const text =
    account.source === 'statement'
      ? `as of ${date ?? '—'} · from your ${bank} summary`
      : account.source === 'history'
        ? `as of ${date ?? '—'} · from your ${bank} history`
        : account.source === 'manual'
          ? `typed${date ? ` ${date}` : ''}`
          : date
            ? `as of ${date}`
            : 'from the export';
  const through = toIso(dataThrough);
  const staleDays = asOf && through ? Math.round((new Date(through) - new Date(asOf)) / DAY_MS) : 0;
  return { text, staleDays };
}

/**
 * The draft behind the edit form. A balance is typed as a positive amount owed for debt (that is how
 * people say it) and the sign is applied here. Saving sends only the keys that changed, and a balance
 * save always carries `source: 'manual'` and the as-of date — clamped to today — so the provenance
 * line tells the truth afterwards.
 */
export function useAccountDraft({ account, onSave, dataThrough, todayIso }) {
  const owed = account.isLiability;
  const stored = account.currentBalance;
  const defaultAsOf = toIso(account.balanceAsOf) ?? toIso(dataThrough) ?? todayIso;
  const [value, setValue] = useState(stored == null ? '' : String(Math.abs(stored)));
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [limit, setLimit] = useState(account.creditLimit == null ? '' : String(account.creditLimit));
  const [overdraft, setOverdraft] = useState(account.overdraftLimit == null ? '' : String(account.overdraftLimit));
  const [label, setLabel] = useState(account.label ?? '');
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
    if (!Object.keys(patch).length) return false;
    onSave?.(account.id, patch);
    return true;
  };

  return { owed, value, setValue, asOf, setAsOf, limit, setLimit, overdraft, setOverdraft, label, setLabel, isCard, isBank, commit };
}
