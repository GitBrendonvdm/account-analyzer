import { Sparkles, TrendingDown } from 'lucide-react';
import { Tile } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * New charges and wins — the two ends of a standing charge's life.
 *
 * A new monthly charge is the thing most worth a glance and the hardest to notice in a category
 * total: R199 appearing in "Software & Services" moves nothing visible. The recurring engine sees
 * a line whose first charge is recent, and the card says so in the plainest words it can — "charged
 * twice, about a month apart" when that is all it is, and a trial that converted when a R1 charge
 * was followed by the full price a month later. The tile turns amber only for a line big enough and
 * regular enough to be sure about.
 *
 * The wins tile is the other direction: lines that stopped, and lines that got cheaper, with what
 * that has saved so far. Cancelling a subscription is the one financial act that feels like
 * nothing happened; a running total is the acknowledgement.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const monthLabel = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
  const m = /^(\d{4})-(\d{2})/.exec(String(v));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
};

export function WinsCard({ subscriptions, className = '' }) {
  if (!subscriptions) return null;
  const newLines = subscriptions.newLines ?? [];
  const lapsed = subscriptions.lapsedLines ?? [];
  const downgrades = subscriptions.downgrades ?? [];
  const headline = newLines.some((l) => l.headline);
  const since = subscriptions.newSince?.label ?? monthLabel(subscriptions.newSince?.cycle ?? subscriptions.newSince?.start);
  const winsSentence =
    subscriptions.winsSentence ??
    `You stopped ${plural(lapsed.length, 'subscription')} and ${downgrades.length} got cheaper: ${formatCurrencyAbs(subscriptions.realisedPerCycle ?? 0)} a cycle, ${formatCurrencyAbs(subscriptions.realisedSoFar ?? 0)} saved so far.`;

  return (
    <div className={`grid gap-4 lg:grid-cols-2 ${className}`}>
      <Tile className="rise p-6">
        <div className={`flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] uppercase ${headline ? 'text-warn' : 'text-label-3'}`}>
          <Sparkles size={12} />
          {since ? `New since ${since}` : 'New charges'}
        </div>
        {newLines.length === 0 ? (
          <p className="t-caption mt-3">No new standing charge in the last few cycles.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {newLines.map((l) => (
              <li key={l.id ?? l.label} className={`text-[14px] ${l.headline ? 'text-label' : 'text-label-2'}`}>
                {l.sentence ?? `${l.label}: ${l.wording ?? 'new charge'} — ${formatCurrencyAbs(l.perCycle)} a cycle`}
                {l.trialConverted && (
                  <span className="ml-2 rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-warn">trial converted</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tile>

      <Tile className="rise p-6">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-good uppercase">
          <TrendingDown size={12} />
          Wins
        </div>
        <p className="mt-3 text-[14.5px] text-label">{winsSentence}</p>
        {(lapsed.length > 0 || downgrades.length > 0) && (
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-label-2">
            {lapsed.map((l) => (
              <li key={l.id ?? l.label}>
                {l.label} — stopped{l.since ? ` ${monthLabel(l.since)}` : ''}
                {l.byOverride ? ' (marked cancelled)' : ''}, {formatCurrencyAbs(l.savedPerCycle)} a cycle
              </li>
            ))}
            {downgrades.map((l) => (
              <li key={l.id ?? l.label}>
                {l.label} — cheaper{l.since ? ` since ${monthLabel(l.since)}` : ''}, {formatCurrencyAbs(l.savedPerCycle)} a cycle
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </div>
  );
}
