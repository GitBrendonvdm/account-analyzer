import { useState } from 'react';
import { Check } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { formatCurrency } from '../../utils/format';
import { Sheet } from '../ui/Sheet';

const PRIMARY =
  'press flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11 max-md:flex-1';
const SECONDARY =
  'glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label disabled:opacity-50 max-md:min-h-11 max-md:flex-1';

/**
 * Close one account: say the day it ended, see what closing records, confirm.
 *
 * Closing does three things the reader would otherwise have to find one at a time: the balance
 * becomes nothing from that day (the payment or withdrawal that gets it there is recorded on the
 * day it closed), the payments the app expected to it stop being expected, and a loan's estimate
 * stops being carried forward. History is untouched. When the app noticed the account had finished
 * it arrives with the day it ended and the reason; "still open" is how the reader says it was wrong.
 */
export function CloseAccountModal({ account, suggestion, today, preview, onClose, onDismiss, onDone }) {
  const [date, setDate] = useState(suggestion?.closedOn ?? today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const settlement = date ? preview(account.id, date) : null;
  const label = accountLabel(account);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e?.message || 'That did not go through. Try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Close ${label}`}
      subtitle="It ends at exactly nothing from the day you pick, and the app stops expecting payments to it. Your history stays."
      onClose={onDone}
      footer={
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !date}
            onClick={() => run(() => onClose([{ accountId: account.id, closedOn: date }]))}
            className={PRIMARY}
          >
            <Check size={15} />
            Close account
          </button>
          <button type="button" disabled={busy} onClick={onDone} className={SECONDARY}>
            Cancel
          </button>
          {suggestion && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => onDismiss([account.id]))}
              className="press text-[12.5px] text-label-3 hover:text-label disabled:opacity-50 max-md:min-h-11 max-md:w-full"
            >
              It's still open — don't ask again
            </button>
          )}
        </div>
      }
    >
      <div className="mt-4 flex flex-col gap-3">
        {suggestion && (
          <p className="text-sm text-warn">
            {suggestion.kind === 'paid-off' ? 'Looks paid off' : 'Looks closed'} — {suggestion.reason}.
          </p>
        )}
        <label className="flex flex-wrap items-center gap-3 text-sm text-label-2">
          Date it ended
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            aria-label={`Date ${label} ended`}
            className="rounded-full border bg-ground-lift px-3 py-1.5 text-[12.5px] text-label focus:border-info/30 focus:outline-none max-md:min-h-11"
          />
        </label>
        <p className="t-caption">
          {settlement
            ? `Closing records ${settlement.amount > 0 ? 'a payment of' : 'a withdrawal of'} ${formatCurrency(Math.abs(settlement.amount))} on ${date} so it ends at nothing.`
            : 'It holds nothing on that day, so closing records no transaction.'}
        </p>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </Sheet>
  );
}
