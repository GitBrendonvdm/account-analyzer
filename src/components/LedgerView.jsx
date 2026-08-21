import { TransactionTable } from './TransactionTable';
import { AccountPositionsTable } from './tables/AccountPositionsTable';

/**
 * The Ledger: two grids over the same pay cycles.
 *
 * The transaction grid answers what the money was spent ON. The accounts grid answers where it
 * actually SAT — and the two disagree in ways worth seeing side by side: a cycle can look fine on
 * spend while the card balance underneath it climbs, because the spending was financed rather than
 * paid for. Same columns, same periods, so the eye can travel straight down.
 *
 * Loans are deliberately left out of the accounts grid here. A bond amortises on its own schedule
 * whatever you do, and putting it next to card spending invites a comparison that isn't meaningful;
 * the whole balance sheet lives on Accounts, where it is the point.
 */
const LEDGER_TYPES = ['Credit Card', 'Bank', 'Savings'];

export function LedgerView({ processed, positions }) {
  return (
    <div className="flex flex-col gap-5">
      <TransactionTable processed={processed} />
      <AccountPositionsTable
        positions={positions}
        months={processed.months}
        currentMonth={processed.currentMonth}
        types={LEDGER_TYPES}
        title="Accounts over the period"
        subtitle="Where the money sat, cycle by cycle. Cards first; higher is always better."
      />
    </div>
  );
}
