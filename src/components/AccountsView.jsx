import { AccountMovementChart } from './charts/AccountMovementChart';
import { AccountPositionsTable } from './tables/AccountPositionsTable';
import { AccountsTable } from './tables/AccountsTable';
import { BalancesEditor } from './BalancesEditor';
import { CostOfDebtPanel } from './CostOfDebtPanel';

/**
 * Accounts — the balance sheet: what you told the app each account holds (and when), the
 * positions by cycle, what the debt costs and which of that is avoidable, then the per-account
 * tables and movement.
 *
 * The balances editor leads because everything below it is re-based from those numbers; the fees
 * audit lives inside the cost panel because it is the same money read by kind. External records
 * (from a statement upload) are listed and deletable inside the editor — nothing else on this page
 * can see them, since they have no rows.
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
}) {
  const list = positions ?? [];
  // A loan account showing a positive position is almost always a revolving or budget facility
  // whose draws are signed the other way. It matters before balances go in, because it inverts
  // net worth — so say it here rather than letting the number look like good news.
  const suspicious = list.filter((p) => p.type === 'Loan' && (p.positionByMonth?.[currentMonth] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-5">
      <BalancesEditor
        accounts={accounts ?? []}
        onSave={onSaveAccount}
        onDeleteAccount={onDeleteAccount}
        dataThrough={dataThrough}
        typeOverrideHint={
          suspicious.length > 0
            ? `${suspicious.map((p) => p.account).join(', ')} moves like an asset, not a loan — its draws are signed the other way round. Worth checking the balance you enter, because it flips the sign of your net worth.`
            : null
        }
      />
      <AccountPositionsTable positions={list} months={months ?? []} currentMonth={currentMonth} />
      <CostOfDebtPanel cost={costOfDebt} fees={fees} />
      <AccountsTable summaries={summaries ?? []} currentMonth={currentMonth} dataThrough={dataThrough} />
      <AccountMovementChart series={series} />
    </div>
  );
}
