import { useState } from 'react';
import { formatMonthLabel } from '../utils/format';
import { NetTotalRow } from './table/NetTotalRow';
import { TableGroup } from './table/TableGroup';

function nextSort(current, key) {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: key === 'group' ? 'asc' : 'desc' };
}

function SortHeader({ label, sortKey, sort, onSort, className = '' }) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 ${className}`}
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className={`text-[10px] ${active ? 'text-label-2' : 'text-label-4'}`}>
        {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </button>
  );
}

const DAY_MONTH = { day: 'numeric', month: 'short' };
const fmtDate = (d) => (d ? d.toLocaleDateString('en-ZA', DAY_MONTH) : '');

/** Inclusive date span a week column covers, clipped to the cycle end. */
function weekSpan(processed, wk) {
  const start = processed.currentCycleStart;
  if (!start) return '';
  const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + wk.index * 7);
  const from = monday < start ? start : monday;
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const to = processed.currentCycleEnd && sunday > processed.currentCycleEnd
    ? processed.currentCycleEnd
    : sunday;
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

export function TransactionTable({ processed }) {
  const [sort, setSort] = useState({ key: 'group', direction: 'asc' });
  const handleSort = (key) => setSort((current) => nextSort(current, key));
  const weeks = processed.cycleWeeks ?? [];
  const cycleEnd = fmtDate(processed.currentCycleEnd);

  return (
    <div className="glass overflow-hidden">
      <div className="max-h-[calc(100vh-14rem)] overflow-auto">
        <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky-head sticky top-0 z-20">
            {/* Which columns are things that happened, and which are guesses. */}
            <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase">
              <th className="border-b px-4 pt-3 pb-1" />
              <th
                className="border-b px-4 pt-3 pb-1 text-right"
                colSpan={processed.months.length}
              >
                Actual
              </th>
              {weeks.length > 0 && (
                <th
                  className="border-b border-l-2 border-l-info/30 bg-info/8 px-4 pt-3 pb-1 text-center text-info"
                  colSpan={weeks.length + 1}
                  title={`Forecast for the rest of this pay cycle, to ${cycleEnd}. Completed weeks are locked at what actually happened; the current week is prorated by how much of it is left.`}
                >
                  Forecast to {cycleEnd}
                </th>
              )}
              <th className="border-b px-4 pt-3 pb-1" />
            </tr>
            <tr>
              <th className="border-b px-4 pb-3">
                <SortHeader label="Group" sortKey="group" sort={sort} onSort={handleSort} />
              </th>
              {processed.months.map((m) => (
                <th
                  key={m}
                  className={`border-b px-4 pb-3 text-right ${
                    m === processed.currentMonth ? 'border-l-2 border-l-hair-strong' : ''
                  }`}
                  title={
                    m === processed.currentMonth
                      ? `This pay cycle so far — ${fmtDate(processed.currentCycleStart)} to ${fmtDate(processed.dataThrough)}`
                      : `Pay cycle ${m}`
                  }
                >
                  <SortHeader
                    label={
                      m === processed.currentMonth
                        ? 'So far'
                        : formatMonthLabel(m, processed.currentMonth)
                    }
                    sortKey={`month:${m}`}
                    sort={sort}
                    onSort={handleSort}
                    className="justify-end"
                  />
                </th>
              ))}
              {weeks.map((wk) => (
                <th
                  key={wk.index}
                  className={`border-b px-4 pb-3 text-right text-xs font-medium text-info ${
                    wk.index === weeks[0].index ? 'border-l-2 border-l-info/30' : ''
                  } ${wk.isCurrent ? 'bg-info/15' : 'bg-info/8'}`}
                  title={
                    wk.isCurrent
                      ? `This week (${weekSpan(processed, wk)}) — what's still expected before the week is out`
                      : `Week of ${weekSpan(processed, wk)} — expected, based on this category's typical spend in that week of the cycle`
                  }
                >
                  <div>{wk.isCurrent ? 'This week' : wk.label}</div>
                  <div className="font-normal text-info/80">{weekSpan(processed, wk)}</div>
                </th>
              ))}
              <th
                className="border-b bg-info/8 px-4 pb-3 text-right"
                title={`Everything still expected between now and ${cycleEnd} — the sum of the week columns.`}
              >
                <SortHeader
                  label="Left to payday"
                  sortKey="remaining"
                  sort={sort}
                  onSort={handleSort}
                  className="justify-end text-info"
                />
              </th>
              <th
                className="border-b px-4 pb-3 text-right"
                title={`Recency-weighted average over the ${processed.months.length - 1} completed pay cycles in range, with outlier cycles capped so one abnormal month can't set the level.`}
              >
                <SortHeader
                  label="Typical"
                  sortKey="avg"
                  sort={sort}
                  onSort={handleSort}
                  className="justify-end"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <NetTotalRow
              months={processed.months}
              netByMonth={processed.netByMonth}
              netExpected={processed.netExpected}
              netAvg={processed.netAvg}
              cycleWeeks={processed.cycleWeeks}
              weeklyRemaining={processed.netWeeklyRemaining}
            />
            {processed.rows.map((g) => (
              <TableGroup
                key={g.name}
                group={g}
                months={processed.months}
                sort={sort}
                cycleWeeks={processed.cycleWeeks}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t bg-fill/60 px-4 py-2 text-xs text-label-2">
        Columns left of the divider are what happened. Everything right of it is a forecast to{' '}
        {cycleEnd}: completed weeks are locked at their actuals, this week is prorated by how much
        of it is left, and later weeks carry their typical spend.
      </p>
    </div>
  );
}
