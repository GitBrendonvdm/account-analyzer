import { TransactionTable } from './TransactionTable';
import { PaymentFinder } from './ledger/PaymentFinder';
import { RulesPanel } from './ledger/RulesPanel';
import { ProvidersPanel } from './ledger/ProvidersPanel';
import { DuplicatesPanel } from './ledger/DuplicatesPanel';
import { Disclosure } from './ui/Disclosure';

/**
 * The ledger: the table, and nothing in front of it that is not an answer.
 *
 * The duplicates panel sits above the table and only appears when it has something to report — it is
 * the one thing here that proposes REMOVING money, so it has to be met before the totals are read
 * rather than found underneath them. The finder, the providers and the rules are all forms; they are
 * folded under bars of their own (the finder above the table, because it is what you reach for with a
 * question already in mind and it answers without moving a figure; providers and rules below, because
 * they are how the ledger gets reshaped and you go looking for them after reading it). A draft rule or
 * provider opens its bar by itself, so "make this a rule" from the finder lands where the rule is.
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
    <div className="flex flex-col gap-3">
      <DuplicatesPanel
        rawData={rawData}
        overrides={txnOverrides}
        onSetTxnOverride={onSetTxnOverride}
      />
      {data && (
        <Disclosure title="Find a payment" summary="Search by shop, amount or date — nothing below moves while you look" merge>
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
        </Disclosure>
      )}
      <TransactionTable
        processed={processed}
        txnOverrides={txnOverrides}
        onSetTxnOverride={onSetTxnOverride}
        labelChoices={labelChoices}
        providers={providers}
      />
      {((data && onSetProviders) || (data && onSetRules)) && (
        <div className="mt-2 flex flex-col gap-1 border-t pt-2">
          {data && onSetProviders && (
            <Disclosure
              title={`Providers${providers?.length ? ` (${providers.length})` : ''}`}
              summary="Fold the branches of one shop onto one line"
              forceOpen={Boolean(providerDraft)}
              merge
            >
              <ProvidersPanel
                providers={providers}
                data={data}
                spend={spend}
                onChange={onSetProviders}
                draft={providerDraft}
                onDraft={onProviderDraft}
              />
            </Disclosure>
          )}
          {data && onSetRules && (
            <Disclosure
              title={`Rules${rules?.length ? ` (${rules.length})` : ''}`}
              summary="Put payments in the right category automatically"
              forceOpen={Boolean(ruleDraft)}
              merge
            >
              <RulesPanel
                rules={rules}
                data={data}
                choices={labelChoices}
                onChange={onSetRules}
                draft={ruleDraft}
                onDraft={onRuleDraft}
              />
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}
