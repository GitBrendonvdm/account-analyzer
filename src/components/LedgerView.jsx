import { TransactionTable } from './TransactionTable';
import { PaymentFinder } from './ledger/PaymentFinder';
import { RulesPanel } from './ledger/RulesPanel';

/**
 * The ledger: find a payment, the standing rules that correct payments in bulk, then the table.
 *
 * The finder and the rules panel sit ABOVE the table because they are how the table gets fixed, and
 * neither of them filters it — the totals below never move when you search. Both are folded to a
 * single line until used, so the page still opens on the numbers.
 */
export function LedgerView({
  processed,
  data,
  txnOverrides,
  onSetTxnOverride,
  labelChoices,
  rules,
  onSetRules,
  ruleDraft,
  onRuleDraft,
  exceptionKeys,
}) {
  return (
    <div className="flex flex-col gap-5">
      {data && (
        <PaymentFinder
          data={data}
          currentMonth={processed?.currentMonth}
          exceptionKeys={exceptionKeys}
          overrides={txnOverrides}
          choices={labelChoices}
          onSetTxnOverride={onSetTxnOverride}
          onCreateRule={onRuleDraft ? (seed) => onRuleDraft({ description: seed.description ?? '', minAmount: '', set: { category: '', flag: '' } }) : null}
        />
      )}
      {data && onSetRules && (
        <RulesPanel
          rules={rules}
          data={data}
          choices={labelChoices}
          onChange={onSetRules}
          draft={ruleDraft}
          onDraft={onRuleDraft}
        />
      )}
      <TransactionTable
        processed={processed}
        txnOverrides={txnOverrides}
        onSetTxnOverride={onSetTxnOverride}
        labelChoices={labelChoices}
      />
    </div>
  );
}
