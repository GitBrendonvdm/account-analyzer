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
 *
 * Eight columns need 980px, which on a phone meant a 3× sideways scroll inside the card with the
 * debt's name lost off the left edge. Below `md` the same rows are laid out as stacked cards — name
 * and chips, then label/value pairs — and the editor opens INSIDE the card that was tapped rather
 * than under a table the thumb has scrolled past. Both layouts are rendered and CSS picks one, so
 * the facts and the cells are shared and cannot drift; the table is untouched from `md` up.
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

/** Inline text links sit in a sentence; padding the hit area out to 44px without moving the line. */
const INLINE_TAP = 'max-md:-my-3 max-md:min-h-11 max-md:py-3';

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

/** Everything a row's cells rest on, derived once so the table and the stacked card agree. */
function rowFacts(term, account) {
  const card = isCard(term);
  const missing = card ? missingNumbers(term, account) : [];
  const noBalance = !Number.isFinite(term.balanceOwed);
  const remaining =
    term.neverClears || term.remainingMonths === Infinity
      ? null
      : Number.isFinite(term.remainingMonths)
        ? Math.ceil(term.remainingMonths)
        : null;
  return {
    card,
    missing,
    noBalance,
    // A card with no balance shows what is missing where its owed/rate figures would have been.
    missingOnly: card && missing.length > 0 && noBalance,
    provenance: balanceProvenance(term, account),
    inferred: term.rateSource === 'user' ? inferredRate(term) : null,
    remaining,
    clearsBy: remaining != null ? addMonths(term.nextPostingDate ?? term.lastPostingDate, remaining) : null,
    minimumNow:
      card && Number.isFinite(term.balanceOwed)
        ? Math.max(CARD_MINIMUM_FLOOR, ((term.minimumPct ?? CARD_MINIMUM_PCT_DEFAULT) / 100) * term.balanceOwed)
        : null,
  };
}

// The 10.5px chips are legible beside a desktop row; on a phone held at arm's length they are not.
function Chip({ children, tone = 'text-label-2' }) {
  return (
    <span className={`inline-block rounded bg-fill px-1.5 py-0.5 text-[10.5px] leading-tight max-md:text-xs ${tone}`}>
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

// ---- the cells, shared by the table row and the stacked card ------------------------------

function NameCell({ term, f }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Dot confidence={term.confidence} />
        <span className="text-[14.5px] font-medium text-label">{term.label}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Chip>{term.kind ?? (f.card ? 'card' : 'loan')}</Chip>
        {term.external && <Chip>not in the export</Chip>}
        {term.rateVariable && <Chip tone="text-warn">variable</Chip>}
      </div>
    </>
  );
}

function MissingCell({ missing }) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-[13px] text-warn">
        <AlertTriangle size={13} />
        {missing.length} number{missing.length === 1 ? '' : 's'} missing: {missing.join(', ')}
      </div>
      <p className="t-caption mt-1">
        Type them with the pencil, or upload your bank's summary under Accounts.
      </p>
    </>
  );
}

function OwedCell({ term, f }) {
  return (
    <>
      <div className="text-[14.5px] font-semibold text-label">
        {f.noBalance ? '—' : formatCurrencyAbs(term.balanceOwed)}
      </div>
      <div className="mt-1">
        {f.provenance ? <Chip>{f.provenance}</Chip> : <Chip tone="text-warn">no balance — type one</Chip>}
      </div>
    </>
  );
}

function RateCell({ term, f, primeRate }) {
  return (
    <>
      <div className="text-[14.5px] text-label">
        {pct(term.rateNominal)}
        <span className="ml-1 text-[11px] text-label-3 max-md:text-xs">{term.rateVariable ? 'variable' : 'fixed'}</span>
      </div>
      <div className="t-caption mt-0.5">
        {Number.isFinite(term.margin) && primeRate != null
          ? `prime ${term.margin >= 0 ? '+' : '−'} ${Math.abs(term.margin * 100).toFixed(2)}`
          : Number.isFinite(term.rateEffective)
            ? `${pct(term.rateEffective)} effective`
            : null}
      </div>
      <div className="mt-1 flex flex-wrap justify-end gap-1">
        <Chip tone={term.rateSource === 'default' ? 'text-warn' : 'text-label-2'}>{rateProvenance(term)}</Chip>
        {f.inferred != null && <Chip>inferred {pct(f.inferred)}</Chip>}
        {f.card && Number.isFinite(term.rateLowerBound) && (
          <Chip>at least {pct(term.rateLowerBound, 1)} implied</Chip>
        )}
      </div>
    </>
  );
}

