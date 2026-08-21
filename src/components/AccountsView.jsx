import { AccountMovementChart } from './charts/AccountMovementChart';
import { AccountPositionsTable } from './tables/AccountPositionsTable';
import { AccountsTable } from './tables/AccountsTable';
import { BalancesEditor } from './BalancesEditor';
import { CostOfDebtPanel } from './CostOfDebtPanel';

export function AccountsView({
  series,
  summaries,
  positions,
  months,
  currentMonth,
  dataThrough,
  accounts,
  onSaveAccount,
  costOfDebt,
}) {
  // A loan account showing a positive position is almost always a revolving or budget facility
  // whose draws are signed the other way. It matters before balances go in, because it inverts
  // net worth — so say it here rather than letting the number look like good news.
  const suspicious = positions.filter((p) => p.type === 'Loan' && p.positionByMonth[currentMonth] > 0);

  return (
    <div className="flex flex-col gap-5">
      <BalancesEditor
        accounts={accounts}
        onSave={onSaveAccount}
        typeOverrideHint={
          suspicious.length > 0
            ? `${suspicious.map((p) => p.account).join(', ')} moves like an asset, not a loan — its draws are signed the other way round. Worth checking the balance you enter, because it flips the sign of your net worth.`
            : null
        }
      />
      <AccountPositionsTable positions={positions} months={months} currentMonth={currentMonth} />
      <CostOfDebtPanel cost={costOfDebt} />
      <AccountsTable summaries={summaries} currentMonth={currentMonth} dataThrough={dataThrough} />
      <AccountMovementChart series={series} />
    </div>
  );
}
