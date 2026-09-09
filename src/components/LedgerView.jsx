import { TransactionTable } from './TransactionTable';
import { PaymentFinder } from './ledger/PaymentFinder';
import { RulesPanel } from './ledger/RulesPanel';
import { ProvidersPanel } from './ledger/ProvidersPanel';

/**
 * The ledger: find a payment, the table, then the two workshops that reshape it.
 *
 * ONLY THE FINDER SITS ABOVE THE TABLE, because it is the one thing you reach for with a question
 * already in mind ("where is that R4 000") and it answers without moving a figure — the totals below
 * never change when you search. Providers and rules are the opposite: they are how the ledger gets
 * reshaped, you go looking for them after reading it, and they are long. Above the table they push
 * the numbers off the first screen, which is the wrong thing for a page whose job is the numbers.
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
  providers,
  onSetProviders,
  providerDraft,
  onProviderDraft,
  spend,
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
          onCreateProvider={onProviderDraft}
        />
      )}
      <TransactionTable
        processed={processed}
        txnOverrides={txnOverrides}
        onSetTxnOverride={onSetTxnOverride}
        labelChoices={labelChoices}
        providers={providers}
      />
      {data && onSetProviders && (
        <ProvidersPanel
          providers={providers}
          data={data}
          spend={spend}
          onChange={onSetProviders}
          draft={providerDraft}
          onDraft={onProviderDraft}
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
    </div>
  );
}
