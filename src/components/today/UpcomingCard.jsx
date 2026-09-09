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
 *
 * An overdue line is also the one place the engine is most often wrong in a way only the reader
 * can fix, so each one carries three verdicts. "Paid" is for a charge that landed in a shape the
 * matcher could not pair to one predicted date — a home loan taken as two odd debits — and settles
 * just this cycle, so next cycle the engine judges it afresh. "Stopped" and "Replaced" both retire
 * the line: no next date, gone from this calendar and from the cash path. They differ only in what
 * they claim — "Stopped" is money saved and shows up in the wins; "Replaced" is a new insurer at a
 * new price, where claiming a saving would be a lie.
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

function ItemRow({ label, amount, level, status, days, account, children }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5 text-[14px]">
      <Mark level={level} />
      <span className="min-w-0 flex-grow truncate text-label-2" title={account ? `${label} · ${account}` : label}>
        {label}
      </span>
      <StatusChip status={status} days={days} />
      <span className="num shrink-0 font-medium">{formatCurrencyAbs(amount)}</span>
      {children}
    </li>
  );
}

const VERDICTS = [
  { id: 'paid', label: 'Paid', hint: 'It landed — this cycle only' },
  { id: 'cancelled', label: 'Stopped', hint: "Cancelled — it isn't coming back" },
  { id: 'replaced', label: 'Replaced', hint: 'Switched provider — no saving to claim' },
];

/**
 * The three verdicts, as one chip group per overdue line.
 *
 * They sit on their own row below `sm` at a 44px height so a thumb can land on one, and shrink to
 * the inline group the desktop has elsewhere in the app (see SubscriptionsCard's OverrideControl,
 * which this deliberately matches — the same decision reached from two places should look the
 * same). Pressing an active chip clears the verdict, so a mis-tap is one tap to undo.
 */
function VerdictChips({ line, settledCycle, override, onSettle, onEnd }) {
  if (!onSettle && !onEnd) return null;
  const active = settledCycle ? 'paid' : override;
  const press = (id) => {
    if (id === 'paid') return onSettle?.(line.id, active === 'paid' ? null : 'settle');
    return onEnd?.(line.id, active === id ? null : id);
  };
  return (
    <span
      className="glass-chip flex w-full gap-0.5 p-0.5 sm:w-auto sm:shrink-0"
      role="group"
      aria-label={`What happened to ${line.label}`}
    >
      {VERDICTS.map((v) => {
        const on = active === v.id;
        return (
          <button
            key={v.id}
            type="button"
            aria-pressed={on}
            title={v.hint}
            onClick={() => press(v.id)}
            className={`press min-h-11 flex-auto rounded-full px-2.5 py-1 text-[12px] whitespace-nowrap sm:min-h-0 sm:flex-none sm:text-[11px] ${
              on ? 'bg-fill-2 font-semibold text-label' : 'text-label-3 hover:text-label'
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </span>
  );
}

export function UpcomingCard({
  upcoming,
  dataThrough,
  currentCycle = null,
  lineOverrides = null,
  lineSettled = null,
  onSettleLine = null,
  onEndLine = null,
  className = '',
}) {
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
  // "Paid" settles the CURRENT cycle, so the writer needs its key. Without one — a file with no
  // complete cycle yet — the chips would have nothing to write, so they stay off.
  const settle = currentCycle && onSettleLine ? (id, verdict) => onSettleLine(id, verdict ? currentCycle : null) : null;

  return (
    <Card className={`materialize flex flex-col p-5 sm:p-8 ${className}`}>
      <CardHead
        title="Coming up"
        subtitle={`The next ${days} days of standing charges, read from what has repeated before.`}
      />

      {overdue.length > 0 && (
        <div className="mt-6">
          <div className="t-label text-warn">Usually landed by now</div>
          {(settle || onEndLine) && (
            <p className="t-caption mt-1">
              Tell the app what happened: <b className="font-semibold text-label-2">Paid</b> if it landed in an
              odd shape this cycle, <b className="font-semibold text-label-2">Stopped</b> if it is cancelled,{' '}
              <b className="font-semibold text-label-2">Replaced</b> if something else charges instead.
            </p>
          )}
          <ul className="mt-1.5 flex flex-col">
            {overdue.map((line) => (
              <ItemRow
                key={line.id ?? line.label}
                label={line.label}
                amount={line.amount}
                level={line.level}
                status="overdue"
                days={overdueDays(line)}
              >
                <VerdictChips
                  line={line}
                  settledCycle={lineSettled?.[line.id] ?? null}
                  override={lineOverrides?.[line.id] ?? null}
                  onSettle={settle}
                  onEnd={onEndLine}
                />
              </ItemRow>
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
