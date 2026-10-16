import { useState } from 'react';
import { Check } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { formatCurrency } from '../../utils/format';
import { Card, CardHead } from '../ui/Surface';

/**
 * Paid off, closed, or still open?
 *
 * Nothing in a bank's data says a loan has been cleared: the history just stops, and the app keeps
 * expecting its instalment. So accounts that look finished are listed here for the reader to
 * confirm — each with why it looks that way and the day it ended, which can be changed — and the
 * ones already closed are listed under them, one click from being reopened.
 *
 * Confirming does three things the reader would otherwise have to find one at a time: the balance
 * becomes nothing from that day, the payments the app expected to it stop being expected, and the
 * loan's estimate stops being carried forward. History is untouched.
 */

const dayLabel = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function Suggestion({ s, picked, onToggle, date, onDate, today }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b py-2.5 last:border-0">
      <label className="flex min-w-0 cursor-pointer items-center gap-3 max-md:min-h-11">
        <input type="checkbox" className="h-4 w-4 accent-info" checked={picked} onChange={onToggle} />
        <div className="min-w-0">
          <div className="truncate text-sm text-label">{s.label}</div>
          <div className="t-caption truncate">
            {s.kind === 'paid-off' ? 'Looks paid off' : 'Looks closed'} — {s.reason}
          </div>
          {s.settlement !== 0 && (
            <div className="t-caption truncate">
              Closing records {s.settlement > 0 ? 'a payment of' : 'a withdrawal of'} {formatCurrency(Math.abs(s.settlement))} so it ends at
              nothing
            </div>
          )}
        </div>
      </label>
      <input
        type="date"
        value={date}
        max={today}
        onChange={(e) => e.target.value && onDate(e.target.value)}
        aria-label={`Date ${s.label} ended`}
        className="rounded-full border bg-ground-lift px-3 py-1.5 text-[12.5px] text-label focus:border-info/30 focus:outline-none max-md:min-h-11"
      />
    </li>
  );
}

/**
 * Close any account by hand. The suggestions only find what the data hints at; an account the reader
 * KNOWS is finished — a card paid off with a transfer from somewhere the app cannot see — is closed
 * from here, with the same effect: it ends at exactly nothing, and says what it recorded to get there.
 */
function CloseByHand({ openAccounts, preview, today, busy, onClose, run }) {
  const [id, setId] = useState('');
  const [date, setDate] = useState(today);
  if (!openAccounts?.length) return null;
  const settlement = id ? preview(id, date) : null;
  return (
    <div className="mt-5">
      <h3 className="t-label">Close another account</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={id}
          onChange={(e) => setId(e.target.value)}
          aria-label="Account to close"
          className="min-w-0 rounded-full border bg-ground-lift px-3 py-1.5 text-[12.5px] text-label focus:border-info/30 focus:outline-none max-md:min-h-11 max-md:flex-1"
        >
          <option value="">Choose an account…</option>
          {openAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a)}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Date it closed"
          className="rounded-full border bg-ground-lift px-3 py-1.5 text-[12.5px] text-label focus:border-info/30 focus:outline-none max-md:min-h-11"
        />
        <button
          type="button"
          disabled={busy || !id}
          onClick={() => run(async () => { await onClose([{ accountId: id, closedOn: date }]); setId(''); })}
          className="press flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11"
        >
          <Check size={15} />
          Close it
        </button>
      </div>
      {id && (
        <p className="t-caption mt-1.5">
          {settlement
            ? `Closing records ${settlement.amount > 0 ? 'a payment of' : 'a withdrawal of'} ${formatCurrency(Math.abs(settlement.amount))} on ${date} so it ends at nothing.`
            : 'It holds nothing on that day, so closing records no transaction.'}
        </p>
      )}
    </div>
  );
}

export function ClosedAccounts({ suggestions, closed, openAccounts, preview, onClose, onDismiss, onReopen, today }) {
  const [unticked, setUnticked] = useState(() => new Set());
  const [dates, setDates] = useState({});
  const [busy, setBusy] = useState(false);
  if (!suggestions.length && !closed.length && !openAccounts?.length) return null;

  const chosen = suggestions.filter((s) => !unticked.has(s.accountId));
  const dateOf = (s) => dates[s.accountId] ?? s.closedOn;

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <CardHead
        title="Paid off or closed?"
        subtitle="Confirm the ones that are finished. Each ends at exactly nothing — the payment (or withdrawal) that gets it there is recorded on the day it closed — and the app stops expecting payments to it. Your history stays."
      />
      {suggestions.length > 0 && (
        <>
          <ul className="mt-3">
            {suggestions.map((s) => (
              <Suggestion
                key={s.accountId}
                s={s}
                today={today}
                picked={!unticked.has(s.accountId)}
                onToggle={() =>
                  setUnticked((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.accountId)) next.delete(s.accountId);
                    else next.add(s.accountId);
                    return next;
                  })
                }
                date={dateOf(s)}
                onDate={(d) => setDates((prev) => ({ ...prev, [s.accountId]: d }))}
              />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || chosen.length === 0}
              onClick={() => run(() => onClose(chosen.map((s) => ({ accountId: s.accountId, closedOn: dateOf(s) }))))}
              className="press flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11 max-md:flex-1"
            >
              <Check size={15} />
              Mark {chosen.length} as closed
            </button>
            <button
              type="button"
              disabled={busy || unticked.size === 0}
              onClick={() => run(() => onDismiss([...unticked]))}
              className="glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label disabled:opacity-50 max-md:min-h-11 max-md:flex-1"
            >
              {unticked.size > 0 ? `${unticked.size} still open — don't ask again` : 'Untick any that are still open'}
            </button>
          </div>
        </>
      )}

      <CloseByHand openAccounts={openAccounts} preview={preview} today={today} busy={busy} onClose={onClose} run={run} />

      {closed.length > 0 && (
        <div className={suggestions.length ? 'mt-5' : 'mt-3'}>
          <h3 className="t-label">Closed</h3>
          <ul className="mt-1">
            {closed.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 border-b py-2 last:border-0">
                <span className="min-w-0 truncate text-sm text-label-2">
                  {accountLabel(a)} <span className="text-label-3">· ended {dayLabel(a.closedOn)}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onReopen(a.id))}
                  className="press text-[12.5px] text-label-3 hover:text-label disabled:opacity-50 max-md:min-h-11 max-md:px-3"
                >
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
