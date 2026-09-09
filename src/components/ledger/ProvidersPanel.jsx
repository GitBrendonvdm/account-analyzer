import { useMemo, useState } from 'react';
import { ChevronDown, Plus, Sparkles, Store, Trash2, X } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import { paymentsOf, providerIsUsable, rowsSaved } from '../../lib/providers';
import { suggestProviders } from '../../lib/providerSuggest';

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
 * Nothing is ever applied on its own. A wrong guess merges two real merchants into one row and one
 * forecast, which is close to impossible to notice afterwards — so a provider only exists once the
 * reader has said so. What the app WILL do is read the file and point: the suggestions above the
 * list are the shops it is confident about, each showing the names it would swallow, because a
 * one-click accept is only safe if what it will do is legible before the click. Everything the
 * detector deliberately misses is still one manual grouping away, which is the right way round.
 *
 * A SAVED PROVIDER STAYS EDITABLE, because a provider is never finished: next month's export
 * arrives with a branch spelt a way this one has not seen, and the reader's only recourse otherwise
 * is to delete the shop and type it again. So each row opens onto the same two fields it was made
 * with, and the catch count updates as the synonym is added — which is also the only way to notice
 * that the new synonym reached further than intended.
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

/** One shop the file is confident about: what it is, what it catches, and the names it would fold. */
function Suggestion({ suggestion, onAccept, onDismiss }) {
  const { name, payments, names, category, sample } = suggestion;
  return (
    <li className="glass flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5">
      <span className="min-w-0 flex-grow">
        <b className="text-[13px] font-semibold text-label">{name}</b>{' '}
        <span className="num text-[12px] text-label-3">
          {names} names · {payments} payments · {category}
        </span>
        <span className="t-caption block truncate">{sample.join(' · ')}</span>
      </span>
      <button
        type="button"
        onClick={onAccept}
        className="press glass-chip flex shrink-0 items-center gap-1 px-2.5 py-1.5 text-[12px] text-info hover:brightness-125 max-md:min-h-11"
      >
        <Plus size={12} /> Group
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss the suggestion for ${name}`}
        className="press shrink-0 rounded-full p-1.5 text-label-4 hover:text-label max-md:min-h-11 max-md:min-w-11"
      >
        <X size={12} />
      </button>
    </li>
  );
}

export function ProvidersPanel({ providers = [], data, spend, onChange, draft, onDraft }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const showForm = open || Boolean(draft);
  const current = draft ?? { name: '', synonyms: [] };
  const saved = rowsSaved(data, providers);
  // Read from spend rows, not every row: transfers and loan internals are not shops, and dropping
  // them first is what keeps banking language out of the suggestions.
  const suggestions = useMemo(
    () => suggestProviders(spend ?? data, providers).filter((s) => !dismissed.has(s.name)),
    [spend, data, providers, dismissed],
  );
  const accept = (list) =>
    onChange?.([...providers, ...list.map((s) => ({ name: s.name, synonyms: s.synonyms }))]);
  const preview = providerIsUsable(current) ? paymentsOf(data, current) : [];
  const previewNames = new Set(preview.map((t) => (t.Description ?? '').toLowerCase()));

  const set = (patch) => onDraft?.({ ...current, ...patch });
  const update = (i, patch) =>
    onChange?.(providers.map((p, j) => (j === i ? { ...p, ...patch } : p)));
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

      {suggestions.length > 0 && !showForm && (
        <div className="mt-4 border-t pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] text-label-2">
              <Sparkles size={13} className="text-info" />
              <b className="font-semibold text-label">{suggestions.length} shops</b> the file is sure
              about — every payment filed under one category, under names only a person would connect.
            </span>
            <button
              type="button"
              onClick={() => accept(suggestions)}
              className="press glass-chip px-3 py-1.5 text-[12px] font-medium text-info hover:brightness-125 max-md:min-h-11"
            >
              Group all {suggestions.length}
            </button>
          </div>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {suggestions.map((s) => (
              <Suggestion
                key={s.name}
                suggestion={s}
                onAccept={() => accept([s])}
                onDismiss={() => setDismissed((d) => new Set(d).add(s.name))}
              />
            ))}
          </ul>
        </div>
      )}

      {providers.length > 0 && (
        <ul className="mt-4 flex flex-col">
          {providers.map((p, i) => {
            const payments = paymentsOf(data, p);
            const names = new Set(payments.map((t) => (t.Description ?? '').toLowerCase())).size;
            const on = editing === i;
            return (
              <li key={`${p.name}|${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-2.5 text-[13px]">
                <button
                  type="button"
                  onClick={() => setEditing(on ? null : i)}
                  aria-expanded={on}
                  title={`Edit ${p.name}`}
                  className="press flex min-w-0 flex-grow items-center gap-1.5 text-left hover:text-label"
                >
                  <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className={`shrink-0 text-label-4 transition-transform ${on ? 'rotate-180' : ''}`}
                  />
                  <span className="min-w-0">
                    <b className="font-semibold text-label">{p.name}</b>{' '}
                    <span className="text-label-3">{(p.synonyms ?? []).join(' · ')}</span>
                  </span>
                </button>
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
                {on && (
                  <div className="flex w-full flex-col gap-2.5 rounded-lg bg-fill/70 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="text-label-3">Call it</span>
                      <input
                        value={p.name}
                        onChange={(e) => update(i, { name: e.target.value })}
                        aria-label={`Rename ${p.name}`}
                        className="glass-chip min-h-9 w-44 rounded-full px-3 text-base outline-none max-md:min-h-11 sm:text-[13px]"
                      />
                    </div>
                    <div className="flex flex-wrap items-start gap-2 text-[12px]">
                      <span className="mt-1.5 shrink-0 text-label-3">when the name contains</span>
                      <SynonymList
                        synonyms={p.synonyms ?? []}
                        onChange={(synonyms) => update(i, { synonyms })}
                      />
                    </div>
                    {/* The names it swallows, so a synonym that reached too far is visible at once. */}
                    <p className="t-caption border-t pt-2.5">
                      {[...new Set(payments.map((t) => t.Description))].slice(0, 6).join(' · ') ||
                        'Catches nothing yet.'}
                      {names > 6 ? ` · and ${names - 6} more` : ''}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
