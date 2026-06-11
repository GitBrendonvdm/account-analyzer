import { NetTotalChart } from './charts/NetTotalChart';
import { PeriodNetChart } from './charts/PeriodNetChart';

export function ChartsView({ chartData }) {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border bg-white p-6">
        <NetTotalChart chartData={chartData?.running} />
      </div>
      <div className="overflow-hidden rounded-xl border bg-white p-6">
        <PeriodNetChart chartData={chartData?.period} />
      </div>
    </div>
  );
}
