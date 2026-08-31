import { useState } from 'react';
import { Card } from '../ui/Surface';
import { CashPath } from './CashPath';
import { SpendCurve } from './SpendCurve';
import { BalanceBands } from './BalanceBands';

/**
 * Cash path, spend pace and balance change all answer "what's happening with money over time" —
 * stacked as three always-on charts nothing said which to look at first. One card, one chart at a
 * time, defaulting to the cash path: it is the one with a payday estimate and something to act on.
 */

const SEGMENT = 'press rounded-full px-3.5 py-1.5 text-[12.5px] whitespace-nowrap max-md:min-h-11 max-md:flex-1';

const TABS = [
  { id: 'cashPath', label: 'Cash path' },
  { id: 'spendPace', label: 'Spend pace' },
  { id: 'balanceChange', label: 'Balance change' },
];

export function ChartSwitcher({ cashPath, incomeProfile, curve, balances, onOpenAccounts, className = '' }) {
  const [tab, setTab] = useState('cashPath');
  const available = TABS.filter((t) =>
    t.id === 'cashPath'
      ? Boolean(cashPath)
      : t.id === 'spendPace'
        ? Boolean(curve?.series?.length)
        : Boolean(balances?.series?.length),
  );
  if (!available.length) return null;
  const active = available.some((t) => t.id === tab) ? tab : available[0].id;

  return (
    <Card className={`materialize flex flex-col p-5 sm:p-8 ${className}`}>
      {available.length > 1 && (
        <div className="glass-chip mb-5 flex gap-1 self-start p-1 max-md:w-full" role="group" aria-label="Chart">
          {available.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active === t.id}
              className={`${SEGMENT} ${active === t.id ? 'bg-fill-2 font-semibold' : 'text-label-2 hover:text-label'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {active === 'cashPath' && (
        <CashPath cashPath={cashPath} incomeProfile={incomeProfile} onOpenAccounts={onOpenAccounts} />
      )}
      {active === 'spendPace' && <SpendCurve curve={curve} />}
      {active === 'balanceChange' && <BalanceBands series={balances} />}
    </Card>
  );
}
