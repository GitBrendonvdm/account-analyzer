import { AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import { Card, Figure, Tile } from './ui/Surface';
import { CycleDial } from './today/CycleDial';
import { SpendCurve } from './today/SpendCurve';
import { formatCurrency, formatCurrencyAbs } from '../utils/format';

const DAY_MONTH = { day: 'numeric', month: 'short' };
const fmt = (d) => (d ? d.toLocaleDateString('en-ZA', DAY_MONTH) : '—');

/** The bar colours for "where it goes" — semantic first, then a stable rotation. */
const BAR_TONES = ['#5e5ce6', '#0a84ff', '#63e6e2', '#ff9f0a', '#ff375f', '#30d158'];

function WhereItGoes({ rows, onOpenLedger, className = '' }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <Card className={`materialize p-7 sm:p-8 ${className}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="t-head">Where it goes</h2>
        <button
          type="button"
          onClick={onOpenLedger}
          className="press flex items-center gap-1.5 text-[13px] font-medium text-info hover:brightness-125"
        >
          All transactions
          <ArrowRight size={13} />
        </button>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        {rows.map((r, i) => (
          <div key={r.name} className="flex items-center gap-4">
            <span className="w-[168px] shrink-0 truncate text-[14.5px]" title={r.name}>
              {r.name}
            </span>
            <span className="block h-2.5 flex-grow overflow-hidden rounded-full bg-fill">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(2, (r.amount / max) * 100)}%`,
                  background: r.tone ?? BAR_TONES[i % BAR_TONES.length],
                  transition: 'width 700ms var(--ease-out)',
                }}
              />
            </span>
            <span className="num w-[92px] shrink-0 text-right text-[14.5px] font-semibold">
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
 */
export function TodayView({ summary, safe, curve, netWorth, costOfDebt, positions, habits, onOpenLedger }) {
  if (!summary) return null;

  const negative = (safe?.safe ?? 0) <= 0;
  const cards = positions.filter((p) => p.type === 'Credit Card');
  const cardDebt = cards.reduce((s, p) => s + Math.min(0, p.positionByMonth?.[p.currentMonthKey] ?? 0), 0);
  const cardChange = cards.reduce((s, p) => s + (p.windowChange ?? 0), 0);

  const spendRows = [];
  if (costOfDebt?.perCycle > 0) {
    spendRows.push({ name: 'Interest & fees', amount: costOfDebt.perCycle, tone: 'var(--color-bad)' });
  }
  (habits?.movers ?? [])
    .slice()
    .sort((a, b) => b.perCycle - a.perCycle)
    .slice(0, 5)
    .forEach((m) => spendRows.push({ name: m.category, amount: m.perCycle }));

  return (
    /* On an ultrawide a column of full-width bands strands the content in empty space, so past
       1800px the page becomes a 12-track grid and the blocks pair up instead of stacking. */
    <div className="grid grid-cols-1 gap-5 3xl:grid-cols-12">
      {/* hero */}
      <Card className="materialize grid items-center gap-10 p-8 sm:p-10 lg:grid-cols-[1.1fr_0.9fr] 3xl:col-span-7 3xl:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="t-label">Safe to spend before payday</div>
          <div className={`t-hero num mt-2.5 ${negative ? 'text-bad' : 'text-good'}`}>
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
            {summary.staleLevel !== 'fresh' && (
              <span
                className={`glass-chip flex items-center gap-2 px-[15px] py-2.5 text-[13px] ${
                  summary.staleLevel === 'alarm' ? 'text-bad' : 'text-warn'
                }`}
              >
                <Clock size={13} />
                {summary.staleDays} days behind
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-3">
          <CycleDial day={summary.cycleDay} length={summary.cycleLength} />
          <div className="t-caption">
            {fmt(summary.start)} – {fmt(summary.end)}
          </div>
        </div>
      </Card>

      {curve && (
        <Card className="materialize p-7 sm:p-8 3xl:col-span-5 3xl:flex 3xl:flex-col 3xl:justify-center">
          <SpendCurve curve={curve} />
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3 3xl:col-span-5 3xl:grid-cols-1">
        <Tile className="rise p-6">
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
        <Tile className="rise p-6">
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
        <Tile className="rise p-6">
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

      <WhereItGoes rows={spendRows} onOpenLedger={onOpenLedger} className="3xl:col-span-7" />
    </div>
  );
}
