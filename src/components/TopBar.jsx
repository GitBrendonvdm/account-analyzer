import { useCallback, useState } from 'react';
import { Check, Download, Loader2, LogOut, Upload } from 'lucide-react';
import { accountLabel } from '../db/accountIdentity';

const VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'table', label: 'Ledger' },
  { id: 'charts', label: 'Trends' },
  { id: 'habits', label: 'Habits' },
  { id: 'plan', label: 'Plan' },
  { id: 'debt', label: 'Debt' },
  { id: 'accounts', label: 'Accounts' },
];

/**
 * Floating chrome: a translucent bar with the content scrolling underneath, rather than an opaque
 * strip that permanently eats a band of the window.
 *
 * The view switcher is a segmented control — one row, current state obvious, no icons needed
 * because five short words are faster to read than five glyphs.
 */
export function TopBar({
  activeView,
  onViewChange,
  accounts,
  selectedIds,
  onToggleAccount,
  onFileUpload,
  importing,
  monthRange,
  onMonthRangeChange,
  availableMonthCount,
  dataThrough,
  staleLevel,
  exportUrl,
  onSignOut,
  extraControls = null,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftRange, setDraftRange] = useState(monthRange);
  const [syncedFrom, setSyncedFrom] = useState(monthRange);
  if (syncedFrom !== monthRange) {
    setSyncedFrom(monthRange);
    setDraftRange(monthRange);
  }

  const commitRange = useCallback(() => {
    if (draftRange !== monthRange) onMonthRangeChange(draftRange);
  }, [draftRange, monthRange, onMonthRangeChange]);

  const allOn = accounts.length > 0 && selectedIds.length === accounts.length;
  const dot =
    staleLevel === 'alarm' ? 'bg-bad' : staleLevel === 'warn' ? 'bg-warn' : 'bg-good';

  return (
    <div className="sticky top-0 z-40">
      <div className="chrome-fade pointer-events-none absolute inset-x-0 -top-6 h-16" />
      <div className="relative flex flex-wrap items-center justify-between gap-3 px-1 py-4">
        <div className="flex items-center gap-3">
          <span
            className="block h-[30px] w-[30px] rounded-[9px]"
            style={{ background: 'linear-gradient(160deg,#5e5ce6,#0a84ff)' }}
          />
          <span className="t-sub">Money</span>
        </div>

        <nav className="glass-chip flex gap-1 p-1" aria-label="Views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onViewChange(v.id)}
              aria-current={activeView === v.id ? 'page' : undefined}
              className={`press rounded-full px-[18px] py-2 text-[13px] ${
                activeView === v.id
                  ? 'bg-fill-2 font-semibold text-label'
                  : 'text-label-2 hover:bg-fill hover:text-label'
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="glass-chip press flex items-center gap-2 px-4 py-2 text-[12.5px] text-label-2 hover:text-label"
          >
            <span className={`block h-1.5 w-1.5 rounded-full ${dot}`} />
            {dataThrough
              ? `Updated ${dataThrough.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`
              : 'No data'}
            <span className="text-label-4">·</span>
            {allOn ? 'All accounts' : `${selectedIds.length} of ${accounts.length}`}
          </button>

          {extraControls}

          {/* The whole transaction set as one CSV — the backup that no browser profile can lose. */}
          {exportUrl && (
            <a
              href={exportUrl}
              download="transactions-export.csv"
              title="Download every transaction as CSV"
              className="glass-chip press flex items-center gap-2 px-3.5 py-2 text-[12.5px] text-label-2 hover:text-label"
            >
              <Download size={14} />
              Export
            </a>
          )}

          <label className="press flex cursor-pointer items-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110">
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {importing ? 'Importing' : 'Import'}
            <input
              type="file"
              accept=".csv,.txt,.ofx,.qif"
              className="hidden"
              onChange={onFileUpload}
              disabled={importing}
            />
          </label>

          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="glass-chip press flex items-center p-2 text-label-3 hover:text-label"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>

      {filtersOpen && (
        <div className="materialize glass mt-1 flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
          <div className="flex items-center gap-3">
            <span className="t-label whitespace-nowrap">{draftRange} cycles</span>
            <input
              type="range"
              min="3"
              max={Math.max(3, availableMonthCount)}
              value={draftRange}
              onChange={(e) => setDraftRange(parseInt(e.target.value, 10))}
              onPointerUp={commitRange}
              onKeyUp={commitRange}
              className="w-40 accent-info"
              aria-label="How many pay cycles to show"
            />
          </div>
          <div className="h-6 w-px bg-hair" />
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => {
              const on = selectedIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onToggleAccount(a.id)}
                  aria-pressed={on}
                  title={a.seenNames?.length > 1 ? `Also exported as ${a.seenNames.join(', ')}` : a.rawName}
                  className={`press flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] ${
                    on
                      ? 'border-transparent bg-fill-2 text-label'
                      : 'border-hair text-label-3 hover:text-label-2'
                  }`}
                >
                  {on && <Check size={12} />}
                  {accountLabel(a)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
