import { useState } from 'react';
import { Car, Home, Package, Pencil, Plus } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { equityOf, kindLabel, movedSince, valueOn } from '../../lib/assets';
import { formatCurrencyAbs } from '../../utils/format';
import { AssetModal } from './AssetModal';
import { fmtIso } from './accountBits';

const ICON = { house: Home, car: Car, other: Package };

const ADD =
  'press flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-info hover:bg-fill max-md:min-h-11';

function Row({ asset, today, owedById, loanLabel, onEdit }) {
  const Icon = ICON[asset.kind] ?? Package;
  const value = valueOn(asset, today);
  const last = asset.valuations[asset.valuations.length - 1];
  const equity = equityOf(asset, today, owedById);
  const moved = movedSince(asset, today);
  const first = asset.valuations[0];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 last:border-0 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Icon size={18} className="shrink-0 text-label-3" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-label">{asset.name}</div>
          <div className="t-caption truncate">
            {`${kindLabel(asset.kind)} · received ${fmtIso(first.date)} ${first.date.slice(0, 4)}${
              asset.valuations.length > 1 ? ` · last valued ${fmtIso(last.date)} ${last.date.slice(0, 4)}` : ''
            }`}
          </div>
          {moved && (
            <div className={`t-caption truncate ${moved.change > 0 ? 'text-good' : 'text-bad'}`}>
              {`${moved.change > 0 ? 'Up' : 'Down'} ${formatCurrencyAbs(moved.change)} since ${fmtIso(moved.since)} ${moved.since.slice(0, 4)}`}
            </div>
          )}
          {equity && (
            <div className="t-caption truncate">
              {`${formatCurrencyAbs(equity.owed)} owed on it · `}
              <span className={equity.equity < 0 ? 'text-bad' : 'text-good'}>
                {`${equity.equity < 0 ? '−' : ''}${formatCurrencyAbs(equity.equity)} yours`}
              </span>
              {equity.unknown.length > 0 && ` · no balance for ${equity.unknown.map(loanLabel).join(', ')}`}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="num text-sm font-semibold text-label">{formatCurrencyAbs(value)}</span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${asset.name}`}
          className="press ml-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-label-2 hover:bg-fill hover:text-label max-md:min-h-11"
        >
          <Pencil size={13} />
          Edit
        </button>
      </div>
    </li>
  );
}

/**
 * What you own that no bank statement shows. A short list, one line each, with the total; adding and
 * changing happen in a dialog. Empty, it is one line that says why it is worth adding.
 */
export function AssetsCard({ assets, accounts, loanOwed, today, onSave }) {
  const [editing, setEditing] = useState(undefined); // undefined: closed · null: adding · id: editing
  const list = assets ?? [];
  const loans = (accounts ?? [])
    .filter((a) => !a.closedOn && !a.external && (a.typeOverride ?? a.type) === 'Loan')
    .map((a) => ({ id: a.id, label: accountLabel(a) }));
  const labelOf = (id) => loans.find((l) => l.id === id)?.label ?? id;
  const total = list.reduce((s, a) => s + (valueOn(a, today) ?? 0), 0);
  const current = typeof editing === 'string' ? list.find((a) => a.id === editing) : null;

  const upsert = (asset) => {
    const exists = list.some((a) => a.id === asset.id);
    onSave(exists ? list.map((a) => (a.id === asset.id ? asset : a)) : [...list, asset]);
  };

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6 md:py-5">
        <div>
          <h2 className="t-head">What you own</h2>
          <p className="t-caption mt-0.5">
            {list.length
              ? `${formatCurrencyAbs(total)} in ${list.length} thing${list.length === 1 ? '' : 's'}, counted in net worth.`
              : 'A house or a car is worth money your accounts do not show. Add one and net worth counts it.'}
          </p>
        </div>
        <button type="button" onClick={() => setEditing(null)} className={ADD}>
          <Plus size={14} />
          Add something
        </button>
      </div>
      {list.length > 0 && (
        <ul className="border-t">
          {list.map((a) => (
            <Row key={a.id} asset={a} today={today} owedById={loanOwed} loanLabel={labelOf} onEdit={() => setEditing(a.id)} />
          ))}
        </ul>
      )}
      {editing !== undefined && (editing === null || current) && (
        <AssetModal
          asset={current}
          loans={loans}
          loanOwed={loanOwed}
          today={today}
          onSave={upsert}
          onDelete={(id) => onSave(list.filter((a) => a.id !== id))}
          onDone={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
