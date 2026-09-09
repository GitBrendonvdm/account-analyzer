import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Card, CardHead } from '../ui/Surface';
import { formatCurrency } from '../../utils/format';
import { QUICK_FILTERS, findPayments } from '../../lib/paymentSearch';
import { isByRule } from '../../lib/txnRules';
import { suggestName, suggestSynonyms } from '../../lib/providers';

/**
 * Find a payment, then do something about it — search, quick filters, a flat list, and the
 * corrections applied to as many rows as you tick.
 *
 * This exists because the ledger is an aggregation. Reaching one charge means opening a group, a
 * spending group, a category, a description, sometimes a variant, and there is no way at all to ask
 * "what IS the R29 909 of exceptions". Corrections you cannot reach are corrections you will not
 * make, so the two belong on one surface: find, tick, correct.
 *
 * NOTHING HERE FILTERS THE TABLE BELOW. Searching must not move a single total — a reader typing
 * "builders" is asking where something is, not asking for a household whose spending excludes
 * everything else. This is a second view onto the same rows, and the ledger keeps every figure.
 *
 * The list is capped and says so. Ticking rows and pressing a verdict is a bulk write, so the count
 * is stated on the control itself rather than left to be inferred from a highlight.
 */

const PAGE = 200;
const DAY = { day: 'numeric', month: 'short', year: '2-digit' };
const fmtDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-ZA', DAY) : (v ?? '');
};

function Chip({ on, onClick, title, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`press min-h-11 rounded-full px-3 py-1 text-[12px] whitespace-nowrap sm:min-h-0 sm:text-[11px] ${
        on ? 'bg-fill-2 font-semibold text-label' : 'text-label-3 hover:text-label'
      }`}
    >
      {children}
    </button>
  );
}

