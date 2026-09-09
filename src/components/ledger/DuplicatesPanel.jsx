import { useMemo } from 'react';
import { Copy, Undo2 } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import { findDuplicatePayments } from '../../lib/duplicatePayments';
import { DUPLICATE } from '../../lib/txnOverrides';

/**
 * Payments the file reports twice because the account they were paid to was renumbered.
 *
 * This is the only thing in the app that proposes REMOVING money rather than moving it, so it has
 * to argue its case on the row: both descriptions in full, and how many cycles the surviving
 * reference has behind it. "*6996, paid for 24 cycles" beside "*1106, first seen" is the whole
 * argument, and a reader can dismiss it in a glance if the app has guessed wrong.
 *
 * The panel only exists when there is something to say. It is not a permanent fixture of the
 * ledger, because on almost every file it has nothing to report — and a standing empty box that
 * says "no duplicates" invites the reader to wonder whether it is working.
 *
 * What was struck stays listed, with an undo. A correction that removes a payment from every total
 * in the app must be visible afterwards, or the numbers have quietly changed and nothing says why.
 */

const DAY = { day: 'numeric', month: 'short', year: '2-digit' };
const fmtDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-ZA', DAY) : (v ?? '');
};

export function DuplicatesPanel({ rawData, overrides = {}, onSetTxnOverride }) {
  // Read from the RAW rows: a struck duplicate is gone from `data`, and the panel that struck it
  // has to keep showing it or there is no way back.
  const found = useMemo(() => findDuplicatePayments(rawData), [rawData]);
  const struck = useMemo(
    () => (rawData ?? []).filter((t) => t.key && overrides?.[t.key]?.flag === DUPLICATE),
    [rawData, overrides],
  );
  const open = found.filter((d) => !overrides?.[d.drop.key]?.flag);
  if (!open.length && !struck.length) return null;

  const total = open.reduce((sum, d) => sum + Math.abs(d.amount), 0);
  const countOnce = (list) =>
    onSetTxnOverride?.(
      list.map((d) => d.drop.key).filter(Boolean),
      { flag: DUPLICATE },
    );

  return (
    <Card className="materialize p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHead
          title={open.length ? `Counted twice (${open.length})` : 'Counted twice'}
          subtitle={
            open.length
              ? `Renumber an account and the bank writes the same debit under both references for a cycle — one payment, two rows, ${formatCurrencyAbs(total)} counted that never left your account. Strike the copy and every total, average and forecast drops it at once.`
              : 'Nothing outstanding. What you struck is below, and can be put back.'
          }
        />
        {open.length > 1 && (
          <button
            type="button"
            onClick={() => countOnce(open)}
            className="press glass-chip flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] text-info hover:brightness-125 max-md:min-h-11"
          >
            <Copy size={13} /> Count all {open.length} once
          </button>
        )}
      </div>

      {open.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {open.map((d) => (
            <li key={d.drop.key} className="glass flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5">
              <span className="min-w-0 flex-grow">
                <span className="text-[13px] text-label">
                  {fmtDate(d.date)} ·{' '}
                  <b className="num font-semibold">{formatCurrencyAbs(d.amount)}</b> · {d.account}
                </span>
                <span className="t-caption block truncate">
                  <b className="font-semibold text-label-2">{d.keepRef}</b> paid for {d.keepCycles}{' '}
                  {d.keepCycles === 1 ? 'cycle' : 'cycles'} — {d.keep.Description}
                </span>
                <span className="t-caption block truncate">
                  <b className="font-semibold text-label-2">{d.dropRef}</b> first seen — {d.drop.Description}
                </span>
              </span>
              <button
                type="button"
                onClick={() => countOnce([d])}
                title={`Strike the ${d.dropRef} copy — it leaves every total in the app`}
                className="press glass-chip min-h-9 shrink-0 px-3 py-1.5 text-[12px] text-info hover:brightness-125 max-md:min-h-11"
              >
                Count once
              </button>
            </li>
          ))}
        </ul>
      )}

      {struck.length > 0 && (
        <ul className="mt-4 flex flex-col border-t pt-1">
          {struck.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 text-[13px] first:border-t-0">
              <span className="min-w-0 flex-grow truncate text-label-3 line-through">{t.Description}</span>
              <span className="num shrink-0 text-[12px] text-label-3">
                {fmtDate(t.Date)} · {formatCurrencyAbs(t.AmountNum)}
              </span>
              <button
                type="button"
                onClick={() => onSetTxnOverride?.([t.key], { flag: null })}
                aria-label={`Put ${t.Description} back`}
                className="press flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] text-label-4 hover:text-label max-md:min-h-11"
              >
                <Undo2 size={12} /> Put back
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
