import { debtCostPerCycle } from '../../lib/debtCost';
import { formatCurrencyAbs } from '../../utils/format';
import { Card, Figure } from '../ui/Surface';

const MONTH_YEAR = { month: 'short', year: 'numeric' };
const monthYear = (d) => {
  const x = d instanceof Date ? d : d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-ZA', MONTH_YEAR) : null;
};

/**
 * What you owe, what it costs, and when it is gone — the three figures the Debt page is for, in one
 * card. The table under it says which debt is which; the plan, the charts and the what-ifs are folded
 * below that, closed until you want to see why.
 */
export function DebtLead({ terms, plan }) {
  const list = terms ?? [];
  if (!list.length) return null;
  const cost = debtCostPerCycle(list);
  const free = plan ? monthYear(plan.debtFreeDate) : null;
  return (
    <Card className="materialize grid gap-6 p-6 sm:grid-cols-3 sm:gap-8 sm:p-8">
      <Figure
        label="You owe"
        value={formatCurrencyAbs(cost.owed)}
        tone="text-bad"
        note={`${list.length} debt${list.length === 1 ? '' : 's'}${cost.unknown > 0 ? `, ${cost.unknown} without a balance` : ''}`}
      />
      <Figure
        label="It costs a cycle"
        value={formatCurrencyAbs(cost.total)}
        note={`${formatCurrencyAbs(cost.interest)} interest, ${formatCurrencyAbs(cost.fees)} fees`}
      />
      <Figure
        label="Debt-free"
        value={free ?? (plan ? 'Not in 50 years' : '—')}
        note={plan ? 'at today’s instalments, on the plan below' : 'once a debt has a balance and a rate'}
      />
    </Card>
  );
}