function InstalmentCell({ term, f, payingLabel }) {
  if (f.card) {
    return (
      <>
        <div className="text-[14.5px] text-label">
          {Number.isFinite(term.typicalRepayment) ? formatCurrencyAbs(term.typicalRepayment) : '—'}
        </div>
        <div className="t-caption mt-0.5">
          {Number.isFinite(term.typicalRepayment) ? 'typical repayment' : 'no repayments seen'}
          {Number.isFinite(term.repaymentDay) && ` · around the ${ordinal(term.repaymentDay)}`}
          {f.minimumNow != null && ` · minimum ${formatCurrencyAbs(f.minimumNow)}`}
        </div>
      </>
    );
  }
  return (
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
          <Chip tone="text-warn">{term.instalmentChanged ? 'changed recently' : 'latest credit only'}</Chip>
        </div>
      )}
    </>
  );
}

/** `stacked` lets the fee labels wrap on a card, where there is no column to keep narrow. */
function FeesCell({ term, stacked = false }) {
  return (
    <>
      <div className="text-[14.5px] text-label">
        {Number.isFinite(term.feeMonthly) ? formatCurrencyAbs(term.feeMonthly) : '—'}
      </div>
      <div className={`t-caption mt-0.5 ${stacked ? '' : 'max-w-[16ch] truncate'}`}>
        {(term.feeItems ?? [])
          .slice(0, 2)
          .map((fee) => fee.label)
          .join(', ')}
        {term.feeSource === 'user' && ' · from you'}
      </div>
    </>
  );
}

function MonthsLeftCell({ term, f }) {
  return (
    <>
      <div className={`text-[14.5px] ${term.neverClears ? 'text-bad' : 'text-label'}`}>
        {term.neverClears || term.remainingMonths === Infinity
          ? 'never'
          : f.remaining != null
            ? `${f.remaining} mo`
            : '—'}
      </div>
      <div className="t-caption mt-0.5">
        {term.termSource === 'user' ? 'from you' : 'at today’s rate'}
        {f.clearsBy && ` · ${fmtMonthYear(f.clearsBy)}`}
      </div>
    </>
  );
}

function FeeAdjustedCell({ term }) {
  return (
    <>
      <div className="text-[14.5px] text-label">{pct(term.feeAdjustedRate)}</div>
      <div className="t-caption mt-0.5">with fees</div>
    </>
  );
}

function EditButton({ term, open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Close' : 'Edit'} terms for ${term.label}`}
      className="press inline-flex items-center justify-center rounded-full p-2 text-label-3 hover:bg-fill hover:text-label max-md:min-h-11 max-md:min-w-11"
    >
      {open ? <ChevronDown size={15} /> : <Pencil size={15} />}
    </button>
  );
}

function Notes({ term, neverClearsNote }) {
  return (
    <>
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
    </>
  );
}

// ---- the two layouts -----------------------------------------------------------------------

function Row({ term, account, primeRate, open, onToggle, neverClearsNote, payingLabel }) {
  const f = rowFacts(term, account);
  return (
    <>
      <tr className={`border-t ${open ? 'bg-fill' : ''}`}>
        <td className="px-6 py-3 align-top">
          <NameCell term={term} f={f} />
        </td>

        {f.missingOnly ? (
          <td className="px-4 py-3 align-top" colSpan={2}>
            <MissingCell missing={f.missing} />
          </td>
        ) : (
          <>
            <td className="num px-4 py-3 text-right align-top">
              <OwedCell term={term} f={f} />
            </td>
            <td className="num px-4 py-3 text-right align-top">
              <RateCell term={term} f={f} primeRate={primeRate} />
            </td>
          </>
        )}

        <td className="num px-4 py-3 text-right align-top">
          <InstalmentCell term={term} f={f} payingLabel={payingLabel} />
        </td>
        <td className="num px-4 py-3 text-right align-top">
          <FeesCell term={term} />
        </td>
        <td className="num px-4 py-3 text-right align-top">
          <MonthsLeftCell term={term} f={f} />
        </td>
        <td className="num px-4 py-3 text-right align-top">
          <FeeAdjustedCell term={term} />
        </td>
        <td className="px-3 py-3 text-right align-top">
          <EditButton term={term} open={open} onToggle={onToggle} />
        </td>
      </tr>

      {(term.warnings?.length > 0 || neverClearsNote) && (
        <tr>
          <td colSpan={8} className="px-6 pb-3">
            <Notes term={term} neverClearsNote={neverClearsNote} />
          </td>
        </tr>
      )}
    </>
  );
}

