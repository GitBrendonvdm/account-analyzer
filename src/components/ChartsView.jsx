import { NetTotalChart } from './charts/NetTotalChart';
import { NetWorthChart } from './charts/NetWorthChart';
import { PeriodNetChart } from './charts/PeriodNetChart';
import { Disclosure } from './ui/Disclosure';

/**
 * Trends — is net worth going up or down, month by month. That is the page; the two charts of cash
 * flow that explain it (the running total of what came in and went out, and each month's net) are
 * folded under their own bars.
 */
export function ChartsView({ chartData, trend }) {
  return (
    <div className="flex flex-col gap-3">
      {/* 16px inside the card on a phone: every pixel of width goes to the plot. */}
      <div className="glass overflow-hidden p-4 md:p-6">
        <NetWorthChart trend={trend} />
      </div>
      <div className="mt-2 flex flex-col gap-1 border-t pt-2">
        <Disclosure title="Net total over time" summary="The running total of everything that came in and went out" merge>
          <div className="glass overflow-hidden p-4 md:p-6">
            <NetTotalChart chartData={chartData?.running} />
          </div>
        </Disclosure>
        <Disclosure title="Net per month" summary="Income minus spending for each pay cycle" merge>
          <div className="glass overflow-hidden p-4 md:p-6">
            <PeriodNetChart chartData={chartData?.period} />
          </div>
        </Disclosure>
      </div>
    </div>
  );
}
