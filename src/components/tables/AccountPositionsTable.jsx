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
      <span className="inline-flex items-center gap-0.5 text-label-4">
        <Minus size={11} />
      </span>
    );
  }
  const better = value > 0;
  const Icon = better ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 tabular-nums ${better ? 'text-good' : 'text-bad'}`}
    >
      <Icon size={11} className="shrink-0" />
      {formatCurrency(Math.abs(value))}
    </span>
  );
}

/**
 * @param types restrict to these account types. The ledger shows only the accounts you actually
 *   transact on — a bond's amortisation schedule sitting next to card spending is a different
 *   subject, and belongs on the Accounts view where the whole balance sheet is the point.
 */
export function AccountPositionsTable({
  positions,
  months,
  currentMonth,
  types = ACCOUNT_TYPE_ORDER,
  title = 'Position by pay cycle',
  subtitle = 'Grouped by type, cards first. Higher is always better.',
}) {
  if (!positions?.length) return null;

  const byType = types
    .map((type) => ({ type, accounts: positions.filter((p) => p.type === type) }))
    .filter((g) => g.accounts.length > 0);
  if (byType.length === 0) return null;

  const groupTotal = (accounts, month) =>
    accounts.reduce((s, a) => s + (a.positionByMonth[month] ?? 0), 0);
  const groupOpening = (accounts) => accounts.reduce((s, a) => s + a.openingPosition, 0);
  const groupDelta = (accounts, month) =>
    accounts.reduce((s, a) => s + (a.deltaByMonth[month] ?? 0), 0);

  return (
    <div className="glass overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-6 py-5">
        <h2 className="t-head">{title}</h2>
        <p className="t-label">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky-head text-[11px] font-medium tracking-[0.06em] text-label-3 uppercase">
            <tr>
              <th className="border-b p-3 font-medium">Account</th>
              <th className="border-b p-3 text-right font-medium text-label-3" title="Where the account stood before the first cycle shown.">
                Start
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className={`border-b p-3 text-right font-medium ${
                    m === currentMonth ? 'border-l-2 border-l-hair-strong' : ''
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
                <tr className="bg-fill/70">
                  <td className="border-t p-2 pl-3 text-xs font-semibold tracking-wide text-label-2 uppercase">
                    {type}
                    <span className="ml-2 text-[10px] font-normal normal-case text-label-3">
                      {TYPE_BLURB[type] ?? ''}
                    </span>
                  </td>
                  <td className="border-t p-2 text-right text-xs font-semibold tabular-nums text-label-3">
                    {formatCurrency(groupOpening(accounts))}
                  </td>
                  {months.map((m) => (
                    <td
                      key={m}
                      className={`border-t p-2 text-right text-xs font-semibold tabular-nums text-label-2 ${
                        m === currentMonth ? 'border-l-2 border-l-hair-strong' : ''
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
                  <tr key={a.account} className="border-t hover:bg-fill">
                    <td className="p-3 pl-6 text-label-2">
                      <span className="font-medium">{a.short || a.account}</span>
                      {a.bank && <span className="ml-2 text-xs text-label-3">{a.bank}</span>}
                    </td>
                    <td className="p-3 text-right tabular-nums text-label-3">
                      {formatCurrency(a.openingPosition)}
                    </td>
                    {months.map((m) => (
                      <td
                        key={m}
                        className={`p-3 text-right ${
                          m === currentMonth ? 'border-l-2 border-l-hair-strong' : ''
                        }`}
                      >
                        <div className="tabular-nums text-label-2">
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
      <p className="border-t bg-fill px-4 py-2 text-xs text-label-2">
        The export has no balance column, so each line starts from zero at the beginning of the
        file — the level is arbitrary, but every month-to-month change is exact.
      </p>
    </div>
  );
}
