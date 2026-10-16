import { useState } from 'react';
import { Eye } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { Sheet } from '../ui/Sheet';

const dayLabel = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function Row({ children, action, busy, onAction }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 border-b py-2 last:border-0">
      <span className="min-w-0 truncate text-sm text-label-2">{children}</span>
      <button
        type="button"
        disabled={busy}
        onClick={onAction}
        className="press flex items-center gap-1.5 text-[12.5px] text-label-3 hover:text-label disabled:opacity-50 max-md:min-h-11 max-md:px-3"
      >
        {action === 'Show' && <Eye size={13} />}
        {action}
      </button>
    </li>
  );
}

/**
 * The accounts that are put away: closed ones (each with Reopen) and hidden ones (each with Show).
 * Neither is deleted — reopening restores what the account said before it was closed, and showing a
 * hidden account puts it back exactly as it was.
 */
export function ShelvedAccounts({ closed, hidden, onReopen, onShow, onDone }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Closed and hidden accounts"
      subtitle="Nothing here is deleted. Reopen a closed account or show a hidden one and it comes back as it was."
      onClose={onDone}
    >
      <div className="mt-4 flex flex-col gap-5">
        {closed.length > 0 && (
          <div>
            <h3 className="t-label">Closed ({closed.length})</h3>
            <ul className="mt-1">
              {closed.map((a) => (
                <Row key={a.id} action="Reopen" busy={busy} onAction={() => run(() => onReopen(a.id))}>
                  {accountLabel(a)} <span className="text-label-3">· ended {dayLabel(a.closedOn)}</span>
                </Row>
              ))}
            </ul>
          </div>
        )}
        {hidden.length > 0 && (
          <div>
            <h3 className="t-label">Hidden ({hidden.length})</h3>
            <ul className="mt-1">
              {hidden.map((a) => (
                <Row key={a.id} action="Show" busy={busy} onAction={() => run(() => onShow(a.id))}>
                  {accountLabel(a)}
                  {a.closedOn && <span className="text-label-3"> · ended {dayLabel(a.closedOn)}</span>}
                </Row>
              ))}
            </ul>
          </div>
        )}
        {closed.length === 0 && hidden.length === 0 && <p className="t-caption">Nothing is closed or hidden.</p>}
      </div>
    </Sheet>
  );
}
