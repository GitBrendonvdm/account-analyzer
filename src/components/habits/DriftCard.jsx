import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * What changed — categories whose recent cycles sit outside their own usual range.
 *
 * This replaces the movers block, which compared the mean of the last half of the window with
 * the mean of the first half. A mean is exactly the wrong statistic for a category that has one
 * R10 000 month in twelve: the half containing it "rises", and the block reported a habit where
 * there was a single event. The drift library uses the median and a robust spread instead, so a
 * category is listed only when its last three cycles are well outside what it has done before
 * — "well" at 2.5 spreads, "far" at 4.
 *
 * It is presented as what changed and never as money found: groceries being R600 a cycle above
 * the usual is a fact about the household, not a saving anyone has agreed to make. The bar strip
 * under each row draws the baseline in the quiet fill and the recent cycles in blue, so the step
 * is visible without reading the z.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Strip({ series, recent }) {
  const values = (series ?? []).filter((s) => s && Number.isFinite(s.total));
  if (!values.length) return null;
  const max = Math.max(...values.map((s) => Math.abs(s.total)), 1);
  const recentSet = new Set(recent ?? []);
  return (
    <span className="inline-flex h-7 items-end gap-0.5" aria-hidden="true">
      {values.map((s) => (
        <span
          key={s.month}
          className="w-1.5 rounded-sm"
          style={{
            height: `${Math.max(8, (Math.abs(s.total) / max) * 100)}%`,
            background: recentSet.has(s.month) ? 'var(--color-info)' : 'var(--color-fill-2)',
          }}
          title={`${s.month}: ${formatCurrencyAbs(s.total)}`}
        />
      ))}
    </span>
  );
}

function DriftRow({ row, recent }) {
  const up = row.direction === 'up';
  const how = Math.abs(row.z ?? 0) >= 4 ? 'far' : 'well';
  return (
    <li className="flex flex-col gap-2 border-t px-6 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex items-center gap-1 text-[13px] font-semibold ${up ? 'text-bad' : 'text-good'}`}>
          {up ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          {up ? '+' : '−'}
          {formatCurrencyAbs(row.delta)} a cycle
        </span>
        <span className="min-w-0 flex-grow text-[14.5px] text-label-2">
          {row.category}: {formatCurrencyAbs(row.recentMedian)} a cycle, {how} outside the usual{' '}
          {formatCurrencyAbs(row.baselineMedian)} ± {formatCurrencyAbs(row.baselineSd)}
        </span>
        <Strip series={row.series} recent={recent} />
      </div>
      {row.topMerchants?.length > 0 && (
        <div className="t-caption">
          Mostly {row.topMerchants.slice(0, 2).map((m) => `${m.label} (${formatCurrencyAbs(m.recentPerCycle)} a cycle)`).join(' and ')}
          {Number.isFinite(row.share) && ` · ${Math.round(row.share * 100)}% of recent spend`}
        </div>
      )}
    </li>
  );
}

export function DriftCard({ drift, className = '' }) {
  if (!drift) return null;
  const flagged = drift.flagged ?? [];
  const recentN = drift.recent?.length ?? 3;
  const baselineN = drift.baseline?.length ?? 12;

  return (
    <Card className={`materialize overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
        <CardHead
          title="What changed"
          subtitle={`The last ${plural(recentN, 'cycle')} against the median of the ${baselineN} before them. What moved outside its usual range — an explanation, not money found.`}
        />
        {(drift.upPerCycle > 0 || drift.downPerCycle > 0) && (
          <div className="shrink-0 text-right">
            <div className="num text-[15px] font-semibold">
              <span className="text-bad">+{formatCurrencyAbs(drift.upPerCycle ?? 0)}</span>
              <span className="mx-1.5 text-label-4">/</span>
              <span className="text-good">−{formatCurrencyAbs(drift.downPerCycle ?? 0)}</span>
            </div>
            <div className="t-caption">up / down, a cycle</div>
          </div>
        )}
      </div>
      {flagged.length === 0 ? (
        <p className="t-caption px-6 py-5">Nothing has moved outside its usual range over the last {plural(recentN, 'cycle')}.</p>
      ) : (
        <ol className="flex flex-col">
          {flagged.map((row) => (
            <DriftRow key={row.category} row={row} recent={drift.recent} />
          ))}
        </ol>
      )}
      {drift.assumptions?.length > 0 && <p className="t-caption border-t px-6 py-4">{drift.assumptions.join(' ')}</p>}
    </Card>
  );
}
