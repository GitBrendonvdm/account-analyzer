import { formatCurrencyAbs } from '../../utils/format';

/**
 * Where the bank's own charges go, account by account, with the four things worth saying.
 *
 * The cost-of-debt bars above this say how much each account costs; this says what kind of cost
 * it is, because the kinds have different fixes. Account fees are a phone call (or closing the
 * second current account, which the consolidation line prices); card interest is a balance to pay
 * down, not a fee to dispute; payment protection on a card is optional cover that can be
 * cancelled; transaction, ATM and penalty fees are the ones people assume are large and which the
 * audit shows are honestly small. Each callout is one sentence with the rand in it, so the reader
 * leaves knowing which of the four to act on.
 *
 * Interest and fees charged inside the loans are reported at the foot and never called avoidable:
 * they are the price of the loan, and the Debt view is where that gets cheaper.
 */

const KIND_ORDER = [
  'account',
  'transaction',
  'penalty',
  'atm',
  'crossBorder',
  'embeddedInsurance',
  'overdraftInterest',
  'cardInterest',
  'loanInterest',
  'loanInsurance',
  'otherFee',
];
const KIND_LABEL = {
  account: 'account fees',
  transaction: 'transaction fees',
  penalty: 'penalty fees',
  atm: 'ATM',
  crossBorder: 'cross-border',
  embeddedInsurance: 'payment protection',
  overdraftInterest: 'overdraft interest',
  cardInterest: 'card interest',
  loanInterest: 'loan interest',
  loanInsurance: 'loan insurance',
  otherFee: 'other fees',
  initiation: 'initiation fee',
};
const KIND_COLOUR = {
  account: 'var(--color-info)',
  transaction: 'var(--color-mint)',
  penalty: 'var(--color-pink)',
  atm: 'var(--color-deep)',
  crossBorder: '#8e8e93',
  embeddedInsurance: 'var(--color-warn)',
  overdraftInterest: '#ff6b5e',
  cardInterest: 'var(--color-bad)',
  loanInterest: 'rgba(255,69,58,0.55)',
  loanInsurance: 'rgba(255,159,10,0.55)',
  otherFee: 'rgba(235,235,245,0.3)',
};
const monthLabel = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : key ?? '';
};
const perYear = (v) => `${formatCurrencyAbs(v)}/yr`;

function AccountBar({ row, max }) {
  const parts = KIND_ORDER.map((kind) => ({ kind, value: row.kinds?.[kind]?.perYear ?? 0 })).filter((p) => p.value > 0);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return null;
  // Below `md` the bar drops to its own line under the name and figure, the same shape as the
  // cost-of-debt bars above it, because a 60px track cannot show a stacked bar's parts.
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,11rem)_1fr_auto]">
      <span className="truncate text-xs text-label-2" title={row.label}>
        {row.label}
      </span>
      <span
        className="flex h-2.5 overflow-hidden rounded-full bg-fill max-md:order-3 max-md:col-span-2"
        style={{ width: `${Math.max(2, (total / max) * 100)}%` }}
      >
        {parts.map((p) => (
          <span
            key={p.kind}
            className="block h-full"
            style={{ width: `${(p.value / total) * 100}%`, background: KIND_COLOUR[p.kind] }}
            title={`${KIND_LABEL[p.kind]}: ${perYear(p.value)}`}
          />
        ))}
      </span>
      <span className="num text-xs font-medium text-label-2">{perYear(total)}</span>
    </div>
  );
}

export function FeesAudit({ fees, className = '' }) {
  if (!fees) return null;
  const rows = (fees.byAccount ?? []).filter((r) => r.totalPerYear > 0).sort((a, b) => b.totalPerYear - a.totalPerYear);
  const max = Math.max(...rows.map((r) => r.totalPerYear), 1);
  const usedKinds = KIND_ORDER.filter((k) => rows.some((r) => (r.kinds?.[k]?.perYear ?? 0) > 0));
  const step = (fees.steps ?? []).find((s) => s.feeKind === 'account' || s.feeKind == null) ?? null;
  const sentences = fees.sentences ?? {};
  const card = fees.cardInterest;

  const accountFees =
    sentences.accountFees ??
    `Account fees ${perYear(fees.accountFeesPerYear ?? 0)}${step ? ` — the ${step.label} fee rose from ${formatCurrencyAbs(step.from)} to ${formatCurrencyAbs(step.to)} in ${monthLabel(step.cycle)}` : ''}`;
  const consolidation = fees.consolidation
    ? (sentences.consolidation ??
      `Consolidating to one current account: ${perYear(fees.consolidation.savingPerYear)} (close the ${fees.consolidation.closeCandidate}, keep the ${fees.consolidation.keepCandidate})`)
    : null;
  const cardInterest = card
    ? (sentences.cardInterest ?? `Card interest ${perYear(card.perYear ?? 0)} — charged in ${card.cyclesWithInterest ?? 0} of the last 6 cycles`)
    : null;
  const ppi = fees.ppi
    ? (sentences.ppi ?? `Payment protection on the ${(fees.ppi.accounts ?? []).join(' and ') || 'card'}: ${perYear(fees.ppi.perYear)}, optional cover`)
    : null;
  const avoidable = sentences.avoidable ?? `Transaction, ATM and penalty fees: ${perYear(fees.avoidablePerYear ?? 0)}.`;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="t-sub">Fees, by kind</h3>
        <span className="t-caption">
          run rate over the last {fees.cycles?.length ?? 6} complete cycles · {perYear(fees.totalPerYear ?? 0)} in total
        </span>
      </div>

      {rows.length > 0 ? (
        <div className="mt-4 space-y-2 max-md:space-y-3">
          {rows.map((r) => (
            <AccountBar key={r.accountId ?? r.label} row={r} max={max} />
          ))}
        </div>
      ) : (
        <p className="t-caption mt-3">No bank charges found in the last complete cycles.</p>
      )}

      {usedKinds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-label-3">
          {usedKinds.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="block h-2 w-2 rounded-sm" style={{ background: KIND_COLOUR[k] }} />
              {KIND_LABEL[k]}
              <span className="num text-label-4">{perYear(fees.byKind?.[k]?.perYear ?? 0)}</span>
            </span>
          ))}
        </div>
      )}

      <ul className="mt-4 flex flex-col gap-2 border-t pt-4 text-[13.5px] text-label-2">
        <li>{accountFees}</li>
        {consolidation && <li className="text-good">{consolidation}</li>}
        {cardInterest && <li className="text-bad">{cardInterest}</li>}
        {ppi && <li className="text-warn">{ppi}</li>}
        <li>{avoidable}</li>
        {fees.overdraftInterestPerYear > 0 && <li>Overdraft interest {perYear(fees.overdraftInterestPerYear)}.</li>}
        {fees.loanCostPerYear > 0 && (
          <li className="text-label-3">
            Interest and fees inside the loans: {perYear(fees.loanCostPerYear)} — the price of the loans, not avoidable; see Debt.
          </li>
        )}
      </ul>
      {fees.assumptions?.length > 0 && <p className="t-caption mt-3">{fees.assumptions.join(' ')}</p>}
    </div>
  );
}
