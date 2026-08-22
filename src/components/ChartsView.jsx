import { NetTotalChart } from './charts/NetTotalChart';
import { PeriodNetChart } from './charts/PeriodNetChart';

export function ChartsView({ chartData }) {
  return (
    <div className="flex flex-col gap-5">
      {/* 16px inside the card on a phone: every pixel of width goes to the plot. */}
      <div className="glass overflow-hidden p-4 md:p-6">
        <NetTotalChart chartData={chartData?.running} />
      </div>
      <div className="glass overflow-hidden p-4 md:p-6">
        <PeriodNetChart chartData={chartData?.period} />
      </div>
    </div>
  );
}
