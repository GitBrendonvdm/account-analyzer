import { TrendingDown, TrendingUp } from 'lucide-react';
import { accountLabel } from '../../db/accountIdentity';
import { formatCurrency, formatCurrencyAbs } from '../../utils/format';
import { Card } from '../ui/Surface';

/**
 * The two answers the front page is for, each in one card you can read in a second:
 *
 *   Net worth      — the number, whether it is up or down this cycle, and a bar per month.
 *   Everyday money — whether the cheque account and the card spend more than they take in, and a bar
 *                    per cycle.
 *
 * Bars rise from a zero line: green above it (up, or money to spare), red below (down, or short),
 * and the cycle still in progress is drawn faint because it is not finished.
 */

const monthLabel = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'short' });
};

function Bars({ rows, label }) {
  const half = 30;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="mt-5 flex gap-2" role="img" aria-label={label}>
      {rows.map((r) => {
        const h = Math.max(2, (Math.abs(r.value) / max) * half);
        const up = r.value >= 0;
        return (
          <div
            key={r.month}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            title={`${monthLabel(r.month)}${r.partial ? ' so far' : ''}: ${formatCurrency(r.value)}`}
          >
            <div className="relative h-16 w-full">
              <div className="absolute inset-x-0 top-1/2 border-t border-hair" />
              <div
                className="absolute left-1/2 w-6 -translate-x-1/2 rounded-[3px]"
                style={{
                  height: h,
                  [up ? 'bottom' : 'top']: '50%',
                  background: up ? 'var(--color-good)' : 'var(--color-bad)',
                  opacity: r.partial ? 0.45 : 1,
                }}
              />
            </div>
            <span className="t-caption">{monthLabel(r.month)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function NetWorthTile({ trend, onOpenAccounts, className = '' }) {
  if (!trend) return null;
  const up = trend.sinceLast >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Card className={`materialize p-6 sm:p-8 ${className}`}>
      <div className="t-label">Net worth</div>
      <div className={`num mt-2.5 text-[2.5rem] leading-none font-semibold tracking-tight whitespace-nowrap ${trend.now < 0 ? 'text-bad' : 'text-label'}`}>
        {formatCurrency(trend.now)}
      </div>
      <div className={`mt-3 flex items-center gap-2 text-[15px] font-medium ${up ? 'text-good' : 'text-bad'}`}>
        <Icon size={16} />
        {up ? 'Up' : 'Down'} {formatCurrencyAbs(trend.sinceLast)} so far this cycle
      </div>
      {trend.of > 0 && (
        <p className="t-caption mt-1">
          Up in {trend.up} of the last {trend.of} full cycles
        </p>
      )}
      <Bars rows={trend.rows.map((r) => ({ month: r.month, value: r.change, partial: r.partial }))} label="Change in net worth each cycle" />
      {trend.estimated.length > 0 && (
        <p className="t-caption mt-2">Includes an estimate for {trend.estimated.join(', ')}.</p>
      )}
      {!trend.complete && (
        <p className="t-caption mt-2 text-warn">
          {trend.missing.length} account{trend.missing.length === 1 ? '' : 's'} without a balance, so not counted.{' '}
          {onOpenAccounts && (
            <button type="button" onClick={onOpenAccounts} className="press text-info hover:brightness-125 max-md:min-h-11">
              Add them
            </button>
          )}
        </p>
      )}
    </Card>
  );
}

const HEADLINE = {
  short: 'Spending more than comes in',
  ahead: 'Spending less than comes in',
  even: 'Spending about what comes in',
};
const TONE = { short: 'text-bad', ahead: 'text-good', even: 'text-label' };

/** "A and B", or "A, B and C"; accounts closed lately are counted, not listed. */
function namesOf(accounts) {
  const open = accounts.filter((a) => !a.closedOn).map(accountLabel);
  const closed = accounts.length - open.length;
  const list = open.length > 1 ? `${open.slice(0, -1).join(', ')} and ${open[open.length - 1]}` : (open[0] ?? 'Your accounts');
  return closed > 0 ? `${list}, and ${closed} account${closed === 1 ? '' : 's'} closed lately` : list;
}

export function EverydayTile({ flow, accounts = [], className = '' }) {
  if (!flow) return null;
  const { typical, verdict } = flow;
  const current = flow.rows.find((r) => r.partial);
  return (
    <Card className={`materialize p-6 sm:p-8 ${className}`}>
      <div className="t-label">Everyday accounts</div>
      {typical ? (
        <>
          <div className={`mt-2.5 text-[1.6rem] leading-tight font-semibold tracking-tight ${TONE[verdict]}`}>{HEADLINE[verdict]}</div>
          <div className={`num mt-3 text-[15px] font-medium ${TONE[verdict]}`}>
            {verdict === 'even'
              ? 'Within a few rand of even a cycle'
              : `${formatCurrencyAbs(typical.net)} ${verdict === 'short' ? 'short' : 'to spare'} in a typical cycle`}
          </div>
          <p className="t-caption mt-1">
            In {formatCurrencyAbs(typical.income)} · out {formatCurrencyAbs(typical.spend)} a cycle
            {flow.shortCycles > 0 && ` · ${flow.shortCycles} of the last ${flow.cycles} ended short`}
          </p>
        </>
      ) : (
        <p className="mt-2.5 text-[15px] text-label-2">Not enough finished cycles yet to say.</p>
      )}
      <Bars rows={flow.rows.map((r) => ({ month: r.month, value: r.net, partial: r.partial }))} label="Money in minus money out each cycle" />
      <p className="t-caption mt-2">
        {current && `This cycle so far: in ${formatCurrencyAbs(current.income)}, out ${formatCurrencyAbs(current.spend)}. `}
        {accounts.length > 0 && `${namesOf(accounts)}; moves between your own accounts are left out.`}
      </p>
    </Card>
  );
}
