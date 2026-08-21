import { NetTotalChart } from './charts/NetTotalChart';
import { PeriodNetChart } from './charts/PeriodNetChart';

export function ChartsView({ chartData }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="glass overflow-hidden p-6">
        <NetTotalChart chartData={chartData?.running} />
      </div>
      <div className="glass overflow-hidden p-6">
        <PeriodNetChart chartData={chartData?.period} />
      </div>
    </div>
  );
}
