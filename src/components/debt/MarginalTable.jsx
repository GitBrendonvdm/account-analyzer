import { useState } from 'react';
import { CardHead } from '../ui/Surface';
import { formatCurrencyAbs } from '../../utils/format';

/**
 * What R1 000 is worth on each debt — once, or every month.
 *
 * Base and alternative differ ONLY in that rand, under the same strategy, order, cascade and
 * inflows, so the row is a fair comparison and not a strategy argument in disguise. Two horizons
 * because they disagree: this year the highest rate wins, over a lifetime a long bond's small rate
 * compounds further — and the sentence says when that lifetime saving actually arrives, because a
 * saving in 2055 is not the same thing as one in 2027. The rank chips show where snowball and
 * avalanche would have sent it when they disagree with the money.
 */

const YEAR = { year: 'numeric' };
const toDate = (d) => (d instanceof Date ? d : d ? new Date(d) : null);
const fmtYear = (d) => {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-ZA', YEAR) : null;
};
const money = (v) => (Number.isFinite(v) ? formatCurrencyAbs(v) : '—');
const months = (n) => (Number.isFinite(n) ? `${n}` : '—');

const MODES = [
  { id: 'once', label: 'Once' },
  { id: 'monthly', label: 'Every month' },
];

export function MarginalTable({ rows = [], plan, labelsById = {}, amount = 1000 }) {
  const [mode, setMode] = useState('once');
  const once = mode === 'once';
  const name = (id, fallback) => labelsById[id] ?? fallback ?? id;

  const keyed = rows.map((r) => ({
    ...r,
    label: name(r.id, r.label),
    short: once ? r.lump12 : r.monthly12,
    life: once ? r.lumpLife : r.monthlyLife,
    saved: once ? r.monthsSavedLump : r.monthsSavedMonthly,
  }));
  const sorted = keyed.slice().sort((a, b) => (b.short ?? -Infinity) - (a.short ?? -Infinity));
  const maxShort = Math.max(1, ...sorted.map((r) => r.short ?? 0));
  const top12 = sorted[0];
  const topLife = keyed.slice().sort((a, b) => (b.life ?? -Infinity) - (a.life ?? -Infinity))[0];
  // "Not before {year}" only earns its place when that year is not the coming one.
  const topLifeEntry = topLife ? plan?.perDebt?.[topLife.id] : null;
  const lifeYear = topLifeEntry?.clearedMonth > 12 ? fmtYear(topLifeEntry.clearedDate) : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
        <CardHead
          title={`What ${formatCurrencyAbs(amount)} is worth`}
          subtitle="Interest avoided by sending that rand to each debt, under the same plan either way."
        />
        <div className="glass-chip flex shrink-0 gap-1 p-1" role="group" aria-label="Once or every month">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={`press rounded-full px-3.5 py-1.5 text-[12.5px] ${
                mode === m.id ? 'bg-fill-2 font-semibold' : 'text-label-2 hover:text-label'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="t-caption px-6 py-5">Nothing to compare until a debt has a balance and a rate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold tracking-wide text-label-2 uppercase">
                <th className="px-6 py-2.5">Debt</th>
                <th className="px-4 py-2.5">This year</th>
                <th className="px-4 py-2.5 text-right">Over its life</th>
                <th className="px-4 py-2.5 text-right">Months saved</th>
                {once && <th className="px-4 py-2.5 text-right">Fees saved</th>}
                <th className="px-4 py-2.5">Where the rules send it</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const chips = [];
                if (Number.isFinite(r.rankSnowball) && r.rankSnowball !== i + 1) chips.push(`snowball #${r.rankSnowball}`);
                if (Number.isFinite(r.rankAvalanche) && r.rankAvalanche !== i + 1) chips.push(`avalanche #${r.rankAvalanche}`);
                if (Number.isFinite(r.rankLife) && r.rankLife !== i + 1) chips.push(`lifetime #${r.rankLife}`);
                return (
                  <tr key={r.id ?? r.label} className="border-t">
                    <td className="px-6 py-3">
                      <span className="num mr-2 text-label-4">{i + 1}</span>
                      <span className="text-[14.5px] text-label">{r.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="block h-1.5 w-28 overflow-hidden rounded-full bg-fill">
                          <span
                            className="block h-full rounded-full bg-info"
                            style={{ width: `${Math.max(2, ((r.short ?? 0) / maxShort) * 100)}%` }}
                          />
                        </span>
                        <span className="num text-[14.5px] font-semibold text-label">{money(r.short)}</span>
                      </div>
                    </td>
                    <td className="num px-4 py-3 text-right text-[14.5px]">{money(r.life)}</td>
                    <td className="num px-4 py-3 text-right text-[14.5px]">{months(r.saved)}</td>
                    {once && <td className="num px-4 py-3 text-right text-[13px] text-label-2">{money(r.feeSavedLife)}</td>}
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        {chips.length === 0 ? (
                          <span className="t-caption">agree</span>
                        ) : (
                          chips.map((c) => (
                            <span key={c} className="rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-label-2">
                              {c}
                            </span>
                          ))
                        )}
                        {Number.isFinite(r.cashReliefMonths) && r.cashReliefMonths > 0 && (
                          <span className="rounded bg-fill px-1.5 py-0.5 text-[10.5px] text-good">
                            relief {r.cashReliefMonths} mo sooner
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {top12 && topLife && (
        <p className="border-t px-6 py-5 text-[14.5px] leading-relaxed text-label">
          Short term, {formatCurrencyAbs(amount)} {once ? 'on' : 'a month on'} the {top12.label} avoids{' '}
          <b className="num font-semibold">{money(top12.short)}</b> of interest this year; over its life the same rand
          on the {topLife.label} avoids about <b className="num font-semibold">{money(topLife.life)}</b>
          {lifeYear ? ` — but not before ${lifeYear}.` : '.'}
        </p>
      )}
    </div>
  );
}
