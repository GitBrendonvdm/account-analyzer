import { AccountMovementChart } from './charts/AccountMovementChart';
import { AccountPositionsTable } from './tables/AccountPositionsTable';
import { AccountsTable } from './tables/AccountsTable';
import { AccountsList } from './accounts/AccountsList';
import { AssetsCard } from './accounts/AssetsCard';
import { CostOfDebtPanel } from './CostOfDebtPanel';
import { Card, CardHead } from './ui/Surface';
import { Disclosure } from './ui/Disclosure';
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
 * Accounts — the balance sheet, one list first.
 *
 * What each account holds is the page: one line per account, with net worth and which way it is
 * moving above it. Changing a balance, renaming, closing or hiding an account happens in a dialog
 * from its line (`manage`), so there is no form on the page. Everything that explains the numbers —
 * balances at each pay cycle, what the debt costs, cash in and out, account movement, the loans the
 * app is carrying forward — is folded under its own bar, closed until you want to see why.
 *
 * External records (from a statement upload) are listed and deletable under the list — nothing else
 * on this page can see them, since they have no rows.
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
  trend,
  assets,
  onSaveAssets,
  loanOwed,
  today,
}) {
  const list = positions ?? [];
  // A loan account showing a positive position is almost always a revolving or budget facility
  // whose draws are signed the other way. It matters before balances go in, because it inverts
  // net worth — so say it here rather than letting the number look like good news.
  const suspicious = list.filter((p) => p.type === 'Loan' && (p.positionByMonth?.[currentMonth] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3">
      {/* A closed account holds nothing and is listed (with its Reopen) under the list, so it is not
          a line to retype a balance on. */}
      <AccountsList
        accounts={(accounts ?? []).filter((a) => !a.closedOn)}
        onSave={onSaveAccount}
        onDeleteAccount={onDeleteAccount}
        dataThrough={dataThrough}
        manage={manage}
        trend={trend}
        typeOverrideHint={
          suspicious.length > 0
            ? `${suspicious.map((p) => p.account).join(', ')} moves like an asset, not a loan — its draws are signed the other way round. Worth checking the balance you enter, because it flips the sign of your net worth.`
            : null
        }
      />
      {onSaveAssets && today && (
        <AssetsCard assets={assets} accounts={accounts} loanOwed={loanOwed} today={today} onSave={onSaveAssets} />
      )}
      <div className="mt-2 flex flex-col gap-1 border-t pt-2">
        <Disclosure title="Balance at each pay cycle" summary="Every account, grouped by type, at the end of each cycle" merge>
          <AccountPositionsTable positions={list} months={months ?? []} currentMonth={currentMonth} />
        </Disclosure>
        <Disclosure title="What the debt costs" summary="Interest and fees charged, and which of it is avoidable" merge>
          <CostOfDebtPanel cost={costOfDebt} fees={fees} />
        </Disclosure>
        <Disclosure title="Cash in and out, by account" summary="This cycle against the typical cycle" merge>
          <AccountsTable summaries={summaries ?? []} currentMonth={currentMonth} dataThrough={dataThrough} />
        </Disclosure>
        <Disclosure title="Account movement" summary="How each account has moved over the range" merge>
          <AccountMovementChart series={series} />
        </Disclosure>
        {inferredLoans?.length > 0 && (
          <Disclosure title="Carried forward from your payments" summary="Loans you did not upload, estimated from what leaves your other accounts" merge>
            <EstimatedLoans loans={inferredLoans} />
          </Disclosure>
        )}
      </div>
    </div>
  );
}
