import { AlertTriangle, CalendarClock, Clock } from 'lucide-react';
import { formatCurrency, formatCurrencyAbs } from '../utils/format';

const DAY_MONTH = { day: 'numeric', month: 'short' };
const fmtDate = (d) => (d ? d.toLocaleDateString('en-ZA', DAY_MONTH) : '—');

/**
 * Staleness is the one condition that silently invalidates every other figure on this card, so it
 * escalates rather than sitting at a constant grey whisper: the previous badge looked identical at
 * two days behind and at seventeen.
 */
const STALE_TONE = {
  fresh: 'bg-fill text-label-2',
  warn: 'bg-warn/10 text-warn',
  alarm: 'bg-bad/10 font-medium text-bad',
};

function Stat({ label, value, tone = 'text-label', sub, title }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[11px] font-medium tracking-[0.06em] text-label-3 uppercase">{label}</div>
      <div className={`mt-1 truncate text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-label-2">{sub}</div>}
    </div>
  );
}

/**
 * Answers the question the app exists for — how much is left before payday — which previously
 * appeared nowhere. Also states the two things that silently shape every other number: which period
 * is being shown, and how stale the data is.
 */
export function CycleSummary({ summary }) {
  if (!summary) return null;
  const {
    start,
    end,
    cycleLength,
    cycleDay,
    daysToPayday,
    progress,
    isProjectedEnd,
    dataThrough,
    staleDays,
    staleLevel,
    income,
    expense,
    projectedClose,
    forecastPerDay,
    missedPayments,
  } = summary;

  const overspending = projectedClose < 0;
  const paceLabel =
    expense.pace == null
      ? null
      : expense.pace > 1.05
        ? `${Math.round((expense.pace - 1) * 100)}% above typical pace`
        : expense.pace < 0.95
          ? `${Math.round((1 - expense.pace) * 100)}% below typical pace`
          : 'tracking typical pace';

  return (
    <div className="glass p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-label-2">
          <CalendarClock size={16} className="text-label-3" />
          <span className="font-medium text-label">
            {fmtDate(start)} – {fmtDate(end)}
          </span>
          <span className="text-label-3">·</span>
          <span>
            Day {cycleDay} of {cycleLength}
          </span>
          <span className="text-label-3">·</span>
          <span>
            {daysToPayday} day{daysToPayday === 1 ? '' : 's'} to payday
          </span>
          {isProjectedEnd && (
            <span
              className="rounded bg-fill px-1.5 py-0.5 text-[11px] text-label-2"
              title="This cycle hasn't closed yet — the end date follows the boundary the export uses."
            >
              projected
            </span>
          )}
        </div>
        {dataThrough && (
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${STALE_TONE[staleLevel]}`}
            title={
              staleLevel === 'fresh'
                ? 'Nothing after this date is in the file, so recent spend may not be reflected yet.'
                : `The export is ${staleDays} days old. Everything under"so far" is missing that much spend, and the forecast is filling the gap with averages rather than what you actually did.`
            }
          >
            <Clock size={12} />
            Data through {fmtDate(dataThrough)}
            {staleDays > 0 && ` · ${staleDays} day${staleDays === 1 ? '' : 's'} behind`}
          </div>
        )}
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-fill">
        <div
          className="h-full rounded-full bg-fill-2 transition-[width]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Projected close"
          value={formatCurrency(projectedClose)}
          tone={overspending ? 'text-bad' : 'text-good'}
          sub={`${formatCurrency(income.received - expense.spent)} net so far`}
          title="Income and spend for this cycle, actual so far plus what's still forecast. This is a cycle flow, not a bank balance — the export has no balance column."
        />
        <Stat
          label="Still to spend"
          value={formatCurrencyAbs(expense.remaining)}
          tone="text-info"
          sub={`${formatCurrencyAbs(forecastPerDay)} / day over ${daysToPayday} day${daysToPayday === 1 ? '' : 's'}`}
          title="Forecast spend between now and payday. Completed weeks are locked at what actually happened; the current week is prorated by how much of it is left."
        />
        <Stat
          label="Spent"
          value={formatCurrencyAbs(expense.spent)}
          tone="text-label"
          sub={paceLabel ?? `of ${formatCurrencyAbs(expense.projected)} expected`}
          title={`Typical for a full cycle is ${formatCurrencyAbs(expense.typical)}.`}
        />
        <Stat
          label="Income"
          value={formatCurrencyAbs(income.received)}
          tone="text-good"
          sub={
            Math.abs(income.remaining) > 1
              ? `${formatCurrencyAbs(income.remaining)} still expected`
              : 'all expected income received'
          }
          title={`Typical for a full cycle is ${formatCurrencyAbs(income.typical)}.`}
        />
        <Stat
          label="Overdue"
          value={String(missedPayments.length)}
          tone={missedPayments.length ? 'text-warn' : 'text-label-3'}
          sub={
            missedPayments.length
              ? missedPayments.slice(0, 2).map((m) => m.name).join(', ') +
                (missedPayments.length > 2 ? ` +${missedPayments.length - 2}` : '')
              : 'nothing overdue'
          }
          title="Regular payments that usually land by this point in the cycle but haven't yet."
        />
      </div>

      {missedPayments.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-warn/10 p-3 text-xs text-warn">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="font-medium">Usually paid by now:</span>
          {missedPayments.map((m) => (
            <span key={`${m.group}-${m.name}`} className="rounded bg-fill-2 px-1.5 py-0.5">
              {m.name}
              {Math.abs(m.expected) > 1 && ` · ${formatCurrencyAbs(m.expected)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
