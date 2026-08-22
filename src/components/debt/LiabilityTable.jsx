import { useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, Pencil } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';
import { LiabilityTermsEditor } from './LiabilityTermsEditor';
import { CARD_MINIMUM_FLOOR, CARD_MINIMUM_PCT_DEFAULT } from '../../constants';

/**
 * Every liability on one line, with where each number came from.
 *
 * The rate, the balance, the instalment and the fees are all either read off the ledger, fitted,
 * typed, or assumed — and a plan built on an assumed 20.75% deserves to say so next to the figure,
 * not in a footnote. So every cell that rests on provenance carries a chip (ledger / statement /
 * typed / fitted / assumed) and a confidence dot, and a card with nothing to go on says which
 * numbers are missing rather than showing zeros. The pencil opens the terms editor in place, so
 * the typed value and the inferred one sit side by side while it is being typed.
 */

const DAY_MONTH = { day: 'numeric', month: 'short' };
const MONTH_YEAR = { month: 'short', year: 'numeric' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const valid = (d) => d && !Number.isNaN(d.getTime());
const fmtDayMonth = (d) => (valid(toDate(d)) ? toDate(d).toLocaleDateString('en-ZA', DAY_MONTH) : null);
const fmtMonthYear = (d) => (valid(toDate(d)) ? toDate(d).toLocaleDateString('en-ZA', MONTH_YEAR) : '—');
const pct = (r, dp = 2) => (Number.isFinite(r) ? `${(r * 100).toFixed(dp)}%` : '—');
const ordinal = (n) => {
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const addMonths = (d, n) => {
  const x = toDate(d);
  if (!valid(x) || !Number.isFinite(n)) return null;
  const out = new Date(x);
  out.setMonth(out.getMonth() + Math.round(n));
  return out;
};

const isCard = (t) => t?.type === 'Credit Card' || t?.kind === 'card';

const CONFIDENCE = {
  high: { tone: 'bg-good', title: 'High confidence' },
  medium: { tone: 'bg-warn', title: 'Medium confidence' },
  low: { tone: 'bg-bad', title: 'Low confidence' },
};

function bankOf(term, account) {
  if (account?.bank) return account.bank;
  const first = String(term.label ?? '').split(' ')[0];
  return first || 'bank';
}

function balanceProvenance(term, account) {
  const asOf = fmtDayMonth(term.balanceAsOf ?? account?.balanceAsOf);
  switch (term.balanceSource) {
    case 'ledger':
      return "from the loan's own ledger";
    case 'statement':
      return `from your ${bankOf(term, account)} summary${asOf ? `, ${asOf}` : ''}`;
    case 'user':
      return `typed${asOf ? ` ${asOf}` : ''}`;
    case 'regression': {
      const r2 = term.r2 ?? term.regressionR2;
      return Number.isFinite(r2) ? `fitted, R² ${r2.toFixed(2)}` : 'fitted from the interest postings';
    }
    default:
      return null;
  }
}

function rateProvenance(term) {
  switch (term.rateSource) {
    case 'user':
      return 'from you';
    case 'inferred':
      return `inferred from ${term.postings ?? 0} posting${term.postings === 1 ? '' : 's'}`;
    case 'regression': {
      const r2 = term.r2 ?? term.regressionR2;
      return Number.isFinite(r2) ? `fitted, R² ${r2.toFixed(2)}` : 'fitted from the interest postings';
    }
    default:
      return 'assumed — type the rate to replace it';
  }
}

/** The rate the ledger says, for showing beside a typed one. */
function inferredRate(term) {
  const rates = (term.rateHistory ?? []).slice(-3).map((h) => h.rate);
  return median(rates);
}

function monthlyInterest(term) {
  if (Number.isFinite(term.accruedThisCycle)) return term.accruedThisCycle;
  if (isCard(term) && Number.isFinite(term.financeChargeMonthly)) return term.financeChargeMonthly;
  if (Number.isFinite(term.balanceOwed) && Number.isFinite(term.rateNominal)) {
    return (term.balanceOwed * term.rateNominal) / 12;
  }
  return 0;
}

function missingNumbers(term, account) {
  const missing = [];
  if (!Number.isFinite(term.balanceOwed)) missing.push('balance');
  if (isCard(term) && !Number.isFinite(account?.creditLimit ?? term.creditLimit)) missing.push('limit');
  if (term.rateSource === 'default') missing.push('rate');
  return missing;
}

function Chip({ children, tone = 'text-label-2' }) {
  return (
    <span className={`inline-block rounded bg-fill px-1.5 py-0.5 text-[10.5px] leading-tight ${tone}`}>
      {children}
    </span>
  );
}

function Dot({ confidence }) {
  const c = CONFIDENCE[confidence] ?? CONFIDENCE.low;
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${c.tone}`}
      title={c.title}
      aria-label={c.title}
    />
  );
}

function Row({ term, account, primeRate, open, onToggle, neverClearsNote, payingLabel }) {
  const card = isCard(term);
  const missing = card ? missingNumbers(term, account) : [];
  const noBalance = !Number.isFinite(term.balanceOwed);
  const provenance = balanceProvenance(term, account);
  const inferred = term.rateSource === 'user' ? inferredRate(term) : null;
  const remaining =
    term.neverClears || term.remainingMonths === Infinity
      ? null
      : Number.isFinite(term.remainingMonths)
        ? Math.ceil(term.remainingMonths)
        : null;
  const clearsBy = remaining != null ? addMonths(term.nextPostingDate ?? term.lastPostingDate, remaining) : null;
  const minimumNow =
    card && Number.isFinite(term.balanceOwed)
      ? Math.max(CARD_MINIMUM_FLOOR, ((term.minimumPct ?? CARD_MINIMUM_PCT_DEFAULT) / 100) * term.balanceOwed)
      : null;

  return (
    <>
      <tr className={`border-t ${open ? 'bg-fill' : ''}`}>
        <td className="px-6 py-3 align-top">
          <div className="flex items-center gap-2">
            <Dot confidence={term.confidence} />
            <span className="text-[14.5px] font-medium text-label">{term.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Chip>{term.kind ?? (card ? 'card' : 'loan')}</Chip>
            {term.external && <Chip>not in the export</Chip>}
            {term.rateVariable && <Chip tone="text-warn">variable</Chip>}
          </div>
        </td>

        {card && missing.length > 0 && noBalance ? (
          <td className="px-4 py-3 align-top" colSpan={2}>
            <div className="flex items-center gap-1.5 text-[13px] text-warn">
              <AlertTriangle size={13} />
              {missing.length} number{missing.length === 1 ? '' : 's'} missing: {missing.join(', ')}
            </div>
            <p className="t-caption mt-1">
              Type them with the pencil, or upload your bank's summary under Accounts.
            </p>
          </td>
        ) : (
          <>
            <td className="num px-4 py-3 text-right align-top">
              <div className="text-[14.5px] font-semibold text-label">
                {noBalance ? '—' : formatCurrencyAbs(term.balanceOwed)}
              </div>
              <div className="mt-1">
                {provenance ? <Chip>{provenance}</Chip> : <Chip tone="text-warn">no balance — type one</Chip>}
              </div>
            </td>
            <td className="num px-4 py-3 text-right align-top">
              <div className="text-[14.5px] text-label">
                {pct(term.rateNominal)}
                <span className="ml-1 text-[11px] text-label-3">{term.rateVariable ? 'variable' : 'fixed'}</span>
              </div>
              <div className="t-caption mt-0.5">
                {Number.isFinite(term.margin) && primeRate != null
                  ? `prime ${term.margin >= 0 ? '+' : '−'} ${Math.abs(term.margin * 100).toFixed(2)}`
                  : Number.isFinite(term.rateEffective)
                    ? `${pct(term.rateEffective)} effective`
                    : null}
              </div>
              <div className="mt-1 flex flex-wrap justify-end gap-1">
                <Chip tone={term.rateSource === 'default' ? 'text-warn' : 'text-label-2'}>
                  {rateProvenance(term)}
                </Chip>
                {inferred != null && <Chip>inferred {pct(inferred)}</Chip>}
                {card && Number.isFinite(term.rateLowerBound) && (
                  <Chip>at least {pct(term.rateLowerBound, 1)} implied</Chip>
                )}
              </div>
            </td>
          </>
        )}

        <td className="num px-4 py-3 text-right align-top">
          {card ? (
            <>
              <div className="text-[14.5px] text-label">
                {Number.isFinite(term.typicalRepayment) ? formatCurrencyAbs(term.typicalRepayment) : '—'}
              </div>
              <div className="t-caption mt-0.5">
                {Number.isFinite(term.typicalRepayment) ? 'typical repayment' : 'no repayments seen'}
                {Number.isFinite(term.repaymentDay) && ` · around the ${ordinal(term.repaymentDay)}`}
                {minimumNow != null && ` · minimum ${formatCurrencyAbs(minimumNow)}`}
              </div>
            </>
          ) : (
            <>
              <div className="text-[14.5px] text-label">
                {Number.isFinite(term.instalment) ? formatCurrencyAbs(term.instalment) : '—'}
              </div>
              <div className="t-caption mt-0.5">
                {Number.isFinite(term.instalmentDay) && `on the ${ordinal(term.instalmentDay)}`}
                {payingLabel && ` · from ${payingLabel}`}
              </div>
              {(term.instalmentChanged || term.instalmentSource === 'latest') && (
                <div className="mt-1">
                  <Chip tone="text-warn">
                    {term.instalmentChanged ? 'changed recently' : 'latest credit only'}
                  </Chip>
                </div>
              )}
            </>
          )}
        </td>

        <td className="num px-4 py-3 text-right align-top">
          <div className="text-[14.5px] text-label">
            {Number.isFinite(term.feeMonthly) ? formatCurrencyAbs(term.feeMonthly) : '—'}
          </div>
          <div className="t-caption mt-0.5 max-w-[16ch] truncate">
            {(term.feeItems ?? [])
              .slice(0, 2)
              .map((f) => f.label)
              .join(', ')}
            {term.feeSource === 'user' && ' · from you'}
          </div>
        </td>

        <td className="num px-4 py-3 text-right align-top">
          <div className={`text-[14.5px] ${term.neverClears ? 'text-bad' : 'text-label'}`}>
            {term.neverClears || term.remainingMonths === Infinity
              ? 'never'
              : remaining != null
                ? `${remaining} mo`
                : '—'}
          </div>
          <div className="t-caption mt-0.5">
            {term.termSource === 'user' ? 'from you' : 'at today’s rate'}
            {clearsBy && ` · ${fmtMonthYear(clearsBy)}`}
          </div>
        </td>

        <td className="num px-4 py-3 text-right align-top">
          <div className="text-[14.5px] text-label">{pct(term.feeAdjustedRate)}</div>
          <div className="t-caption mt-0.5">with fees</div>
        </td>

        <td className="px-3 py-3 text-right align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Close' : 'Edit'} terms for ${term.label}`}
            className="press rounded-full p-2 text-label-3 hover:bg-fill hover:text-label"
          >
            {open ? <ChevronDown size={15} /> : <Pencil size={15} />}
          </button>
        </td>
      </tr>

      {(term.warnings?.length > 0 || neverClearsNote) && (
        <tr>
          <td colSpan={8} className="px-6 pb-3">
            {neverClearsNote && (
              <p className="flex items-start gap-1.5 text-[13px] text-bad">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {neverClearsNote}
              </p>
            )}
            {term.warnings?.map((w) => (
              <p key={w} className="text-[12.5px] text-warn">
                {w}
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function neverClearsSentence(term, planEntry) {
  const never = term.neverClears || planEntry != null;
  if (!never) return null;
  const interest = monthlyInterest(term);
  const scheduled = Number.isFinite(term.instalment) ? term.instalment : (term.typicalRepayment ?? 0);
  const covers = Math.max(0, scheduled - (term.feeMonthly ?? 0));
  const needs = planEntry?.minimumToClear ?? term.minimumToClear ?? Math.ceil(interest + (term.feeMonthly ?? 0) + 1);
  return `At today's instalment the ${term.label} never clears: it covers ${formatCurrencyAbs(covers)} of ${formatCurrencyAbs(interest)} interest. It needs at least ${formatCurrencyAbs(needs)} a month.`;
}

/** `rateSteps` may arrive flat (with `accountId` or `id`) or keyed by account; read both. */
function flattenRateSteps(rateSteps, termsById) {
  if (!rateSteps) return [];
  const flat = Array.isArray(rateSteps)
    ? rateSteps.map((s) => ({ ...s, accountId: s.accountId ?? (termsById[s.id] ? s.id : null) }))
    : Object.entries(rateSteps).flatMap(([accountId, steps]) =>
        (steps ?? []).map((s) => ({ ...s, accountId })),
      );
  return flat.filter((s) => s.accountId && termsById[s.accountId]);
}

function rateStepSentence(step, term) {
  const when = fmtMonthYear(step.date);
  const months = Number.isFinite(term.remainingMonths) ? Math.ceil(term.remainingMonths) : null;
  const termClause = months != null ? `; at the unchanged instalment the term is now ${months} months` : '';
  if (step.kind === 'instalmentRecast') {
    const to = Number.isFinite(step.to) ? (step.to < 1 ? pct(step.to) : formatCurrencyAbs(step.to)) : null;
    return `Your ${term.label} instalment was recast${to ? ` to ${to}` : ''} in ${when}; the rate held.`;
  }
  const to = Number.isFinite(step.to) ? pct(step.to) : pct(term.rateNominal);
  return `Your ${term.label} rate moved to ${to} in ${when}${termClause}.`;
}

export function LiabilityTable({
  terms,
  plan,
  primeRate,
  accountsById = {},
  rateSteps,
  onPatchAccount,
  onOpenAccounts,
  asOf,
}) {
  const [openId, setOpenId] = useState(null);
  const list = terms ?? [];

  if (!list.length) {
    return (
      <Card className="materialize p-7 sm:p-8">
        <CardHead
          title="Your debts"
          subtitle="No loan or credit card accounts yet. Import an export that has one, or upload your bank's account summary under Accounts."
        />
      </Card>
    );
  }

  const termsById = Object.fromEntries(list.map((t) => [t.accountId, t]));
  const neverByPlan = Object.fromEntries((plan?.neverClears ?? []).map((n) => [n.id, n]));
  const interest = list.reduce((s, t) => s + monthlyInterest(t), 0);
  const fees = list.reduce((s, t) => s + (Number.isFinite(t.feeMonthly) ? t.feeMonthly : 0), 0);
  const cardsMissing = list.filter((t) => isCard(t) && missingNumbers(t, accountsById[t.accountId]).length > 0);
  const steps = flattenRateSteps(rateSteps, termsById);
  const assumptions = [...new Set(list.flatMap((t) => t.assumptions ?? []))];

  return (
    <Card className="materialize overflow-hidden">
      <div className="border-b px-6 py-5">
        <CardHead
          title="Your debts"
          subtitle="What is owed, at what rate, and what each one costs a month. A typed value always wins; the inferred one is shown beside it."
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase">
              <th className="px-6 py-2.5">Debt</th>
              <th className="px-4 py-2.5 text-right">Owed</th>
              <th className="px-4 py-2.5 text-right">Rate</th>
              <th className="px-4 py-2.5 text-right">Instalment</th>
              <th className="px-4 py-2.5 text-right">Fees / month</th>
              <th className="px-4 py-2.5 text-right">Months left</th>
              <th className="px-4 py-2.5 text-right">Fee-adjusted</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const account = accountsById[t.accountId];
              const paying = t.payingAccountId ? accountsById[t.payingAccountId] : null;
              const payingLabel = paying?.label ?? paying?.rawName ?? t.payingCategory ?? null;
              const open = openId === t.accountId;
              return (
                <Row
                  key={t.accountId}
                  term={t}
                  account={account}
                  primeRate={primeRate}
                  open={open}
                  onToggle={() => setOpenId(open ? null : t.accountId)}
                  neverClearsNote={neverClearsSentence(t, neverByPlan[t.accountId])}
                  payingLabel={payingLabel}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && termsById[openId] && (
        <div className="border-t bg-fill px-6 py-5">
          <LiabilityTermsEditor
            term={termsById[openId]}
            account={accountsById[openId]}
            onPatchAccount={onPatchAccount}
            asOf={asOf}
            onClose={() => setOpenId(null)}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 border-t px-6 py-5">
        <p className="text-[14.5px] text-label">
          Your debt costs <b className="num font-semibold">{formatCurrencyAbs(interest + fees)}</b> a cycle:{' '}
          <span className="num">{formatCurrencyAbs(interest)}</span> interest,{' '}
          <span className="num">{formatCurrencyAbs(fees)}</span> fees.
        </p>

        {cardsMissing.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-label-2">
            {cardsMissing.map((t) => t.label).join(', ')}:{' '}
            {cardsMissing.length === 1 ? 'numbers missing' : 'numbers missing on each'} — type them
            with the pencil, or{' '}
            {onOpenAccounts ? (
              <button
                type="button"
                onClick={onOpenAccounts}
                className="press inline-flex items-center gap-1 text-info hover:brightness-125"
              >
                upload a summary under Accounts
                <ArrowRight size={12} />
              </button>
            ) : (
              ' upload a summary under Accounts'
            )}
          </p>
        )}

        {steps.length > 0 && (
          <ul className="flex flex-col gap-1 text-[13px] text-label-2">
            {steps.map((s, i) => (
              <li key={`${s.accountId}-${s.id ?? i}`}>{rateStepSentence(s, termsById[s.accountId])}</li>
            ))}
          </ul>
        )}

        {assumptions.length > 0 && (
          <ul className="t-caption flex flex-col gap-0.5">
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
