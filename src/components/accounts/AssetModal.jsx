import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { ASSET_KINDS, makeAsset, valueOn } from '../../lib/assets';
import { formatCurrencyAbs } from '../../utils/format';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';
import { parseAmount } from './accountBits';

const PRIMARY =
  'press flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11 max-md:flex-1';
const SECONDARY =
  'glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label max-md:min-h-11 max-md:flex-1';
const TOUCH_FIELD =
  '[&_input:not([type=checkbox])]:min-h-11 [&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:min-w-0 [&_input:not([type=checkbox])]:text-base';

/** The valuations as rows to edit: the day, and the worth as typed. */
const rowsOf = (asset, today) =>
  asset ? asset.valuations.map((v) => ({ date: v.date, value: String(Math.round(v.value)) })) : [{ date: today, value: '' }];

/**
 * Add what you own, or look after what you said it is worth.
 *
 * An asset is the days you looked and what you saw: the first is the day you got it and what it was
 * worth then, each later one a day you checked. Net worth moves in a straight line between them, so a
 * year's gain arrives a little each month. Rows can be added, changed or taken away; the loans ticked
 * are the ones taken out against it — they are already counted as debt, and ticking them only lets the
 * list say what is left of the asset once they are paid.
 */
export function AssetModal({ asset, loans, loanOwed, today, onSave, onDelete, onDone }) {
  const adding = !asset;
  const [name, setName] = useState(asset?.name ?? '');
  const [kind, setKind] = useState(asset?.kind ?? 'house');
  const [rows, setRows] = useState(() => rowsOf(asset, today));
  const [loanIds, setLoanIds] = useState(asset?.loanIds ?? []);
  const [confirming, setConfirming] = useState(false);

  // Rows with a real day and a real worth; where two share a day the later one wins.
  const valuations = [
    ...new Map(
      rows
        .map((r) => ({ date: r.date, value: parseAmount(r.value) }))
        .filter((v) => v.date && v.date <= today && v.value != null)
        .map((v) => [v.date, v]),
    ).values(),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const ready = name.trim() && valuations.length > 0;

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    onSave(
      adding
        ? { ...makeAsset({ name, kind, value: valuations[0].value, date: valuations[0].date, loanIds }), valuations }
        : { ...asset, name: name.trim(), kind, loanIds, valuations },
    );
    onDone();
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [...rs, { date: today, value: String(Math.round((asset ? valueOn(asset, today) : parseAmount(rs[rs.length - 1]?.value)) ?? 0)) }]);
  const removeRow = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  const toggleLoan = (id) => setLoanIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Sheet
      title={adding ? 'Add something you own' : asset.name}
      subtitle={
        adding
          ? 'A house, a car — anything worth money that is not in a bank account. It counts towards net worth from the day you got it.'
          : 'Add the days you checked what it is worth. Net worth moves smoothly from one to the next.'
      }
      onClose={onDone}
      footer={
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="submit" form="asset-form" disabled={!ready} className={PRIMARY}>
            {adding ? 'Add it' : 'Save'}
          </button>
          <button type="button" onClick={onDone} className={SECONDARY}>
            Cancel
          </button>
          {!adding &&
            onDelete &&
            (confirming ? (
              <span className="ml-auto flex items-center gap-2 text-xs max-md:ml-0 max-md:w-full">
                <span className="text-label-2">Delete {asset.name}?</span>
                <button
                  type="button"
                  onClick={() => {
                    onDelete(asset.id);
                    onDone();
                  }}
                  className="press rounded-full bg-bad/15 px-3 py-1 font-medium text-bad hover:bg-bad/25 max-md:min-h-11 max-md:px-4"
                >
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="press rounded-full px-3 py-1 text-label-2 hover:bg-fill max-md:min-h-11 max-md:px-4">
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="press ml-auto flex items-center gap-1.5 text-[12.5px] text-label-3 hover:text-bad max-md:ml-0 max-md:min-h-11"
              >
                <Trash2 size={13} />
                Delete
              </button>
            ))}
        </div>
      }
    >
      <form id="asset-form" onSubmit={submit} className={`mt-4 flex flex-col gap-4 ${TOUCH_FIELD}`}>
        <label className="flex flex-col gap-1.5">
          <span className="t-label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'car' ? 'Toyota Hilux' : kind === 'house' ? 'Our house' : 'What is it?'}
            autoFocus={adding}
            className="w-full rounded border bg-transparent px-2 py-1 text-sm focus:border-info/30 focus:outline-none"
          />
        </label>

        <div>
          <span className="t-label">What kind</span>
          <div className="glass-chip mt-1.5 flex w-fit gap-1 p-1 max-md:w-full" role="group" aria-label="Kind of asset">
            {ASSET_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                aria-pressed={kind === k.id}
                className={`press rounded-full px-3.5 py-1.5 text-[12.5px] max-md:min-h-11 max-md:flex-1 ${
                  kind === k.id ? 'bg-fill-2 font-semibold' : 'text-label-2 hover:text-label'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <fieldset>
          <legend className="t-label">What it was worth</legend>
          <ul className="mt-1.5 flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
                <Field
                  label={i === 0 ? 'Received on' : 'Checked on'}
                  type="date"
                  inputMode="none"
                  value={r.date}
                  onChange={(v) => setRow(i, { date: v })}
                  max={today}
                  width="w-full"
                  className="min-w-0"
                />
                <Field
                  label={i === 0 ? 'Worth then' : 'Worth'}
                  prefix="R"
                  value={r.value}
                  onChange={(v) => setRow(i, { value: v })}
                  placeholder="0"
                  width="w-full"
                  className="min-w-0"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}
                  aria-label={`Remove value ${i + 1}`}
                  className="press mb-0.5 flex h-8 w-8 items-center justify-center rounded-full text-label-3 hover:bg-fill hover:text-label disabled:opacity-30 max-md:mb-0 max-md:h-11 max-md:w-11"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addRow}
            className="press mt-2 flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-medium text-info hover:bg-fill max-md:min-h-11"
          >
            <Plus size={13} />
            {adding ? 'Add a later value' : 'Log what it is worth now'}
          </button>
          <p className="t-caption mt-1">
            Between two days it moves in a straight line, so a gain over a year is spread across its months. After the last it stays
            there; before the first you did not own it yet.
          </p>
        </fieldset>

        {loans.length > 0 && (
          <fieldset>
            <legend className="t-label">Loans against it</legend>
            <ul className="mt-1.5 flex flex-col">
              {loans.map((l) => (
                <li key={l.id} className="border-b last:border-0">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5 text-sm text-label-2">
                    <input type="checkbox" className="h-4 w-4 accent-info" checked={loanIds.includes(l.id)} onChange={() => toggleLoan(l.id)} />
                    <span className="min-w-0 flex-1 truncate text-label">{l.label}</span>
                    {loanOwed?.has(l.id) && <span className="num text-xs text-label-3">owe {formatCurrencyAbs(loanOwed.get(l.id))}</span>}
                  </label>
                </li>
              ))}
            </ul>
            <p className="t-caption mt-1.5">Already counted as debt; ticking one only shows how much of this is yours once it is paid.</p>
          </fieldset>
        )}
      </form>
    </Sheet>
  );
}
