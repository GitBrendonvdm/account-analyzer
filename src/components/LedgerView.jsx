import { TransactionTable } from './TransactionTable';

export function LedgerView({ processed }) {
  return (
    <div className="flex flex-col gap-5">
      <TransactionTable processed={processed} />
    </div>
  );
}
