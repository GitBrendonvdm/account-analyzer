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
 * EXPECTED / UNEXPECTED is not cosmetic. Exceptions are excluded from the averages, the forecast
 * and the band around it, so the chips decide whether these payments shape what the app expects of
 * next cycle — which is stated on the row, because a control whose effect is invisible gets used
 * wrongly. Pressing the active chip clears the verdict and hands the row back to the classifier.
 *
 * MOVING a payment rewrites its Category / Spending Group at the top of the pipeline, so every
 * total, average and forecast agrees at once. The pickers offer only labels already in the file:
 * a free-text box would let one typo split a category in two, and nothing downstream would notice.
 */

const VERDICTS = [
  { id: 'expected', label: 'Expected', hint: 'Counts toward the averages and the forecast' },
  { id: 'unexpected', label: 'Unexpected', hint: 'A one-off — kept out of the averages and the forecast' },
];

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

  return (
    <tr className="border-t bg-fill/60 text-xs">
      <td colSpan={columns} className="px-4 py-3 pl-20 max-md:pl-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-label-3">
            {keys.length === 1 ? '1 payment' : `${keys.length} payments`} · {label}
          </span>

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
                  className={`press min-h-11 rounded-full px-3 py-1 text-[12px] whitespace-nowrap sm:min-h-0 sm:text-[11px] ${
                    on ? 'bg-fill-2 font-semibold text-label' : 'text-label-3 hover:text-label'
                  }`}
                >
                  {v.label}
                </button>
              );
            })}
          </span>

          <label className="flex items-center gap-1.5">
            <span className="text-label-3">Category</span>
            <select
              value={category ?? ''}
              onChange={(e) => set({ category: e.target.value || null })}
              className="glass-chip max-w-44 min-h-11 rounded-full px-3 py-1 text-[12px] text-label sm:min-h-0 sm:text-[11px]"
            >
              <option value="">as imported</option>
              {choices.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {choices.spendingGroups.length > 0 && (
            <label className="flex items-center gap-1.5">
              <span className="text-label-3">Group</span>
              <select
                value={spendingGroup ?? ''}
                onChange={(e) => set({ spendingGroup: e.target.value || null })}
                className="glass-chip max-w-44 min-h-11 rounded-full px-3 py-1 text-[12px] text-label sm:min-h-0 sm:text-[11px]"
              >
                <option value="">as imported</option>
                {choices.spendingGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(flag || category || spendingGroup) && (
            <button
              type="button"
              onClick={() => set({ flag: null, category: null, spendingGroup: null })}
              className="press text-label-3 underline-offset-2 hover:text-label hover:underline max-md:min-h-11"
            >
              Reset
            </button>
          )}
        </div>

        <p className="t-caption mt-1.5">
          {flag === 'unexpected' || (isException && flag !== 'expected')
            ? 'Treated as a one-off: left out of the averages, the forecast and its range.'
            : 'Counted as ordinary spend: it shapes the averages, the forecast and its range.'}
        </p>
      </td>
    </tr>
  );
}
