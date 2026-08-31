import { AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import { Card, Figure, Tile } from './ui/Surface';
import { CycleDial } from './today/CycleDial';
import { ChartSwitcher } from './today/ChartSwitcher';
import { VitalsRow } from './today/VitalsRow';
import { UpcomingCard } from './today/UpcomingCard';
import { formatCurrency, formatCurrencyAbs } from '../utils/format';

const DAY_MONTH = { day: 'numeric', month: 'short' };
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmt = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-ZA', DAY_MONTH) : '—';
};
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The bar colours for "where it goes" — semantic first, then a stable rotation. */
const BAR_TONES = ['#5e5ce6', '#0a84ff', '#63e6e2', '#ff9f0a', '#ff375f', '#30d158'];

/**
 * The line under the dial: what the salary is, when it usually lands, and how often it has been
 * late. Read from the income profile's salary aggregate; the day range comes from the salary
 * sources' own day-of-month so two earners paid on different days still get one honest range.
 */
function salaryCaption(profile) {
  const salary = profile?.salary;
  if (!salary || !(salary.expectedAmount > 0)) return null;
  const sources = (profile.sources ?? []).filter((s) => salary.sourceIds?.includes(s.id));
  const dom = median(sources.map((s) => s.dom));
  const lands =
    dom != null
      ? `usually lands the ${ordinal(Math.max(1, Math.round(dom) - 1))}–${ordinal(Math.min(31, Math.round(dom) + 1))}`
      : Number.isFinite(salary.typicalCycleDay)
        ? `usually lands on day ${Math.round(salary.typicalCycleDay)} of the cycle`
        : null;
  const late = (salary.missingCycles?.length ?? 0) + (salary.lateCycles?.length ?? 0);
  const cycles = salary.cycles ?? profile.cycles?.length ?? null;
  const parts = [
    sources.length > 1
      ? `${sources.length === 2 ? 'Two' : sources.length} salaries, ${formatCurrencyAbs(salary.expectedAmount)} a cycle`
      : `Salary ${formatCurrencyAbs(salary.expectedAmount)}`,
  ];
  if (lands) parts[0] += sources.length > 1 ? ` · ${lands.replace('usually lands', 'usually land')}` : ` ${lands}`;
  if (salary.lastReceived) parts.push(`last received ${fmt(salary.lastReceived)}`);
  if (cycles) parts.push(`late in ${late} of ${cycles} cycles`);
  return parts.join(' · ');
}

