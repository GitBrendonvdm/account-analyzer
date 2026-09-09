import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * The reader's corrections to one description's payments: whether they were expected, and what
 * they should have been filed under.
 *
 * It is a row of its own, spanning the table under the description it belongs to, rather than
 * controls squeezed into the description's own cells. Sixty description rows each carrying two
 * chips and two pickers would be unreadable, and the columns are already full of figures; this
 * appears only where the reader opened it, and it is the one place in the ledger that writes
 * rather than reads.
 *
 * Because it is the only writable thing on a dense page of figures, it has to look like a panel
 * rather than another table row — inset from the edges, its own surface, an accent down the left —
 * or it reads as a band of stray text across the middle of the ledger. Each control sits under its
 * own quiet label, which is what lets the sentence explaining the consequence be one short line
 * instead of a paragraph. The selects are `appearance-none` and carry their own chevron: a native
 * dropdown is the single most out-of-place element this design can contain, and the reason to keep
 * `<select>` underneath is that its keyboard and touch behaviour are better than anything hand-made.
 *
 * EXPECTED / UNEXPECTED is not cosmetic. Exceptions are excluded from the averages, the forecast
 * and the band around it, so the chips decide whether these payments shape what the app expects of
 * next cycle — which is stated on the panel, because a control whose effect is invisible gets used
 * wrongly. Pressing the active chip clears the verdict and hands the row back to the classifier.
 *
 * MOVING a payment rewrites its Category / Spending Group at the top of the pipeline, so every
 * total, average and forecast agrees at once. The pickers offer the labels already in the file, so
 * that a stray keystroke cannot split a category in two without anyone noticing — but a reader who
 * wants a grouping their bank never had ("move all Communications to Recurring") must be able to
 * say so, so "New…" turns the picker into a text box for exactly that one deliberate act. Typing a
 * name that already exists simply selects it, rather than creating a second one beside it.
 */

const VERDICTS = [
  { id: 'expected', label: 'Expected', hint: 'Counts toward the averages and the forecast' },
  { id: 'unexpected', label: 'Unexpected', hint: 'A one-off — kept out of the averages and the forecast' },
];

/** A label above a control, so the control itself needs no sentence beside it. */
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wide text-label-4 uppercase">{label}</span>
      {children}
    </label>
  );
}

/** Sentinel for the “New…” option; no real category is called this. */
const NEW = '__new__';

/** `<select>` for its behaviour, none of its chrome — with a way out to a name that does not exist. */
function Picker({ value, onChange, options, label, empty = 'as imported' }) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const name = draft.trim();
    setNaming(false);
    setDraft('');
    if (!name) return;
    // Match an existing label case-insensitively rather than creating a near-duplicate beside it.
    onChange(options.find((o) => o.toLowerCase() === name.toLowerCase()) ?? name);
  };

  if (naming) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setNaming(false);
              setDraft('');
            }
          }}
          placeholder="Recurring"
          aria-label={`New name for ${label}`}
          className="glass-chip min-h-9 w-40 rounded-full px-3 text-[12.5px] text-label outline-none max-md:min-h-11 max-md:text-base"
        />
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <select
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setNaming(true);
            return;
          }
          onChange(e.target.value || null);
        }}
        aria-label={label}
        className="glass-chip min-h-9 w-40 cursor-pointer appearance-none rounded-full py-1.5 pr-8 pl-3 text-[12.5px] text-label outline-none max-md:min-h-11 max-md:text-base"
      >
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        <option value={NEW}>New…</option>
      </select>
      <ChevronDown
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-label-4"
      />
    </span>
  );
}

export function RowOverrideEditor({
  columns,
  label,
  keys = [],
  flag = null,
  category = null,
  spendingGroup = null,
  choices = { categories: [], spendingGroups: [] },
  onChange,
  isException = false,
}) {
  if (!onChange || !keys.length) return null;
  const set = (patch) => onChange(keys, patch);
  const touched = flag || category || spendingGroup;
  const excluded = flag === 'unexpected' || (isException && flag !== 'expected');

  return (
    <tr className="bg-fill/40">
      <td colSpan={columns} className="px-4 py-2.5 pl-20 max-md:px-3 max-md:pl-8">
        <div className="glass rounded-xl border-l-2 border-l-info/60 p-3.5">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <Field label="Counts as">
              <span className="glass-chip flex gap-0.5 p-0.5" role="group" aria-label={`Was ${label} expected?`}>
                {VERDICTS.map((v) => {
                  const on = flag === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={on}
                      title={v.hint}
                      onClick={() => set({ flag: on ? null : v.id })}
                      className={`press min-h-9 rounded-full px-3 py-1 text-[12.5px] whitespace-nowrap max-md:min-h-11 ${
                        on ? 'bg-fill-2 font-semibold text-label' : 'text-label-3 hover:text-label'
                      }`}
                    >
                      {v.label}
                    </button>
                  );
                })}
              </span>
            </Field>

            <Field label="Category">
              <Picker
                value={category}
                onChange={(v) => set({ category: v })}
                options={choices.categories}
                label={`Category for ${label}`}
              />
            </Field>

            {choices.spendingGroups?.length > 0 && (
              <Field label="Group">
                <Picker
                  value={spendingGroup}
                  onChange={(v) => set({ spendingGroup: v })}
                  options={choices.spendingGroups}
                  label={`Spending group for ${label}`}
                />
              </Field>
            )}

            <span className="flex flex-grow items-center justify-end gap-3">
              {touched && (
                <button
                  type="button"
                  onClick={() => set({ flag: null, category: null, spendingGroup: null })}
                  className="press text-[12px] text-label-3 underline-offset-2 hover:text-label hover:underline max-md:min-h-11"
                >
                  Reset
                </button>
              )}
            </span>
          </div>

          <p className="mt-3 border-t pt-2.5 text-[12px] text-label-3">
            <span className="text-label-4">
              {keys.length === 1 ? '1 payment' : `${keys.length} payments`} ·{' '}
            </span>
            {excluded
              ? 'left out of the averages, the forecast and its range.'
              : 'counted as ordinary spend, so it shapes the averages, the forecast and its range.'}
          </p>
        </div>
      </td>
    </tr>
  );
}
