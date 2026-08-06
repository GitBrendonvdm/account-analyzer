import { Fragment } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatCurrency } from '../../utils/format';
import { ACCOUNT_TYPE_ORDER } from '../../lib/accounts';

/**
 * Position per pay cycle, grouped by account type with cards first.
 *
 * The point of this view: loans amortise down every month whatever you do, so a rising total can
 * hide card debt growing underneath it. Grouping by type and totalling each group separately makes
 * that visible instead of averaging it away.
 *
 * Direction is uniform — higher is better. More negative on a card is more debt; less negative on a
 * loan is debt repaid.
 */

const TYPE_BLURB = {
  'Credit Card': 'Higher is better — a falling line is debt growing',
  Loan: 'Higher is better — a rising line is the loan being paid down',
  Bank: 'Higher is better — cash on hand',
  Savings: 'Higher is better — cash on hand',
};

function Delta({ value }) {
  if (Math.abs(value) < 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-slate-300">
        <Minus size={11} />
      </span>
    );
  }
  const better = value > 0;
  const Icon = better ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 tabular-nums ${better ? 'text-green-600' : 'text-red-600'}`}
    >
      <Icon size={11} className="shrink-0" />
      {formatCurrency(Math.abs(value))}
    </span>
  );
}

export function AccountPositionsTable({ positions, months, currentMonth }) {
  if (!positions?.length) return null;

  const byType = ACCOUNT_TYPE_ORDER.map((type) => ({
    type,
    accounts: positions.filter((p) => p.type === type),
  })).filter((g) => g.accounts.length > 0);

  const groupTotal = (accounts, month) =>
    accounts.reduce((s, a) => s + (a.positionByMonth[month] ?? 0), 0);
  const groupOpening = (accounts) => accounts.reduce((s, a) => s + a.openingPosition, 0);
  const groupDelta = (accounts, month) =>
    accounts.reduce((s, a) => s + (a.deltaByMonth[month] ?? 0), 0);

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4">
        <h2 className="text-lg font-semibold text-slate-800">Position by pay cycle</h2>
        <p className="text-xs text-slate-500">
          Grouped by type, cards first. Higher is always better.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="border-b p-3 font-medium">Account</th>
              <th className="border-b p-3 text-right font-medium text-slate-400" title="Where the account stood before the first cycle shown.">
                Start
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className={`border-b p-3 text-right font-medium ${
                    m === currentMonth ? 'border-l-2 border-l-slate-300' : ''
                  }`}
                >
                  {m === currentMonth ? 'Now' : m}
                </th>
              ))}
              <th className="border-b p-3 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {byType.map(({ type, accounts }) => (
              <Fragment key={type}>
                <tr className="bg-slate-100/70">
                  <td className="border-t p-2 pl-3 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                    {type}
                    <span className="ml-2 text-[10px] font-normal normal-case text-slate-400">
                      {TYPE_BLURB[type] ?? ''}
                    </span>
                  </td>
                  <td className="border-t p-2 text-right text-xs font-semibold tabular-nums text-slate-400">
                    {formatCurrency(groupOpening(accounts))}
                  </td>
                  {months.map((m) => (
                    <td
                      key={m}
                      className={`border-t p-2 text-right text-xs font-semibold tabular-nums text-slate-700 ${
                        m === currentMonth ? 'border-l-2 border-l-slate-300' : ''
                      }`}
                    >
                      {formatCurrency(groupTotal(accounts, m))}
                    </td>
                  ))}
                  <td className="border-t p-2 text-right text-xs font-semibold">
                    <Delta value={months.reduce((s, m) => s + groupDelta(accounts, m), 0)} />
                  </td>
                </tr>
                {accounts.map((a) => (
                  <tr key={a.account} className="border-t hover:bg-slate-50">
                    <td className="p-3 pl-6 text-slate-700">
                      <span className="font-medium">{a.short || a.account}</span>
                      {a.bank && <span className="ml-2 text-xs text-slate-400">{a.bank}</span>}
                    </td>
                    <td className="p-3 text-right tabular-nums text-slate-400">
                      {formatCurrency(a.openingPosition)}
                    </td>
                    {months.map((m) => (
                      <td
                        key={m}
                        className={`p-3 text-right ${
                          m === currentMonth ? 'border-l-2 border-l-slate-300' : ''
                        }`}
                      >
                        <div className="tabular-nums text-slate-700">
                          {a.positionByMonth[m] == null ? '–' : formatCurrency(a.positionByMonth[m])}
                        </div>
                        <div className="text-[11px]">
                          <Delta value={a.deltaByMonth[m] ?? 0} />
                        </div>
                      </td>
                    ))}
                    <td className="p-3 text-right font-semibold">
                      <Delta value={a.windowChange} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t bg-slate-50 px-4 py-2 text-xs text-slate-500">
        The export has no balance column, so each line starts from zero at the beginning of the
        file — the level is arbitrary, but every month-to-month change is exact.
      </p>
    </div>
  );
}