function WhereItGoes({ rows, onOpenLedger, className = '' }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <Card className={`materialize p-5 sm:p-8 ${className}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="t-head">Where it goes</h2>
        {/* The padding is negative-margined away so the 44px hit area does not move the text. */}
        <button
          type="button"
          onClick={onOpenLedger}
          className="press -my-3 -mr-2 flex min-h-11 items-center gap-1.5 py-3 pr-2 pl-2 text-[13px] font-medium text-info hover:brightness-125"
        >
          All transactions
          <ArrowRight size={13} />
        </button>
      </div>
      {/* On a phone the row is two lines — name and amount, then the bar under both — because
          a fixed 168px label plus a 92px amount left the bar itself 60px wide at 360. From `sm`
          it is the single flex row it always was; `order` keeps one DOM order for both. */}
      <div className="mt-6 flex flex-col gap-4">
        {rows.map((r, i) => (
          <div
            key={r.name}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:flex"
          >
            <span
              className="order-1 min-w-0 truncate text-[14.5px] sm:order-none sm:w-[168px] sm:shrink-0"
              title={r.name}
            >
              {r.name}
            </span>
            <span className="order-3 col-span-2 block h-2.5 overflow-hidden rounded-full bg-fill sm:order-none sm:flex-grow">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(2, (r.amount / max) * 100)}%`,
                  background: r.tone ?? BAR_TONES[i % BAR_TONES.length],
                  transition: 'width 700ms var(--ease-out)',
                }}
              />
            </span>
            <span className="num order-2 w-[92px] shrink-0 text-right text-[14.5px] font-semibold sm:order-none">
              {formatCurrencyAbs(r.amount)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Today — the screen the app opens on.
 *
 * One question first, in the largest type on the page: how much is safe to spend before payday.
 * Everything else is supporting evidence, and the full ledger is one deliberate click away rather
 * than being the front page. That inversion is the point of the rework — the table answers "what
 * exactly", which is a question you go looking for, not one you need answered on arrival.
 *
 * Below the hero, in order: the six vitals (the year's health, not the cycle's), then the bills
 * calendar beside a chart switcher — cash path, spend pace, balance change, one at a time rather
 * than three stacked charts arguing for attention — then the three figures and where the money
 * goes. Every new block renders nothing — never a crash — when its data is not there yet, so the
 * page degrades to the old one.
 */
export function TodayView({
  summary,
  safe,
  curve,
  balances,
  netWorth,
  costOfDebt,
  positions,
  habits,
  vitals,
  upcoming,
  cashPath,
  incomeProfile,
  onOpenLedger,
  onOpenAccounts,
}) {
  if (!summary) return null;

  const negative = (safe?.safe ?? 0) <= 0;
  const cards = (positions ?? []).filter((p) => p.type === 'Credit Card');
  const cardDebt = cards.reduce((s, p) => s + Math.min(0, p.positionByMonth?.[p.currentMonthKey] ?? 0), 0);
  const cardChange = cards.reduce((s, p) => s + (p.windowChange ?? 0), 0);
  const caption = salaryCaption(incomeProfile);

  const spendRows = [];
  if (costOfDebt?.perCycle > 0) {
    spendRows.push({ name: 'Interest & fees', amount: costOfDebt.perCycle, tone: 'var(--color-bad)' });
  }
  (habits?.movers ?? [])
    .slice()
    .sort((a, b) => b.perCycle - a.perCycle)
    .slice(0, 5)
    .forEach((m) => spendRows.push({ name: m.category, amount: m.perCycle }));

  const showTimeline = Boolean(upcoming || cashPath || curve?.series?.length || balances?.series?.length);

  return (
    /* On an ultrawide a column of full-width bands strands the content in empty space, so past
       1800px the page becomes a 12-track grid and the blocks pair up instead of stacking. */
    <div className="grid flex-grow grid-cols-1 gap-5 3xl:grid-cols-12">
      {/* hero */}
      <Card className="materialize grid items-center gap-8 p-6 sm:gap-10 sm:p-10 lg:grid-cols-[1.1fr_0.9fr] 3xl:col-span-12 3xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="t-label">Safe to spend before payday</div>
          {/* The figure never wraps mid-number; `t-hero` clamps its size so it fits a 360 phone. */}
          <div className={`t-hero num mt-2.5 whitespace-nowrap ${negative ? 'text-bad' : 'text-good'}`}>
            {formatCurrency(safe?.safe ?? 0)}
          </div>
          <p className="mt-4 max-w-[40ch] text-[15.5px] leading-relaxed text-label-2">
            {negative
              ? "The bills still due come to more than what's left. This isn't a budget to spend — it's the size of the gap."
              : `${formatCurrencyAbs(safe?.perDay ?? 0)} a day across ${safe?.daysLeft ?? 0} day${safe?.daysLeft === 1 ? '' : 's'}, after every bill still due is set aside.`}
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {safe?.bills?.length > 0 && (
              <span className="glass-chip flex items-center gap-2 px-[15px] py-2.5 text-[13px]">
                <AlertTriangle size={14} className="text-warn" />
                {safe.bills.length} bill{safe.bills.length === 1 ? '' : 's'} still due
              </span>
            )}
            <span className="glass-chip px-[15px] py-2.5 text-[13px] text-label-2">
              {summary.daysToPayday} day{summary.daysToPayday === 1 ? '' : 's'} to payday
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-3">
          <CycleDial day={summary.cycleDay} length={summary.cycleLength} />
          {/* The dial already shows where the cycle is; the exact dates, the staleness note and
              the salary's own habits are what you'd go looking for, not what you came here to
              read, so they sit one tap down rather than at the hero's own weight. */}
          <details className="mt-1">
            <summary className="t-caption cursor-pointer select-none">Details</summary>
            <div className="mt-2 flex flex-col items-center gap-1.5">
              <div className="t-caption">
                {fmt(summary.start)} – {fmt(summary.end)}
              </div>
              {summary.staleLevel !== 'fresh' && (
                <div
                  className={`flex items-center gap-1.5 text-[12px] ${
                    summary.staleLevel === 'alarm' ? 'text-bad' : 'text-warn'
                  }`}
                >
                  <Clock size={12} />
                  {summary.staleDays} days behind
                </div>
              )}
              {caption && <div className="t-caption max-w-[34ch] text-center">{caption}</div>}
            </div>
          </details>
        </div>
      </Card>

      {vitals !== undefined && (
        <VitalsRow vitals={vitals} onOpenAccounts={onOpenAccounts} className="3xl:col-span-12" />
      )}

      {showTimeline && (
        <div className="grid gap-5 lg:grid-cols-2 3xl:col-span-12">
          <UpcomingCard upcoming={upcoming} dataThrough={summary.dataThrough} />
          <ChartSwitcher
            cashPath={cashPath}
            incomeProfile={incomeProfile}
            curve={curve}
            balances={balances}
            onOpenAccounts={onOpenAccounts}
            className={upcoming ? '3xl:col-span-2' : 'lg:col-span-2'}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3 3xl:col-span-12">
        <Tile className="rise p-5 sm:p-6">
          <Figure
            label="Came in"
            value={formatCurrencyAbs(summary.income.received)}
            tone="text-good"
            note={
              Math.abs(summary.income.remaining) > 1
                ? `${formatCurrencyAbs(summary.income.remaining)} still expected`
                : 'All expected income received'
            }
          />
        </Tile>
        <Tile className="rise p-5 sm:p-6">
          <Figure
            label="Went out"
            value={formatCurrencyAbs(summary.expense.spent)}
            note={
              summary.expense.pace == null
                ? `of ${formatCurrencyAbs(summary.expense.projected)} expected`
                : summary.expense.pace > 1.05
                  ? `${Math.round((summary.expense.pace - 1) * 100)}% above typical pace`
                  : summary.expense.pace < 0.95
                    ? `${Math.round((1 - summary.expense.pace) * 100)}% below typical pace`
                    : 'Tracking typical pace'
            }
          />
        </Tile>
        <Tile className="rise p-5 sm:p-6">
          <Figure
            label={netWorth?.knownCount > 0 ? 'Net worth' : 'Owed on cards'}
            value={
              netWorth?.knownCount > 0
                ? formatCurrency(netWorth.net)
                : formatCurrencyAbs(cardDebt)
            }
            tone={netWorth?.knownCount > 0 ? (netWorth.net < 0 ? 'text-bad' : 'text-label') : 'text-bad'}
            note={
              netWorth?.knownCount > 0
                ? `${netWorth.change >= 0 ? 'Up' : 'Down'} ${formatCurrencyAbs(netWorth.change)} over the window`
                : cardChange < 0
                  ? `Up ${formatCurrencyAbs(cardChange)} over the window`
                  : 'Add balances to see net worth'
            }
          />
        </Tile>
      </div>

      <WhereItGoes rows={spendRows} onOpenLedger={onOpenLedger} className="3xl:col-span-12" />
    </div>
  );
}
