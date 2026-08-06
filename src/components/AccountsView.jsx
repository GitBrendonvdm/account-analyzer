import { AccountMovementChart } from './charts/AccountMovementChart';
import { AccountPositionsTable } from './tables/AccountPositionsTable';
import { AccountsTable } from './tables/AccountsTable';

export function AccountsView({ series, summaries, positions, months, currentMonth, dataThrough }) {
  return (
    <div className="space-y-6">
      <AccountPositionsTable positions={positions} months={months} currentMonth={currentMonth} />
      <AccountsTable summaries={summaries} currentMonth={currentMonth} dataThrough={dataThrough} />
      <AccountMovementChart series={series} />
    </div>
  );
}
