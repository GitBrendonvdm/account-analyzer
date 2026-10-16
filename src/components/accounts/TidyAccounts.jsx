import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { Card, CardHead } from '../ui/Surface';

/**
 * Put accounts away, and bring them back.
 *
 * Three small things in one place: the accounts the app can see are finished with (nothing for over
 * a year, nothing held) offered for hiding in one click; a way to hide any other account by hand;
 * and the hidden ones, each with a Show. Hiding removes an account from every list, chart and total;
 * nothing is deleted and showing it again restores it exactly.
 */
export function TidyAccounts({ dormant, shown, hidden, onHide, onShow }) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  if (!dormant.length && !hidden.length && !shown.length) return null;

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
        title="Tidy up"
        subtitle="Hide accounts you don't want to see. They leave every list, chart and total; nothing is deleted, and you can show them again here."
      />

      {dormant.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-label-2">
            <b className="font-semibold text-label">{dormant.length}</b> account{dormant.length === 1 ? ' has' : 's have'} had no
            activity for over a year and {dormant.length === 1 ? 'holds' : 'hold'} nothing:
          </p>
          <p className="t-caption mt-1">{dormant.map(accountLabel).join(' · ')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onHide(dormant.map((a) => a.id)))}
            className="press mt-3 flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11 max-md:w-full"
          >
            <EyeOff size={15} />
            Hide {dormant.length === 1 ? 'it' : `these ${dormant.length}`}
          </button>
        </div>
      )}

      <div className={dormant.length ? 'mt-5' : 'mt-4'}>
        <h3 className="t-label">Hide another account</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label="Account to hide"
            className="min-w-0 rounded-full border bg-ground-lift px-3 py-1.5 text-[12.5px] text-label focus:border-info/30 focus:outline-none max-md:min-h-11 max-md:flex-1"
          >
            <option value="">Choose an account…</option>
            {shown.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !pick}
            onClick={() => run(async () => { await onHide([pick]); setPick(''); })}
            className="glass-chip press flex items-center gap-2 px-4 py-2 text-[13px] text-label-2 hover:text-label disabled:opacity-50 max-md:min-h-11"
          >
            <EyeOff size={14} />
            Hide
          </button>
        </div>
      </div>

      {hidden.length > 0 && (
        <div className="mt-5">
          <h3 className="t-label">Hidden ({hidden.length})</h3>
          <ul className="mt-1">
            {hidden.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 border-b py-2 last:border-0">
                <span className="min-w-0 truncate text-sm text-label-2">{accountLabel(a)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onShow(a.id))}
                  className="press flex items-center gap-1.5 text-[12.5px] text-label-3 hover:text-label disabled:opacity-50 max-md:min-h-11 max-md:px-3"
                >
                  <Eye size={13} />
                  Show
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
