import { CardHead } from '../ui/Surface';
import { Field } from '../ui/Field';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * A lump sum, tried on every debt.
 *
 * A bonus or a tax refund raises one question — where — and the answer differs by horizon: the
 * card wins this year, the bond over a lifetime, and the honest reply is both bars side by side
 * plus the sentence that picks one. The month defaults to the next payday because that is when
 * the money would actually land. When the engine is not wired the rows are scaled from the
 * R1 000 figures and say so: a fair first guess for small lumps, not the simulation.
 */

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const DAY_MONTH = { day: 'numeric', month: 'short' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const valid = (d) => d && !Number.isNaN(d.getTime());
const fmtMonthYear = (d) => (valid(toDate(d)) ? toDate(d).toLocaleDateString('en-ZA', MONTH_YEAR) : null);
const fmtDayMonth = (d) => (valid(toDate(d)) ? toDate(d).toLocaleDateString('en-ZA', DAY_MONTH) : null);
const money = (v) => (Number.isFinite(v) ? formatCurrencyAbs(v) : '—');
/** Make the kit's small numeric input phone-sized: full width, 44px, 16px type. */
const FIELD_TAP = 'max-md:[&_input]:min-h-11 max-md:[&_input]:w-full max-md:[&_input]:text-base max-md:[&_label]:flex';

function Bar({ value, max, tone }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-fill">
      <span
        className={`block h-full rounded-full ${tone}`}
        style={{ width: `${Math.max(2, (Math.max(0, value ?? 0) / max) * 100)}%`, transition: 'width 600ms var(--ease-out)' }}
      />
    </span>
  );
}

export function LumpWhatIf({
  result,
  marginal = [],
  amount = 0,
  onAmount,
  month = 1,
  onMonth,
  schedule = [],
  labelsById = {},
  approximate = false,
}) {
  const name = (id, fallback) => (id == null ? 'wherever the plan sends it' : (labelsById[id] ?? fallback ?? id));
  const scale = amount / 1000;

  const rows = result?.rows
    ? result.rows.map((r) => ({
        id: r.id,
        label: name(r.id, r.label),
        saved12: r.interestSaved12,
        savedLife: r.interestSaved,
        monthsSaved: r.monthsSaved,
        debtFreeDate: r.debtFreeDate,
        overflowTo: r.overflowTo,
      }))
    : amount > 0
      ? marginal.map((r) => ({
          id: r.id,
          label: name(r.id, r.label),
          saved12: Number.isFinite(r.lump12) ? r.lump12 * scale : null,
          savedLife: Number.isFinite(r.lumpLife) ? r.lumpLife * scale : null,
          monthsSaved: null,
          debtFreeDate: null,
          overflowTo: null,
        }))
      : [];

  const max = Math.max(1, ...rows.flatMap((r) => [r.saved12 ?? 0, r.savedLife ?? 0]));
  const bestId = (b) => (b && typeof b === 'object' ? b.id : b);
  const pick = (key, fallbackKey) => {
    const id = result ? bestId(result[key]) : undefined;
    const hit = id !== undefined ? rows.find((r) => r.id === id) : null;
    return hit ?? rows.slice().sort((a, b) => (b[fallbackKey] ?? -Infinity) - (a[fallbackKey] ?? -Infinity))[0];
  };
  const best12 = pick('best12', 'saved12');
  const bestLife = pick('bestLife', 'savedLife');
  const months = schedule.slice(0, 12);

  return (
    <div>
      <CardHead
        title="A lump sum"
        subtitle="Try an amount on every debt: what it saves this year, what it saves over the life, and how much sooner that debt is gone."
        right={
          // On a phone the two controls stack full width under the title: the month's option text
          // ("23 Aug (next payday)") does not fit half a 360px row.
          <div className={`grid gap-3 max-md:w-full md:flex md:flex-wrap md:items-end md:gap-4 ${FIELD_TAP}`}>
            <Field
              label="Amount"
              value={amount > 0 ? amount : ''}
              onCommit={(raw) => {
                const n = Number(String(raw).replace(/[^\d.]/g, ''));
                onAmount?.(Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
              }}
              prefix="R"
              placeholder="20000"
              width="w-28"
            />
            <label className="inline-flex flex-col gap-1.5">
              <span className="t-label">Lands on</span>
              <select
                value={month}
                onChange={(e) => onMonth?.(Number(e.target.value))}
                className="rounded border bg-transparent px-2 py-1 text-sm text-label focus:border-info/30 focus:outline-none max-md:min-h-11 max-md:w-full max-md:text-base"
                aria-label="Month the lump lands"
              >
                {months.length === 0 && <option value={1}>next payday</option>}
                {months.map((s) => (
                  <option key={s.month} value={s.month}>
                    {fmtDayMonth(s.date) ?? `month ${s.month}`}
                    {s.month === 1 ? ' (next payday)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      />

      {amount <= 0 ? (
        <p className="t-caption mt-5">Type an amount to compare where it does the most.</p>
      ) : rows.length === 0 ? (
        <p className="t-caption mt-5">Nothing to compare until a debt has a balance and a rate.</p>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-4">
            {rows.map((r) => (
              <li key={r.id ?? 'plan'} className="grid items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="truncate text-[14.5px] text-label">{r.label}</div>
                  <div className="t-caption">
                    {!Number.isFinite(r.monthsSaved)
                      ? 'months saved unknown'
                      : r.monthsSaved <= 0
                        ? 'no sooner'
                        : `${r.monthsSaved} month${r.monthsSaved === 1 ? '' : 's'} sooner`}
                    {r.debtFreeDate ? ` · debt-free ${fmtMonthYear(r.debtFreeDate)}` : ''}
                    {r.overflowTo ? ` · overflow to the ${name(r.overflowTo)}` : ''}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Bar value={r.saved12} max={max} tone="bg-info" />
                  <Bar value={r.savedLife} max={max} tone="bg-deep" />
                </div>
                <div className="num text-right text-[13px] max-sm:text-left">
                  <div className="text-label">{money(r.saved12)} <span className="text-label-3">this year</span></div>
                  <div className="text-label-2">{money(r.savedLife)} <span className="text-label-3">over its life</span></div>
                </div>
              </li>
            ))}
          </ul>

          {best12 && bestLife && (
            <p className="mt-6 border-t pt-5 text-[14.5px] leading-relaxed text-label">
              {formatCurrencyAbs(amount)} on the {best12.label} saves{' '}
              <b className="num font-semibold">{money(best12.saved12)}</b> this year and{' '}
              <b className="num font-semibold">{money(best12.savedLife)}</b> over its life
              {Number.isFinite(best12.monthsSaved)
                ? `, and brings its payoff forward ${best12.monthsSaved} month${best12.monthsSaved === 1 ? '' : 's'}.`
                : '.'}
              {bestLife.id !== best12.id &&
                ` Over a lifetime the ${bestLife.label} does better: ${money(bestLife.savedLife)}.`}
            </p>
          )}
          {approximate && (
            <p className="t-caption mt-2">
              Scaled from the R1 000 figures above — an approximation until the plan engine is wired.
            </p>
          )}
        </>
      )}
    </div>
  );
}