export function PaymentFinder({
  data,
  currentMonth,
  exceptionKeys,
  overrides = {},
  choices = { categories: [], spendingGroups: [] },
  onSetTxnOverride,
  onCreateRule,
  onCreateProvider,
}) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState([]);
  const [minAmount, setMinAmount] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const min = Number(String(minAmount).replace(/[^\d.]/g, ''));
  const result = useMemo(
    () =>
      findPayments(data, {
        query,
        filters,
        minAmount: Number.isFinite(min) && min > 0 ? min : null,
        overrides,
        currentMonth,
        exceptionKeys,
        limit: PAGE,
      }),
    [data, query, filters, min, overrides, currentMonth, exceptionKeys],
  );

  const searching = Boolean(query.trim() || filters.length || (Number.isFinite(min) && min > 0));
  const toggleFilter = (id) =>
    setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const toggleRow = (key) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const shownKeys = result.rows.map((r) => r.key).filter(Boolean);
  const allShown = shownKeys.length > 0 && shownKeys.every((k) => selected.has(k));
  const keys = [...selected];

  const apply = (patch) => {
    onSetTxnOverride?.(keys, patch);
    setSelected(new Set());
  };
  const reset = () => {
    setQuery('');
    setFilters([]);
    setMinAmount('');
    setSelected(new Set());
  };

  return (
    <Card className="materialize p-4 sm:p-6">
      <CardHead
        title="Find a payment"
        subtitle="Search or filter, tick what you mean, and correct it. Nothing here changes the totals below — it is a second view onto the same rows."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="glass-chip flex min-w-0 flex-grow items-center gap-2 px-3 sm:max-w-96">
          <Search size={14} className="shrink-0 text-label-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="builders, groceries, *2000…"
            aria-label="Search payments"
            className="min-h-11 w-full bg-transparent text-base outline-none sm:min-h-0 sm:text-[13px]"
          />
        </label>
        <label className="glass-chip flex items-center gap-1.5 px-3">
          <span className="text-[11px] text-label-3">over</span>
          <span className="text-[12px] text-label-3">R</span>
          <input
            type="text"
            inputMode="numeric"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="0"
            aria-label="Minimum amount"
            className="min-h-11 w-16 bg-transparent text-base outline-none sm:min-h-0 sm:text-[13px]"
          />
        </label>
        <span className="glass-chip flex flex-wrap gap-0.5 p-0.5" role="group" aria-label="Quick filters">
          {QUICK_FILTERS.map((f) => (
            <Chip key={f.id} on={filters.includes(f.id)} title={f.hint} onClick={() => toggleFilter(f.id)}>
              {f.label}
            </Chip>
          ))}
        </span>
        {searching && (
          <button
            type="button"
            onClick={reset}
            className="press flex items-center gap-1 text-[12px] text-label-3 hover:text-label max-md:min-h-11"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {!searching ? (
        <p className="t-caption mt-4">
          Type a merchant, or pick a filter. <b className="font-semibold text-label-2">Exceptions</b> is
          the fastest way to see what the app has left out of your forecast.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t pt-3">
            <span className="text-[13px] text-label-2">
              <b className="font-semibold text-label">{result.total}</b>{' '}
              {result.total === 1 ? 'payment' : 'payments'} ·{' '}
              <b className="num font-semibold text-label">{formatCurrency(result.sum)}</b>
              {result.total > result.shown && (
                <span className="text-label-3"> · showing the {result.shown} most recent</span>
              )}
            </span>
            {shownKeys.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (allShown) shownKeys.forEach((k) => next.delete(k));
                    else shownKeys.forEach((k) => next.add(k));
                    return next;
                  })
                }
                className="press text-[12px] text-info hover:brightness-125 max-md:min-h-11"
              >
                {allShown ? 'Clear selection' : `Select these ${shownKeys.length}`}
              </button>
            )}
          </div>

          {keys.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-fill/70 p-2">
              <span className="px-1 text-[12px] text-label-2">
                {keys.length} selected — this changes whether they count toward the averages and the
                forecast:
              </span>
              <button
                type="button"
                onClick={() => apply({ flag: 'expected' })}
                className="press glass-chip min-h-11 px-3 py-1 text-[12px] sm:min-h-0"
              >
                Expected
              </button>
              <button
                type="button"
                onClick={() => apply({ flag: 'unexpected' })}
                className="press glass-chip min-h-11 px-3 py-1 text-[12px] sm:min-h-0"
              >
                Unexpected
              </button>
              <select
                value=""
                onChange={(e) => e.target.value && apply({ category: e.target.value })}
                aria-label={`Move ${keys.length} payments to another category`}
                className="glass-chip min-h-11 max-w-44 rounded-full px-3 py-1 text-[12px] text-label sm:min-h-0"
              >
                <option value="">Move to…</option>
                {choices.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => apply({ flag: null, category: null, spendingGroup: null })}
                className="press text-[12px] text-label-3 hover:text-label max-md:min-h-11"
              >
                Reset
              </button>
              {onCreateProvider && (
                <button
                  type="button"
                  onClick={() => {
                    const names = result.rows.filter((r) => selected.has(r.key)).map((r) => r.Description);
                    onCreateProvider({ name: suggestName(names), synonyms: suggestSynonyms(names) });
                  }}
                  title="Fold these branch names onto one shop, so the ledger has one row for it and its forecast has all of its history"
                  className="press glass-chip min-h-11 px-3 py-1 text-[12px] text-info sm:min-h-0"
                >
                  Group as a provider
                </button>
              )}
              {onCreateRule && query.trim() && (
                <button
                  type="button"
                  onClick={() => onCreateRule({ description: query.trim() })}
                  title="Make this a standing rule, so it keeps applying to payments imported later"
                  className="press glass-chip min-h-11 px-3 py-1 text-[12px] text-info sm:min-h-0"
                >
                  Make a rule instead
                </button>
              )}
            </div>
          )}

          <ul className="mt-3 flex flex-col">
            {result.rows.length === 0 && <li className="t-caption py-3">Nothing matches.</li>}
            {result.rows.map((t) => {
              const on = t.key ? selected.has(t.key) : false;
              const override = t.key ? overrides?.[t.key] : null;
              return (
                <li
                  key={t.key ?? `${t.Date}-${t.Description}`}
                  className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t py-2 text-[13px] ${
                    on ? 'bg-fill/60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!t.key}
                    onChange={() => t.key && toggleRow(t.key)}
                    aria-label={`Select ${t.Description}`}
                    className="h-4 w-4 accent-info"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-label">{t.Description}</div>
                    <div className="t-caption truncate">
                      {fmtDate(t.Date)} · {t.Category || 'Uncategorised'} · {t.Account}
                      {override && (
                        <span className="ml-1.5 text-info">
                          · {isByRule(t, overrides) ? 'by rule' : 'corrected'}
                          {override.flag ? ` (${override.flag})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`num font-medium ${t.AmountNum > 0 ? 'text-good' : 'text-label'}`}>
                    {formatCurrency(t.AmountNum)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