function Fact({ label, children }) {
  return (
    <>
      <dt className="t-label pt-0.5">{label}</dt>
      <dd className="num min-w-0 text-right">{children}</dd>
    </>
  );
}

/** The phone layout: the row's cells as label/value pairs, the editor inside when open. */
function StackedRow({ term, account, primeRate, open, onToggle, neverClearsNote, payingLabel, editor }) {
  const f = rowFacts(term, account);
  return (
    <li className={`border-t px-5 py-4 ${open ? 'bg-fill' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <NameCell term={term} f={f} />
        </div>
        {/* Pulled into the padding so the 44px target does not push the name down. */}
        <div className="-mt-2 -mr-2 shrink-0">
          <EditButton term={term} open={open} onToggle={onToggle} />
        </div>
      </div>

      {f.missingOnly && (
        <div className="mt-3">
          <MissingCell missing={f.missing} />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
        {!f.missingOnly && (
          <>
            <Fact label="Owed">
              <OwedCell term={term} f={f} />
            </Fact>
            <Fact label="Rate">
              <RateCell term={term} f={f} primeRate={primeRate} />
            </Fact>
          </>
        )}
        <Fact label="Instalment">
          <InstalmentCell term={term} f={f} payingLabel={payingLabel} />
        </Fact>
        <Fact label="Fees / month">
          <FeesCell term={term} stacked />
        </Fact>
        <Fact label="Months left">
          <MonthsLeftCell term={term} f={f} />
        </Fact>
        <Fact label="Fee-adjusted">
          <FeeAdjustedCell term={term} />
        </Fact>
      </dl>

      {(term.warnings?.length > 0 || neverClearsNote) && (
        <div className="mt-3 flex flex-col gap-1">
          <Notes term={term} neverClearsNote={neverClearsNote} />
        </div>
      )}

      {open && editor && <div className="mt-4 border-t pt-4">{editor}</div>}
    </li>
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
      <Card className="materialize p-5 sm:p-8">
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

  const editorFor = (id) =>
    termsById[id] ? (
      <LiabilityTermsEditor
        term={termsById[id]}
        account={accountsById[id]}
        onPatchAccount={onPatchAccount}
        asOf={asOf}
        onClose={() => setOpenId(null)}
      />
    ) : null;

  const rowProps = (t) => {
    const paying = t.payingAccountId ? accountsById[t.payingAccountId] : null;
    const open = openId === t.accountId;
    return {
      term: t,
      account: accountsById[t.accountId],
      primeRate,
      open,
      onToggle: () => setOpenId(open ? null : t.accountId),
      neverClearsNote: neverClearsSentence(t, neverByPlan[t.accountId]),
      payingLabel: paying?.label ?? paying?.rawName ?? t.payingCategory ?? null,
    };
  };

  return (
    <Card className="materialize overflow-hidden">
      <div className="border-b px-5 py-5 sm:px-6">
        <CardHead
          title="Your debts"
          subtitle="What is owed, at what rate, and what each one costs a month. A typed value always wins; the inferred one is shown beside it."
        />
      </div>

      <div className="hidden overflow-x-auto md:block">
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
            {list.map((t) => (
              <Row key={t.accountId} {...rowProps(t)} />
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden" aria-label="Your debts">
        {list.map((t) => (
          <StackedRow key={t.accountId} {...rowProps(t)} editor={openId === t.accountId ? editorFor(t.accountId) : null} />
        ))}
      </ul>

      {openId && termsById[openId] && (
        <div className="hidden border-t bg-fill px-6 py-5 md:block">{editorFor(openId)}</div>
      )}

      <div className="flex flex-col gap-3 border-t px-5 py-5 sm:px-6">
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
                className={`press inline-flex items-center gap-1 text-info hover:brightness-125 ${INLINE_TAP}`}
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
