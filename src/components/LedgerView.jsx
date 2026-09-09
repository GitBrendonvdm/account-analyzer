import { TransactionTable } from './TransactionTable';
import { PaymentFinder } from './ledger/PaymentFinder';
import { RulesPanel } from './ledger/RulesPanel';
import { ProvidersPanel } from './ledger/ProvidersPanel';
import { DuplicatesPanel } from './ledger/DuplicatesPanel';

/**
 * The ledger: find a payment, anything counted twice, the table, then the two workshops.
 *
 * The duplicates panel sits above the table and only appears when it has something to report — it
 * is the one thing here that proposes REMOVING money, so it has to be met before the totals are
 * read rather than found underneath them.
 *
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
  rawData,
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
      <DuplicatesPanel
        rawData={rawData}
        overrides={txnOverrides}
        onSetTxnOverride={onSetTxnOverride}
      />
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
