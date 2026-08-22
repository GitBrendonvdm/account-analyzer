import { useState } from 'react';
import { AlertTriangle, ArrowRight, CreditCard } from 'lucide-react';
import { Tile } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import { CARD_MINIMUM_FLOOR, CARD_MINIMUM_PCT_DEFAULT } from '../../constants';

/**
 * One tile per card: how full it is, what it demands this month, what it costs while it revolves.
 *
 * A card is not a loan — there is no instalment to infer and the interest depends on whether it is
 * paid in full — so it gets its own block rather than a half-empty loan row. The balance/limit bar
 * is the headroom read, the minimum is what the bank will take, and the cost line is the honest
 * one: the observed finance charges when there are any, the rate on the balance otherwise. The
 * "paid in full" toggle is local — it changes the sentence, not the record — and a card with no
 * numbers says which ones are missing instead of drawing an empty bar.
 */

const pct = (r, dp = 1) => (Number.isFinite(r) ? `${(r * 100).toFixed(dp)}%` : '—');
const PPI_RE = /cpp|protection|ppi|insurance|cover/i;

function missingNumbers(term, account) {
  const missing = [];
  if (!Number.isFinite(term.balanceOwed)) missing.push('balance');
  if (!Number.isFinite(account?.creditLimit ?? term.creditLimit)) missing.push('limit');
  if (term.rateSource === 'default') missing.push('rate');
  return missing;
}

function CardTile({ term, account, planEntry, onOpenAccounts }) {
  const [payInFull, setPayInFull] = useState(Boolean(term.payInFull));
  const missing = missingNumbers(term, account);
  const balance = term.balanceOwed;
  const limit = account?.creditLimit ?? term.creditLimit ?? null;
  const hasBalance = Number.isFinite(balance);
  const utilisation = hasBalance && Number.isFinite(limit) && limit > 0 ? balance / limit : null;
  const minimumNow = hasBalance
    ? Math.max(CARD_MINIMUM_FLOOR, ((term.minimumPct ?? CARD_MINIMUM_PCT_DEFAULT) / 100) * balance)
    : null;
  const finance12 = Number.isFinite(term.financeChargeMonthly)
    ? term.financeChargeMonthly * 12
    : hasBalance && Number.isFinite(term.rateNominal)
      ? balance * term.rateNominal
      : null;
  const ppi = (term.feeItems ?? []).filter((f) => PPI_RE.test(f.label ?? ''));
  const ppiMonthly = ppi.reduce((s, f) => s + (f.amount ?? 0), 0);
  const otherFees = Math.max(0, (term.feeMonthly ?? 0) - ppiMonthly);
  const utilisationTone = utilisation == null ? 'bg-fill-2' : utilisation > 0.9 ? 'bg-bad' : utilisation > 0.6 ? 'bg-warn' : 'bg-good';

  return (
    <Tile className="rise p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreditCard size={15} className="shrink-0 text-label-3" />
            <span className="truncate text-[14.5px] font-medium text-label">{term.label}</span>
          </div>
          <div className="t-caption mt-0.5">
            {pct(term.rateNominal, 2)}{' '}
            {term.rateSource === 'user'
              ? 'from you'
              : term.rateSource === 'default'
                ? 'assumed — type the rate to replace it'
                : 'inferred'}
          </div>
        </div>
        {hasBalance && (
          <div className="num shrink-0 text-right">
            <div className="text-[18px] font-semibold text-label">{formatCurrencyAbs(balance)}</div>
            <div className="t-caption">{Number.isFinite(limit) ? `of ${formatCurrencyAbs(limit)}` : 'no limit known'}</div>
          </div>
        )}
      </div>

      {!hasBalance ? (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[13.5px] text-warn">
            <AlertTriangle size={13} />
            {missing.length} number{missing.length === 1 ? '' : 's'} missing: {missing.join(', ')}
          </p>
          <p className="t-caption mt-1.5">
            Type the balance, limit and rate with the pencil in the table above, or upload your
            bank's account summary.
          </p>
          {onOpenAccounts && (
            <button
              type="button"
              onClick={onOpenAccounts}
              className="press mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-info hover:brightness-125"
            >
              Accounts
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4">
            <span className="block h-2 w-full overflow-hidden rounded-full bg-fill">
              <span
                className={`block h-full rounded-full ${utilisationTone}`}
                style={{ width: `${Math.min(100, Math.max(2, (utilisation ?? 0) * 100))}%`, transition: 'width 600ms var(--ease-out)' }}
              />
            </span>
            <div className="t-caption mt-1.5 flex justify-between">
              <span>{utilisation == null ? 'utilisation unknown — add the limit' : `${Math.round(utilisation * 100)}% of the limit`}</span>
              {planEntry?.clearedMonth != null && <span>clears in {planEntry.clearedMonth} months</span>}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13.5px]">
            <div>
              <dt className="t-label">Minimum this month</dt>
              <dd className="num mt-1 text-label">{formatCurrencyAbs(minimumNow)}</dd>
            </div>
            <div>
              <dt className="t-label">Typical repayment</dt>
              <dd className="num mt-1 text-label">
                {Number.isFinite(term.typicalRepayment) ? formatCurrencyAbs(term.typicalRepayment) : '—'}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-[13.5px] text-label-2">
            {payInFull
              ? `Costs nothing in interest while it is paid in full each month${otherFees > 0 ? `; the ${formatCurrencyAbs(otherFees)} a month in fees remains` : ''}.`
              : finance12 != null
                ? `Costing ${formatCurrencyAbs(finance12 / 12)} a month while it revolves — ${formatCurrencyAbs(finance12)} a year.`
                : 'Cost unknown until a rate is typed.'}
          </p>
          {ppiMonthly > 0 && (
            <p className="t-caption mt-1">
              Payment protection {formatCurrencyAbs(ppiMonthly)} a month — {formatCurrencyAbs(ppiMonthly * 12)} a year, optional cover.
            </p>
          )}
          {Number.isFinite(term.rateLowerBound) && (
            <p className="t-caption mt-1">
              The finance charges imply at least {pct(term.rateLowerBound)} on the balance you typed.
            </p>
          )}

          <button
            type="button"
            onClick={() => setPayInFull((v) => !v)}
            aria-pressed={payInFull}
            className={`press glass-chip mt-4 px-3.5 py-1.5 text-[12.5px] ${payInFull ? 'text-good' : 'text-label-2'}`}
          >
            {payInFull ? 'Paid in full each month' : 'Revolving'}
          </button>
        </>
      )}

      {term.assumptions?.length > 0 && (
        <ul className="t-caption mt-4 flex flex-col gap-0.5 border-t pt-3">
          {term.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

export function CardTiles({ terms = [], plan, accountsById = {}, onOpenAccounts }) {
  if (!terms.length) return null;
  return (
    <div>
      <h2 className="t-head px-1">Cards</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {terms.map((t) => (
          <CardTile
            key={t.accountId}
            term={t}
            account={accountsById[t.accountId]}
            planEntry={plan?.perDebt?.[t.accountId]}
            onOpenAccounts={onOpenAccounts}
          />
        ))}
      </div>
    </div>
  );
}
