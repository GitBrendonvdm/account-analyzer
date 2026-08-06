import { formatCurrency } from '../../utils/format';

const fmtDate = (d) => (d ? d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—');

function Num({ value, muted = false }) {
  const tone =
    value > 0.01 ? 'text-green-600' : value < -0.01 ? 'text-red-600' : 'text-slate-400';
  return <span className={`tabular-nums ${muted ? 'text-slate-500' : tone}`}>{formatCurrency(value)}</span>;
}

/**
 * Which account is doing the damage this cycle. Transfers are included — an account's movement
 * includes money moved to and from your other accounts.
 */
export function AccountsTable({ summaries, currentMonth, dataThrough }) {
  if (!summaries?.length) return null;

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4">
        <h2 className="text-lg font-semibold text-slate-800">Accounts</h2>
        <p className="text-xs text-slate-500">
          This cycle ({currentMonth}) against the typical cycle in range. Transfers included.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="p-3 font-medium">Account</th>
              <th className="p-3 text-right font-medium">In</th>
              <th className="p-3 text-right font-medium">Out</th>
              <th className="p-3 text-right font-medium">Net this cycle</th>
              <th className="p-3 text-right font-medium">Typical</th>
              <th className="p-3 text-right font-medium">Transactions</th>
              <th className="p-3 text-right font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((a) => {
              const stale = dataThrough && a.lastActivity && a.lastActivity < dataThrough;
              return (
                <tr key={a.account} className="border-t hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-700">{a.account}</td>
                  <td className="p-3 text-right">
                    <Num value={a.cycleIn} />
                  </td>
                  <td className="p-3 text-right">
                    <Num value={a.cycleOut} />
                  </td>
                  <td className="p-3 text-right font-semibold">
                    <Num value={a.cycleNet} />
                  </td>
                  <td className="p-3 text-right">
                    <Num value={a.typicalNet} muted />
                  </td>
                  <td className="p-3 text-right tabular-nums text-slate-500">{a.count}</td>
                  <td className={`p-3 text-right ${stale ? 'text-slate-400' : 'text-slate-600'}`}>
                    {fmtDate(a.lastActivity)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
