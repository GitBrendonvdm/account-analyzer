import { useState } from 'react';
import { Store, Trash2, X } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import { paymentsOf, providerIsUsable, rowsSaved } from '../../lib/providers';

/**
 * The shops behind the branch names — how many rows they fold away, and what each one catches.
 *
 * The bank writes a branch, not a merchant: "Pick N Pay Asap Kenilworth Za", "Pnp Crp Glengarry
 * Cape Town Za", "Pnp Hpr Brackenfell Brackenfell Za" are three rows and one shop, and no amount of
 * string similarity will relate them, because as text they are not similar. Only a person knows.
 *
 * The count of rows folded is the headline because it is the reason to bother, and the per-provider
 * payment count is here for the same reason a rule shows its blast radius: a synonym like "spar"
 * quietly catching Kwikspar is usually right and occasionally very wrong, and the only way to tell
 * is to see the number move.
 *
 * Nothing is ever inferred. A wrong guess merges two real merchants into one row and one forecast,
 * which is close to impossible to notice afterwards — so providers are only ever the reader's.
 */

function SynonymList({ synonyms, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const s = draft.trim();
    setDraft('');
    if (s.length >= 2 && !synonyms.some((x) => x.toLowerCase() === s.toLowerCase())) {
      onChange([...synonyms, s]);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {synonyms.map((s) => (
        <span key={s} className="glass-chip flex items-center gap-1 py-0.5 pr-1 pl-2.5 text-[12px]">
          <span className="text-label-2">{s}</span>
          <button
            type="button"
            onClick={() => onChange(synonyms.filter((x) => x !== s))}
            aria-label={`Remove synonym ${s}`}
            className="press rounded-full p-0.5 text-label-4 hover:text-bad max-md:min-h-11 max-md:min-w-11"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="add a name…"
        aria-label="Add a synonym"
        className="glass-chip min-h-8 w-32 rounded-full px-2.5 text-[12px] outline-none max-md:min-h-11 max-md:text-base"
      />
    </span>
  );
}

export function ProvidersPanel({ providers = [], data, onChange, draft, onDraft }) {
  const [open, setOpen] = useState(false);
  const showForm = open || Boolean(draft);
  const current = draft ?? { name: '', synonyms: [] };
  const saved = rowsSaved(data, providers);
  const preview = providerIsUsable(current) ? paymentsOf(data, current) : [];
  const previewNames = new Set(preview.map((t) => (t.Description ?? '').toLowerCase()));

  const set = (patch) => onDraft?.({ ...current, ...patch });
  const save = () => {
    if (!providerIsUsable(current)) return;
    onChange?.([...providers, { name: current.name.trim(), synonyms: current.synonyms }]);
    onDraft?.(null);
    setOpen(false);
  };

  return (
    <Card className="materialize p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHead
          title={`Providers${providers.length ? ` (${providers.length})` : ''}`}
          subtitle={
            saved > 0
              ? `One row per shop instead of one per branch — folding ${saved} ${saved === 1 ? 'row' : 'rows'} away, and putting each shop's history back together so its forecast has something to stand on.`
              : "Your bank writes the branch, not the shop: Pnp Crp, Pnp Hpr and Pick N Pay Asap are three rows and one shop. Group them and their history — and their forecast — becomes one."
          }
        />
        {!showForm && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="press glass-chip flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] text-info hover:brightness-125 max-md:min-h-11"
          >
            <Store size={13} /> New provider
          </button>
        )}
      </div>

      {showForm && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-fill/70 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-label-3">Call it</span>
            <input
              value={current.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Pick n Pay"
              aria-label="Provider name"
              className="glass-chip min-h-9 w-44 rounded-full px-3 text-base outline-none max-md:min-h-11 sm:text-[13px]"
            />
          </div>
          <div className="flex flex-wrap items-start gap-2 text-[12px]">
            <span className="mt-1.5 shrink-0 text-label-3">when the name contains</span>
            <SynonymList synonyms={current.synonyms ?? []} onChange={(synonyms) => set({ synonyms })} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <span className="text-[12px] text-label-2">
              {providerIsUsable(current) ? (
                <>
                  catches <b className="font-semibold text-label">{preview.length}</b>{' '}
                  {preview.length === 1 ? 'payment' : 'payments'} across{' '}
                  <b className="font-semibold text-label">{previewNames.size}</b>{' '}
                  {previewNames.size === 1 ? 'name' : 'names'}
                  {preview.length > 0 && (
                    <span className="text-label-3">
                      {' '}
                      · {formatCurrencyAbs(preview.reduce((s, t) => s + Math.abs(t.AmountNum || 0), 0))}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-label-3">Needs a name, and at least one thing to match on.</span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onDraft?.(null);
                  setOpen(false);
                }}
                className="press text-[12px] text-label-3 hover:text-label max-md:min-h-11"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!providerIsUsable(current)}
                className="press glass-chip px-3 py-2 text-[13px] font-medium text-info disabled:opacity-40 max-md:min-h-11"
              >
                Save provider
              </button>
            </span>
          </div>

          {/* The names it will swallow, so a synonym that reaches too far is caught before saving. */}
          {previewNames.size > 0 && (
            <p className="t-caption border-t pt-2.5">
              {[...previewNames].slice(0, 6).join(' · ')}
              {previewNames.size > 6 ? ` · and ${previewNames.size - 6} more` : ''}
            </p>
          )}
        </div>
      )}

      {providers.length > 0 && (
        <ul className="mt-4 flex flex-col">
          {providers.map((p, i) => {
            const payments = paymentsOf(data, p);
            const names = new Set(payments.map((t) => (t.Description ?? '').toLowerCase())).size;
            return (
              <li key={`${p.name}|${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-2.5 text-[13px]">
                <span className="min-w-0 flex-grow">
                  <b className="font-semibold text-label">{p.name}</b>{' '}
                  <span className="text-label-3">{(p.synonyms ?? []).join(' · ')}</span>
                </span>
                <span className="num shrink-0 text-[12px] text-label-3">
                  {names} {names === 1 ? 'name' : 'names'} · {payments.length}{' '}
                  {payments.length === 1 ? 'payment' : 'payments'}
                </span>
                <button
                  type="button"
                  onClick={() => onChange?.(providers.filter((_, j) => j !== i))}
                  aria-label={`Delete provider ${p.name}`}
                  className="press shrink-0 rounded-full p-1.5 text-label-4 hover:text-bad max-md:min-h-11 max-md:min-w-11"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
