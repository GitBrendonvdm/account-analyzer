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
      <span className={`text-[10px] ${active ? 'text-slate-700' : 'text-slate-300'}`}>
        {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </button>
  );
}

export function TransactionTable({ processed }) {
  const [sort, setSort] = useState({ key: 'group', direction: 'asc' });
  const handleSort = (key) => setSort((current) => nextSort(current, key));

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="border-b bg-slate-50">
            <tr>
              <th className="p-4">
                <SortHeader label="Group" sortKey="group" sort={sort} onSort={handleSort} />
              </th>
              {processed.months.map((m) => (
                <th
                  key={m}
                  className={`p-4 text-right ${
                    m === processed.currentMonth ? 'border-l-2 border-slate-300' : ''
                  }`}
                >
                  <SortHeader
                    label={formatMonthLabel(m, processed.currentMonth)}
                    sortKey={`month:${m}`}
                    sort={sort}
                    onSort={handleSort}
                    className="justify-end"
                  />
                </th>
              ))}
              <th className="p-4 text-right">
                <SortHeader
                  label="Remaining"
                  sortKey="remaining"
                  sort={sort}
                  onSort={handleSort}
                  className="justify-end"
                />
              </th>
              <th className="p-4 text-right">
                <SortHeader
                  label="Avg"
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
            />
            {processed.rows.map((g) => (
              <TableGroup key={g.name} group={g} months={processed.months} sort={sort} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
