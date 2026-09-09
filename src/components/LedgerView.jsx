import { TransactionTable } from './TransactionTable';

export function LedgerView({ processed, txnOverrides, onSetTxnOverride, labelChoices }) {
  return (
    <div className="flex flex-col gap-5">
      <TransactionTable
        processed={processed}
        txnOverrides={txnOverrides}
        onSetTxnOverride={onSetTxnOverride}
        labelChoices={labelChoices}
      />
    </div>
  );
}
