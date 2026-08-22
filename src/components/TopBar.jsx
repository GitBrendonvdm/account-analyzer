import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Download,
  Ellipsis,
  Landmark,
  Loader2,
  LogOut,
  Repeat,
  Sun,
  Table2,
  Target,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import { accountLabel } from '../db/accountIdentity';

const VIEWS = [
  { id: 'today', label: 'Today', Icon: Sun },
  { id: 'table', label: 'Ledger', Icon: Table2 },
  { id: 'charts', label: 'Trends', Icon: TrendingUp },
  { id: 'habits', label: 'Habits', Icon: Repeat },
  { id: 'plan', label: 'Plan', Icon: Target },
  { id: 'debt', label: 'Debt', Icon: Landmark },
  { id: 'accounts', label: 'Accounts', Icon: Wallet },
];


/**
 * Floating chrome: a translucent bar with the content scrolling underneath, rather than an opaque
 * strip that permanently eats a band of the window.
 *
 * From md up the view switcher is a segmented control — one row, current state obvious, no icons
 * needed because seven short words are faster to read than seven glyphs. On a phone seven words do
 * not fit in 360px, and a segmented control that forces the page wider than the screen makes the
 * browser zoom the whole app out to fit it. So below md the views move to an iOS-style tab bar
 * pinned to the bottom of the screen — icon over an 11px label, seven across, the thumb's reach —
 * and the top row keeps only the wordmark, the status chip and a "more" button that drops the
 * Import / Account summary / Export / sign-out actions down as a menu.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftRange, setDraftRange] = useState(monthRange);
  const [syncedFrom, setSyncedFrom] = useState(monthRange);
  if (syncedFrom !== monthRange) {
    setSyncedFrom(monthRange);
    setDraftRange(monthRange);
  }

  const commitRange = useCallback(() => {
    if (draftRange !== monthRange) onMonthRangeChange(draftRange);
  }, [draftRange, monthRange, onMonthRangeChange]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const allOn = accounts.length > 0 && selectedIds.length === accounts.length;
  const dot = staleLevel === 'alarm' ? 'bg-bad' : staleLevel === 'warn' ? 'bg-warn' : 'bg-good';
  const throughLabel = dataThrough
    ? dataThrough.toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'short',
      })
    : null;

  // One set of actions, laid out two ways. The chips keep their desktop look; on a phone the same
  // elements stack as full-width rows inside the dropped-down menu. The menu is display:none when
  // closed rather than unmounted so the statement-upload control inside it keeps its state (and
  // its preview sheet) across the menu opening and closing.
  const rowItem = 'max-md:min-h-11 max-md:w-full max-md:text-[14px]';

  return (
    <div className="sticky top-0 z-40" data-shell>
      <div className="chrome-fade pointer-events-none absolute inset-x-0 -top-6 h-16" />
      <div className="relative flex flex-wrap items-center justify-between gap-3 px-1 py-3 md:py-4">
        <div className="flex items-center gap-3">
          <span
            className="block h-[30px] w-[30px] rounded-[9px]"
            style={{ background: 'linear-gradient(160deg,#5e5ce6,#0a84ff)' }}
          />
          <span className="t-sub">Money</span>
        </div>

        <nav className="glass-chip hidden gap-1 p-1 md:flex" aria-label="Views">
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

        {/* One flex item on desktop (status chip, then the actions) so the row keeps its three-way
            spacing; on a phone the actions leave the flow and drop down as a menu. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="glass-chip press flex items-center gap-2 px-4 py-2 text-[12.5px] text-label-2 hover:text-label max-md:min-h-11"
          >
            <span className={`block h-1.5 w-1.5 rounded-full ${dot}`} />
            {throughLabel ? (
              <>
                <span className="hidden md:inline">Updated </span>
                {throughLabel}
              </>
            ) : (
              'No data'
            )}
            <span className="text-label-4">·</span>
            {allOn ? (
              <>
                <span className="md:hidden">All</span>
                <span className="hidden md:inline">All accounts</span>
              </>
            ) : (
              `${selectedIds.length} of ${accounts.length}`
            )}
          </button>

          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-label="More"
            className="glass-chip press flex h-11 w-11 items-center justify-center text-label-2 hover:text-label md:hidden"
          >
            <Ellipsis size={18} />
          </button>

          {menuOpen && (
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-10 cursor-default bg-ground/60 md:hidden"
            />
          )}

          {/* No blur on the phone menu's material: a backdrop-filter on an ancestor would pin the
            statement sheet's fixed overlay inside this panel instead of over the page. */}
          <div
            className={`${menuOpen ? 'flex' : 'hidden'} items-center gap-2 md:flex max-md:absolute max-md:inset-x-0 max-md:top-full max-md:z-20 max-md:mt-1 max-md:flex-col max-md:items-stretch max-md:rounded-[22px] max-md:border max-md:border-t-hair-strong max-md:bg-[#16161c] max-md:p-2 max-md:shadow-[0_18px_50px_rgba(0,0,0,0.55)]`}
          >
            <label
              className={`press flex cursor-pointer items-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 md:order-3 ${rowItem}`}
            >
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {importing ? 'Importing' : 'Import'}
              <input
                type="file"
                accept=".csv,.txt,.ofx,.qif"
                className="hidden"
                onChange={(e) => {
                  setMenuOpen(false);
                  onFileUpload(e);
                }}
                disabled={importing}
              />
            </label>

            {/* Laid out as its own children, so the chip inside takes the flex order it declares. */}
            <div className="contents">{extraControls}</div>

            {/* The whole transaction set as one CSV — the backup that no browser profile can lose. */}
            {exportUrl && (
              <a
                href={exportUrl}
                download="transactions-export.csv"
                title="Download every transaction as CSV"
                onClick={() => setMenuOpen(false)}
                className={`glass-chip press flex items-center gap-2 px-3.5 py-2 text-[12.5px] text-label-2 hover:text-label md:order-2 ${rowItem}`}
              >
                <Download size={14} />
                Export
              </a>
            )}

            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
                className={`glass-chip press flex items-center gap-2 p-2 text-label-3 hover:text-label md:order-4 max-md:px-4 ${rowItem}`}
              >
                <LogOut size={14} />
                <span className="md:hidden">Sign out</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {filtersOpen && (
        <div className="materialize glass mt-1 flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
          <div className="flex items-center gap-3 max-md:w-full">
            <span className="t-label whitespace-nowrap">{draftRange} cycles</span>
            <input
              type="range"
              min="3"
              max={Math.max(3, availableMonthCount)}
              value={draftRange}
              onChange={(e) => setDraftRange(parseInt(e.target.value, 10))}
              onPointerUp={commitRange}
              onKeyUp={commitRange}
              className="w-40 accent-info max-md:h-11 max-md:w-full"
              aria-label="How many pay cycles to show"
            />
          </div>
          <div className="hidden h-6 w-px bg-hair md:block" />
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => {
              const on = selectedIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onToggleAccount(a.id)}
                  aria-pressed={on}
                  title={
                    a.seenNames?.length > 1
                      ? `Also exported as ${a.seenNames.join(', ')}`
                      : a.rawName
                  }
                  className={`press flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] max-md:min-h-11 max-md:px-4 ${
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

      {/* The phone tab bar. Fixed to the bottom edge, padded past the home indicator, and a
          glass material with a frosted fallback for people who have transparency switched off. */}
      <nav
        aria-label="Views"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-t-hair-strong bg-[rgba(14,14,18,0.82)] backdrop-blur-2xl backdrop-saturate-[180%] [@media(prefers-reduced-transparency:reduce)]:bg-[#14141a] [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {VIEWS.map(({ id, label, Icon }) => {
            const active = activeView === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onViewChange(id);
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[55px] min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 px-0 pt-1.5 pb-1 text-[11px] leading-none tracking-[-0.01em] ${
                  active ? 'font-semibold text-info' : 'font-medium text-label-3'
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                <span className="max-w-full truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
