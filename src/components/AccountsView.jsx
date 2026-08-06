import { AccountMovementChart } from './charts/AccountMovementChart';
import { AccountsTable } from './tables/AccountsTable';

export function AccountsView({ series, summaries, currentMonth, dataThrough }) {
  return (
    <div className="space-y-6">
      <AccountsTable summaries={summaries} currentMonth={currentMonth} dataThrough={dataThrough} />
      <AccountMovementChart series={series} />
    </div>
  );
}
