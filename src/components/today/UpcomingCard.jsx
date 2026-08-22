import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * The next thirty days of standing charges, as a calendar rather than a total.
 *
 * "Bills still due" on the hero is one number; this is the list behind it, day by day, with the
 * payday row in the middle so the instalments that land the week after the salary are visibly on
 * the far side of it. Each row carries how sure the recurring engine is — a filled dot for a line
 * it has seen land on the same day every cycle, a ring for a fair guess, a dashed ring for a
 * pattern that is still forming — because a R6 000 instalment and a R40 tentative charge should not
 * read as the same kind of fact.
 *
 * Overdue lines go first: "usually landed by now and hasn't" is the thing most worth noticing.
 * When the export is older than today, charges due in that gap are marked "not yet in the data"
 * rather than overdue, because the bank has probably paid them and the file simply stops short.
 */

const DAY_MS = 86400000;
const DAY = { weekday: 'short', day: 'numeric', month: 'short' };
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
const fmtDate = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-ZA', DAY) : '—';
};

/** Filled dot, ring, dashed ring — the three confidence levels, in order. */
function Mark({ level }) {
  const base = 'inline-block h-2 w-2 shrink-0 rounded-full';
  if (level === 'high') return <span className={`${base} bg-label-2`} title="Seen every cycle" />;
  if (level === 'medium') return <span className={`${base} border border-label-2`} title="Usually seen" />;
  return <span className={`${base} border border-dashed border-label-3`} title="Pattern still forming" />;
}

function StatusChip({ status, days }) {
  const text =
    status === 'landed'
      ? 'landed'
      : status === 'overdue'
        ? `overdue ${days ?? 0}d`
        : status === 'next'
          ? 'next cycle'
          : status === 'unobservable'
            ? 'not yet in the data'
            : null;
  if (!text) return null;
  const tone = status === 'overdue' ? 'text-warn' : status === 'landed' ? 'text-good' : 'text-label-3';
  return <span className={`shrink-0 rounded bg-fill px-1.5 py-0.5 text-[12px] ${tone}`}>{text}</span>;
}

function ItemRow({ label, amount, level, status, days, account }) {
  return (
    <li className="flex items-center gap-3 py-1.5 text-[14px]">
      <Mark level={level} />
      <span className="min-w-0 flex-grow truncate text-label-2" title={account ? `${label} · ${account}` : label}>
        {label}
      </span>
      <StatusChip status={status} days={days} />
      <span className="num shrink-0 font-medium">{formatCurrencyAbs(amount)}</span>
    </li>
  );
}

export function UpcomingCard({ upcoming, dataThrough, className = '' }) {
  if (!upcoming) return null;

  const horizonFrom = toDate(upcoming.horizon?.from);
  const horizonTo = toDate(upcoming.horizon?.to);
  const lastObserved =
    toDate(dataThrough) ?? (horizonFrom ? new Date(horizonFrom.getTime() - DAY_MS) : null);
  const days = horizonFrom && horizonTo ? daysBetween(horizonFrom, horizonTo) + 1 : 30;
  const entries = (upcoming.entries ?? []).filter((e) => e.payday || e.items?.length);
  const overdue = upcoming.overdue ?? [];
  const overdueDays = (line) => {
    const due = toDate(line.nextDate);
    return due && lastObserved ? Math.max(0, daysBetween(due, lastObserved)) : null;
  };

  return (
    <Card className={`materialize flex flex-col p-5 sm:p-8 ${className}`}>
      <CardHead
        title="Coming up"
        subtitle={`The next ${days} days of standing charges, read from what has repeated before.`}
      />

      {overdue.length > 0 && (
        <div className="mt-6">
          <div className="t-label text-warn">Usually landed by now</div>
          <ul className="mt-1.5 flex flex-col">
            {overdue.map((line) => (
              <ItemRow
                key={line.id ?? line.label}
                label={line.label}
                amount={line.amount}
                level={line.level}
                status="overdue"
                days={overdueDays(line)}
              />
            ))}
          </ul>
        </div>
      )}

      <ol className="mt-5 flex flex-col">
        {entries.length === 0 && (
          <li className="t-caption">Nothing expected in the next {days} days.</li>
        )}
        {entries.map((e) => {
          const key = toDate(e.date)?.toISOString() ?? String(e.date);
          return (
            <li key={key} className="border-t py-2.5 first:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[13px] font-semibold ${e.payday ? 'text-good' : 'text-label'}`}>
                  {fmtDate(e.date)}
                </span>
                <span className="t-caption">
                  day {e.cycleDay}
                  {e.cycle === 'next' ? ' of the next cycle' : ''}
                </span>
              </div>
              {e.payday && (
                <div className="flex items-center gap-3 py-1.5 text-[14px] text-good">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-good" />
                  <span className="min-w-0 flex-grow truncate font-medium">Payday</span>
                  {e.income > 0 && <span className="num shrink-0 font-semibold">{formatCurrencyAbs(e.income)}</span>}
                </div>
              )}
              <ul className="flex flex-col">
                {(e.items ?? []).map((it, i) => (
                  <ItemRow
                    key={`${it.lineId ?? it.label}-${i}`}
                    label={it.label}
                    amount={it.amount}
                    level={it.level}
                    status={it.status}
                    days={it.status === 'overdue' ? overdueDays(it) : null}
                  />
                ))}
              </ul>
              {e.total > 0 && (e.items?.length ?? 0) > 1 && (
                <div className="flex justify-end text-[12px] text-label-3">
                  <span className="num">{formatCurrencyAbs(e.total)} that day</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-5 border-t pt-4 text-[13.5px] text-label-2">
        <b className="num font-semibold text-label">{formatCurrencyAbs(upcoming.dueBeforePayday)}</b> due before
        payday · <b className="num font-semibold text-label">{formatCurrencyAbs(upcoming.dueAfterPayday)}</b> in the
        first week after
        {upcoming.lowConfidenceExtra > 0 && `, plus ${formatCurrencyAbs(upcoming.lowConfidenceExtra)} at low confidence`}
      </p>
      {upcoming.assumptions?.length > 0 && <p className="t-caption mt-2">{upcoming.assumptions.join(' ')}</p>}
    </Card>
  );
}
