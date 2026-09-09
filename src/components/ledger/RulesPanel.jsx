import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import { matchesOf, ruleIsUsable } from '../../lib/txnRules';

/**
 * The standing corrections, listed — what each one catches, what it does, and how many payments it
 * is currently holding.
 *
 * A rule is invisible by nature: it changes rows the reader is not looking at, and it will change
 * rows that do not exist yet. So the count beside each one is not decoration. It is the only way to
 * see that "insurance" quietly caught eighty charges you never meant, and it is shown live while
 * the rule is being written, before it is saved — a rule you cannot preview is a rule you will not
 * trust enough to write.
 *
 * Rules are a DEFAULT and lose to a correction made on a specific payment (see txnRules.js), which
 * is what makes "all of these, except that one" sayable. Disabling a rule is offered beside
 * deleting it, because the useful question is often "what did this rule do to my numbers?" and the
 * honest way to answer it is to switch the rule off and look.
 */

const EMPTY = { description: '', minAmount: '', set: { category: '', flag: '' } };
const FLAGS = [
  { id: '', label: 'leave as is' },
  { id: 'expected', label: 'expected' },
  { id: 'unexpected', label: 'unexpected' },
];

const num = (v) => {
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** A draft as the engine will see it, so the live count is the count the saved rule will have. */
function toRule(draft) {
  return {
    description: draft.description.trim() || undefined,
    minAmount: num(draft.minAmount) ?? undefined,
    set: {
      category: draft.set.category || undefined,
      flag: draft.set.flag || undefined,
    },
    enabled: true,
  };
}

function describe(rule) {
  const when = [];
  if (rule.description) when.push(`matches “${rule.description}”`);
  if (rule.category) when.push(`in ${rule.category}`);
  if (rule.account) when.push(`on ${rule.account}`);
  if (Number.isFinite(rule.minAmount)) when.push(`over ${formatCurrencyAbs(rule.minAmount)}`);
  const then = [];
  if (rule.set?.category) then.push(`→ ${rule.set.category}`);
  if (rule.set?.spendingGroup) then.push(`→ ${rule.set.spendingGroup}`);
  if (rule.set?.flag) then.push(rule.set.flag);
  return { when: when.join(' · ') || 'everything', then: then.join(' · ') || 'nothing' };
}

export function RulesPanel({ rules = [], data, choices = { categories: [] }, onChange, draft, onDraft }) {
  const [open, setOpen] = useState(false);
  const editing = draft ?? null;
  const showForm = open || Boolean(editing);
  const current = editing ?? EMPTY;

  const set = (patch) => onDraft?.({ ...current, ...patch });
  const setEffect = (patch) => onDraft?.({ ...current, set: { ...current.set, ...patch } });
  const candidate = toRule(current);
  const preview = ruleIsUsable(candidate) ? matchesOf(data, candidate) : [];

  const save = () => {
    if (!ruleIsUsable(candidate)) return;
    // No generated id: rules are ordered, and order is their identity — a later rule beats an
    // earlier one (txnRules.js), so position is the thing that means something about them.
    onChange?.([...rules, candidate]);
    onDraft?.(null);
    setOpen(false);
  };
  const patch = (i, next) => onChange?.(rules.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const remove = (i) => onChange?.(rules.filter((_, j) => j !== i));

  return (
    <Card className="materialize p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHead
          title={`Rules${rules.length ? ` (${rules.length})` : ''}`}
          subtitle="One decision that keeps applying — to these payments and to the ones imported next month. A correction you make on a single payment always wins over a rule."
        />
        {!showForm && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="press glass-chip flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] text-info hover:brightness-125 max-md:min-h-11"
          >
            <Plus size={13} /> New rule
          </button>
        )}
      </div>

      {showForm && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-fill/70 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-label-3">When the description contains</span>
            <input
              value={current.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="builders"
              aria-label="Description contains"
              className="glass-chip min-h-11 w-40 bg-transparent px-3 text-base outline-none sm:min-h-0 sm:text-[13px]"
            />
            <span className="text-label-3">and is over R</span>
            <input
              value={current.minAmount}
              onChange={(e) => set({ minAmount: e.target.value })}
              placeholder="0"
              inputMode="numeric"
              aria-label="Minimum amount"
              className="glass-chip min-h-11 w-20 bg-transparent px-3 text-base outline-none sm:min-h-0 sm:text-[13px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-label-3">then move it to</span>
            <select
              value={current.set.category}
              onChange={(e) => setEffect({ category: e.target.value })}
              aria-label="Move to category"
              className="glass-chip min-h-11 max-w-48 rounded-full px-3 text-[13px] text-label sm:min-h-0"
            >
              <option value="">leave the category</option>
              {choices.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="text-label-3">and mark it</span>
            <select
              value={current.set.flag}
              onChange={(e) => setEffect({ flag: e.target.value })}
              aria-label="Mark as"
              className="glass-chip min-h-11 rounded-full px-3 text-[13px] text-label sm:min-h-0"
            >
              {FLAGS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            {/* Live, before saving: a rule you cannot preview is a rule you will not trust. */}
            <span className="text-[12px] text-label-2">
              {ruleIsUsable(candidate) ? (
                <>
                  catches <b className="font-semibold text-label">{preview.length}</b>{' '}
                  {preview.length === 1 ? 'payment' : 'payments'} now
                  {preview.length > 0 && (
                    <span className="text-label-3">
                      {' '}
                      · {formatCurrencyAbs(preview.reduce((s, t) => s + Math.abs(t.AmountNum || 0), 0))}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-label-3">Needs something to match on, and something to do.</span>
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
                disabled={!ruleIsUsable(candidate)}
                className="press glass-chip px-3 py-2 text-[13px] font-medium text-info disabled:opacity-40 max-md:min-h-11"
              >
                Save rule
              </button>
            </span>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <ul className="mt-4 flex flex-col">
          {rules.map((r, i) => {
            const { when, then } = describe(r);
            const count = matchesOf(data, r).length;
            const off = r.enabled === false;
            return (
              <li
                key={`${r.description ?? ''}|${r.minAmount ?? ''}|${i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-2.5 text-[13px]"
              >
                <span className={`min-w-0 flex-grow ${off ? 'text-label-4' : 'text-label-2'}`}>
                  <b className={off ? 'font-semibold' : 'font-semibold text-label'}>{when}</b>{' '}
                  <span className="text-label-3">{then}</span>
                </span>
                <span className="num shrink-0 text-[12px] text-label-3">
                  {off ? 'off' : `${count} ${count === 1 ? 'payment' : 'payments'}`}
                </span>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => patch(i, { enabled: off })}
                  title="Switch the rule off to see what it was doing to your numbers"
                  className="press glass-chip shrink-0 px-2.5 py-1 text-[11px] max-md:min-h-11"
                >
                  {off ? 'Enable' : 'Disable'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Delete rule ${when}`}
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
