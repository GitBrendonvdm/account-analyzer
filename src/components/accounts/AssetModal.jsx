import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ASSET_KINDS, makeAsset, valueOn, withValuation } from '../../lib/assets';
import { formatCurrencyAbs } from '../../utils/format';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';
import { fmtIso, parseAmount } from './accountBits';

const PRIMARY =
  'press flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11 max-md:flex-1';
const SECONDARY =
  'glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label max-md:min-h-11 max-md:flex-1';
const TOUCH_FIELD =
  '[&_input:not([type=checkbox])]:min-h-11 [&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:min-w-0 [&_input:not([type=checkbox])]:text-base';

/**
 * Add what you own, or change what you said it is worth.
 *
 * Changing the worth does not overwrite the old figure: it adds a valuation on the day you give, so
 * net worth month by month shows the change in the month it happened. The loans ticked are the ones
 * taken out against it — they are already counted as debt, and ticking them only lets the list say
 * what is left of the asset once they are paid.
 */
export function AssetModal({ asset, loans, loanOwed, today, onSave, onDelete, onDone }) {
  const adding = !asset;
  const [name, setName] = useState(asset?.name ?? '');
  const [kind, setKind] = useState(asset?.kind ?? 'house');
  const [value, setValue] = useState(asset ? String(valueOn(asset, today) ?? '') : '');
  const [date, setDate] = useState(today);
  const [loanIds, setLoanIds] = useState(asset?.loanIds ?? []);
  const [confirming, setConfirming] = useState(false);

  const amount = parseAmount(value);
  const ready = name.trim() && amount != null;

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    const day = date && date <= today ? date : today;
    if (adding) {
      onSave(makeAsset({ name, kind, value: amount, date: day, loanIds }));
    } else {
      let next = { ...asset, name: name.trim(), kind, loanIds };
      if (amount !== valueOn(asset, day)) next = withValuation(next, { date: day, value: amount });
      onSave(next);
    }
    onDone();
  };

  const toggleLoan = (id) => setLoanIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Sheet
      title={adding ? 'Add something you own' : asset.name}
      subtitle={
        adding
          ? 'A house, a car — anything worth money that is not in a bank account. It counts towards net worth.'
          : 'Change what it is worth and net worth shows the change from that day.'
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Worth" prefix="R" value={value} onChange={setValue} placeholder="0" width="w-full" className="min-w-0" />
          <Field label="As of" type="date" inputMode="none" value={date} onChange={setDate} max={today} width="w-full" className="min-w-0" />
        </div>

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

        {!adding && asset.valuations.length > 1 && (
          <div>
            <span className="t-label">What it has been worth</span>
            <ul className="mt-1.5 flex flex-col text-sm text-label-2">
              {[...asset.valuations].reverse().map((v) => (
                <li key={v.date} className="flex justify-between gap-4 border-b py-1.5 last:border-0">
                  <span>{fmtIso(v.date)} {v.date.slice(0, 4)}</span>
                  <span className="num text-label">{formatCurrencyAbs(v.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Sheet>
  );
}
