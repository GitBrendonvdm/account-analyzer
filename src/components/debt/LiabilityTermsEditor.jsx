import { useState } from 'react';
import { X } from 'lucide-react';
import { Field } from '../ui/Field';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * The terms a person knows that the ledger cannot: the contractual rate, the card's minimum, the
 * months left, a balloon, the fees inside the account, and — for a card the export never sees —
 * the balance and the limit.
 *
 * Each field commits on its own, on blur or Enter, and sends ONLY that key: a rate typed here must
 * never drag a stale balance along with it, and a blank means "forget what I typed, go back to
 * what you inferred". The inferred figure sits under every field while typing, so the two can be
 * compared without leaving the row. Validation is the record's (§4): rates 0–40%, minimum 1–20%,
 * term 0–480 months, amounts as absolute numbers, an as-of date no later than today. A balance is
 * typed positive, as owed, and stored negative, as the record wants it.
 *
 * On a phone the fields run full width at 44px with 16px type (under 16px iOS zooms the page on
 * focus), one per row; from `md` up they keep the kit's compact size in a two- or four-column grid.
 */

const DAY_MONTH = { day: 'numeric', month: 'short' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const valid = (d) => d && !Number.isNaN(d.getTime());
const fmtDayMonth = (d) => (valid(toDate(d)) ? toDate(d).toLocaleDateString('en-ZA', DAY_MONTH) : '—');
const pct = (r, dp = 2) => (Number.isFinite(r) ? `${(r * 100).toFixed(dp)}%` : '—');
const isoDay = (d) => {
  const x = toDate(d);
  if (!valid(x)) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
const isCard = (t) => t?.type === 'Credit Card' || t?.kind === 'card';

const RULES = {
  interestRate: { min: 0, max: 40, message: 'Rate must be between 0 and 40%' },
  minimumPayment: { min: 1, max: 20, message: 'Minimum must be between 1 and 20% of the balance' },
  termMonths: { min: 0, max: 480, integer: true, message: 'Term must be 0 to 480 months' },
  balloon: { min: 0, message: 'Balloon must be a positive amount' },
  feesMonthly: { min: 0, message: 'Fees must be a positive amount' },
  currentBalance: { min: 0, message: 'Balance must be a positive amount (what is owed)' },
  creditLimit: { min: 0, message: 'Limit must be a positive amount' },
};

function parseNumber(raw) {
  const s = String(raw ?? '')
    .replace(/[^\d.-]/g, '')
    .trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Make the kit's small numeric inputs phone-sized: full width, 44px, 16px type. */
const FIELD_TAP = 'max-md:[&_input]:min-h-11 max-md:[&_input]:w-full max-md:[&_input]:text-base max-md:[&_label]:flex';

function Inferred({ children }) {
  return <span className="t-caption mt-1 block max-w-[22ch] leading-snug max-md:max-w-none">{children}</span>;
}

export function LiabilityTermsEditor({ term, account, onPatchAccount, asOf, onClose }) {
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState({});
  const card = isCard(term);
  const id = term.accountId;
  const stored = (key) => account?.[key] ?? null;

  const note = (key, error) => setErrors((e) => ({ ...e, [key]: error }));
  const flash = (key) => setSaved((s) => ({ ...s, [key]: true }));

  const send = (patch, key) => {
    note(key, null);
    flash(key);
    onPatchAccount?.(id, patch);
  };

  const commitNumber = (key, raw) => {
    const n = parseNumber(raw);
    const rule = RULES[key];
    if (n === null) {
      if (stored(key) === null) return note(key, null);
      return send({ [key]: null }, key);
    }
    if (Number.isNaN(n) || n < rule.min || (rule.max != null && n > rule.max)) return note(key, rule.message);
    let value = rule.integer ? Math.round(n) : n;
    if (key === 'currentBalance') value = -Math.abs(value);
    if (stored(key) === value) return note(key, null);
    const patch = { [key]: value };
    if (key === 'currentBalance') {
      // A balance typed here is a manual one, whatever the record said before, and it is the balance
      // as of today unless a date was already set — the ledger has no "last row" for an external card.
      patch.source = 'manual';
      if (!stored('balanceAsOf')) {
        const today = isoDay(asOf ?? new Date());
        if (today) patch.balanceAsOf = today;
      }
    }
    return send(patch, key);
  };

  const commitDate = (raw) => {
    const s = String(raw ?? '').trim();
    if (!s) {
      if (stored('balanceAsOf') === null) return note('balanceAsOf', null);
      return send({ balanceAsOf: null }, 'balanceAsOf');
    }
    const d = new Date(`${s}T00:00:00`);
    if (!valid(d)) return note('balanceAsOf', 'Use a date like 2026-08-22');
    const today = toDate(asOf ?? new Date());
    if (valid(today) && d.getTime() > today.getTime() + 86_400_000) {
      return note('balanceAsOf', 'The as-of date cannot be in the future');
    }
    if (stored('balanceAsOf') === s) return note('balanceAsOf', null);
    return send({ balanceAsOf: s }, 'balanceAsOf');
  };

  const status = (key) =>
    errors[key] ? (
      <span className="mt-1 block text-[12px] text-bad">{errors[key]}</span>
    ) : saved[key] ? (
      <span className="mt-1 block text-[12px] text-good">saved</span>
    ) : null;

  const remaining = Number.isFinite(term.remainingMonths) ? Math.ceil(term.remainingMonths) : null;
  const clearWithin = Object.entries(term.extraToClearWithin ?? {}).filter(([, v]) => Number.isFinite(v) && v > 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        {/* `flex-1` keeps the close button on the title row instead of wrapping under it on a phone. */}
        <div className="min-w-0 flex-1">
          <h3 className="t-sub">{term.label} — terms</h3>
          <p className="t-caption mt-1">
            Typed values win and are labelled "from you". Leave a field blank to go back to the
            inferred figure.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the terms editor"
            className="press inline-flex items-center justify-center rounded-full p-2 text-label-3 hover:bg-fill-2 hover:text-label max-md:min-h-11 max-md:min-w-11"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className={`mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4 ${FIELD_TAP}`}>
        <div>
          <Field
            label="Interest rate"
            value={stored('interestRate')}
            onCommit={(raw) => commitNumber('interestRate', raw)}
            suffix={<span className="whitespace-nowrap">% a year</span>}
            placeholder={Number.isFinite(term.rateNominal) ? (term.rateNominal * 100).toFixed(2) : '—'}
          />
          <Inferred>
            {term.rateSource === 'user'
              ? `inferred ${pct(term.rateNominal)} is what the ledger says`
              : term.rateSource === 'default'
                ? `assumed ${pct(term.rateNominal)} — nothing inferred yet`
                : `inferred ${pct(term.rateNominal)} from ${term.postings ?? 0} postings`}
          </Inferred>
          {status('interestRate')}
        </div>

        {card && (
          <div>
            <Field
              label="Minimum payment"
              value={stored('minimumPayment')}
              onCommit={(raw) => commitNumber('minimumPayment', raw)}
              suffix={<span className="whitespace-nowrap">% of balance</span>}
              placeholder={String(term.minimumPct ?? 5)}
            />
            <Inferred>default {term.minimumPct ?? 5}% when blank</Inferred>
            {status('minimumPayment')}
          </div>
        )}

        {!card && (
          <div>
            <Field
              label="Months remaining"
              value={stored('termMonths')}
              onCommit={(raw) => commitNumber('termMonths', raw)}
              suffix="months"
              inputMode="numeric"
              placeholder={remaining != null ? String(remaining) : '—'}
            />
            <Inferred>
              {term.neverClears
                ? 'never clears at today’s instalment'
                : remaining != null
                  ? `${remaining} months at today’s rate`
                  : 'not inferred'}
            </Inferred>
            {status('termMonths')}
          </div>
        )}

        {!card && (
          <div>
            <Field
              label="Balloon at the end"
              value={stored('balloon')}
              onCommit={(raw) => commitNumber('balloon', raw)}
              prefix="R"
              placeholder="0"
            />
            <Inferred>vehicle finance only; due in the last month</Inferred>
            {status('balloon')}
          </div>
        )}

        <div>
          <Field
            label="Fees a month"
            value={stored('feesMonthly')}
            onCommit={(raw) => commitNumber('feesMonthly', raw)}
            prefix="R"
            placeholder={Number.isFinite(term.feeMonthly) ? String(Math.round(term.feeMonthly)) : '0'}
          />
          <Inferred>
            {Number.isFinite(term.feeMonthly)
              ? `inferred ${formatCurrencyAbs(term.feeMonthly)}${term.feeItems?.length ? `: ${term.feeItems.map((f) => f.label).join(', ')}` : ''}`
              : 'nothing inferred'}
          </Inferred>
          {status('feesMonthly')}
        </div>

        <div>
          <Field
            label="Balance owed"
            value={stored('currentBalance') == null ? null : Math.abs(stored('currentBalance'))}
            onCommit={(raw) => commitNumber('currentBalance', raw)}
            prefix="R"
            width="w-32"
            placeholder={Number.isFinite(term.balanceOwed) ? String(Math.round(term.balanceOwed)) : '—'}
          />
          <Inferred>
            {term.balanceSource === 'ledger'
              ? `${formatCurrencyAbs(term.balanceOwed)} from the ledger`
              : term.balanceSource === 'regression'
                ? `${formatCurrencyAbs(term.balanceOwed)} fitted`
                : term.balanceSource
                  ? `${formatCurrencyAbs(term.balanceOwed)} as of ${fmtDayMonth(term.balanceAsOf)}`
                  : 'no balance known'}
          </Inferred>
          {status('currentBalance')}
        </div>

        {card && (
          <div>
            <Field
              label="Credit limit"
              value={stored('creditLimit')}
              onCommit={(raw) => commitNumber('creditLimit', raw)}
              prefix="R"
              width="w-32"
              placeholder="—"
            />
            <Inferred>from your statement when uploaded</Inferred>
            {status('creditLimit')}
          </div>
        )}

        <div>
          <Field
            label="Balance as of"
            type="date"
            inputMode="none"
            value={stored('balanceAsOf')}
            onCommit={commitDate}
            width="w-40"
            max={isoDay(asOf ?? null) ?? undefined}
          />
          <Inferred>blank = the account’s last row</Inferred>
          {status('balanceAsOf')}
        </div>
      </div>

      {clearWithin.length > 0 && (
        <p className="t-caption mt-5 border-t pt-4">
          To clear it sooner:{' '}
          {clearWithin
            .map(([months, amount]) => `${formatCurrencyAbs(amount)} a month extra clears it in ${months} months`)
            .join(' · ')}
          .
        </p>
      )}
    </div>
  );
}
