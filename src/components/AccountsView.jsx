import { AccountMovementChart } from './charts/AccountMovementChart';
import { AccountPositionsTable } from './tables/AccountPositionsTable';
import { AccountsTable } from './tables/AccountsTable';
import { BalancesEditor } from './BalancesEditor';
import { CostOfDebtPanel } from './CostOfDebtPanel';
import { Card, CardHead } from './ui/Surface';
import { formatCurrency } from '../utils/format';

const dayLabel = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '';

/**
 * The loans whose books were not uploaded this time. Their balance is carried forward from what
 * the app can see — the payments leaving the cheque and card accounts — and the interest and fee
 * it has learned the loan charges, and it says so here rather than letting an estimate pass for a
 * statement. Uploading the loan's own file or typing its balance replaces the estimate at once.
 */
function EstimatedLoans({ loans }) {
  if (!loans?.length) return null;
  return (
    <Card className="p-5">
      <CardHead
        title="Carried forward from your payments"
        subtitle="These loans were not in what you uploaded. Their balance is last month's, less the payments the app can see leaving your other accounts, plus the interest and fee they usually charge."
      />
      <ul className="mt-3">
        {loans.map((l) => (
          <li key={l.accountId} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b py-2 last:border-0">
            <div className="min-w-0">
              <div className="truncate text-sm text-label">{l.label}</div>
              <div className="t-caption truncate">
                from {dayLabel(l.from)} to {dayLabel(l.through)} · {l.payments} payment{l.payments === 1 ? '' : 's'} matched ({l.matchedBy}) ·
                interest at {(l.rate * 100).toFixed(2)}%
              </div>
            </div>
            <div className="num shrink-0 text-sm text-label">owes {formatCurrency(l.owed)}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Accounts — the balance sheet: what you told the app each account holds (and when), the
 * positions by cycle, what the debt costs and which of that is avoidable, then the per-account
 * tables and movement.
 *
 * The balances editor leads because everything below it is re-based from those numbers; the fees
 * audit lives inside the cost panel because it is the same money read by kind. External records
 * (from a statement upload) are listed and deletable inside the editor — nothing else on this page
 * can see them, since they have no rows. Closing and hiding accounts live there too, as buttons on
 * each row (`manage`), rather than as cards of their own.
 */
export function AccountsView({
  series,
  summaries,
  positions,
  months,
  currentMonth,
  dataThrough,
  accounts,
  onSaveAccount,
  onDeleteAccount,
  costOfDebt,
  fees,
  inferredLoans,
  manage,
}) {
  const list = positions ?? [];
  // A loan account showing a positive position is almost always a revolving or budget facility
  // whose draws are signed the other way. It matters before balances go in, because it inverts
  // net worth — so say it here rather than letting the number look like good news.
  const suspicious = list.filter((p) => p.type === 'Loan' && (p.positionByMonth?.[currentMonth] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* A closed account holds nothing and is listed (with its Reopen) under the table, so it is not
          a row to type a balance into. */}
      <BalancesEditor
        accounts={(accounts ?? []).filter((a) => !a.closedOn)}
        onSave={onSaveAccount}
        onDeleteAccount={onDeleteAccount}
        dataThrough={dataThrough}
        manage={manage}
        typeOverrideHint={
          suspicious.length > 0
            ? `${suspicious.map((p) => p.account).join(', ')} moves like an asset, not a loan — its draws are signed the other way round. Worth checking the balance you enter, because it flips the sign of your net worth.`
            : null
        }
      />
      <EstimatedLoans loans={inferredLoans} />
      <AccountPositionsTable positions={list} months={months ?? []} currentMonth={currentMonth} />
      <CostOfDebtPanel cost={costOfDebt} fees={fees} />
      <AccountsTable summaries={summaries ?? []} currentMonth={currentMonth} dataThrough={dataThrough} />
      <AccountMovementChart series={series} />
    </div>
  );
}
