import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, Check, Loader2 } from 'lucide-react';
import { accountLabel } from '../db/accountIdentity';

export function AnalyzerToolbar({
  fileName,
  monthRange,
  onMonthRangeChange,
  availableMonthCount = 12,
  accounts,
  selectedIds,
  onToggleAccount,
  onFileUpload,
  importing,
}) {
  const [draftMonthRange, setDraftMonthRange] = useState(monthRange);
  // Adjust-during-render rather than an effect: syncing a prop into local state in useEffect
  // triggers a second render pass, and the lint rule that flags it is right to.
  const [syncedFrom, setSyncedFrom] = useState(monthRange);
  if (syncedFrom !== monthRange) {
    setSyncedFrom(monthRange);
    setDraftMonthRange(monthRange);
  }

  const commitMonthRange = useCallback(() => {
    if (draftMonthRange !== monthRange) onMonthRangeChange(draftMonthRange);
  }, [draftMonthRange, monthRange, onMonthRangeChange]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-white p-6 shadow-sm">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <FileSpreadsheet className="text-blue-600" />
          Analyzer
        </h1>
        {fileName && <p className="mt-1 text-xs text-slate-500">Last import: {fileName}</p>}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>{draftMonthRange} cycles</span>
        <input
          type="range"
          min="3"
          max={Math.max(3, availableMonthCount)}
          value={draftMonthRange}
          onChange={(e) => setDraftMonthRange(parseInt(e.target.value, 10))}
          onPointerUp={commitMonthRange}
          onKeyUp={commitMonthRange}
          className="w-32 accent-blue-600"
          aria-label="How many pay cycles to show"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {accounts.map((acc) => {
          const on = selectedIds.includes(acc.id);
          return (
            <button
              key={acc.id}
              type="button"
              onClick={() => onToggleAccount(acc.id)}
              aria-pressed={on}
              title={acc.seenNames?.length > 1 ? `Also exported as: ${acc.seenNames.join(', ')}` : acc.rawName}
              className={`rounded border px-3 py-1 text-xs ${
                on ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-slate-200 bg-white'
              }`}
            >
              {on && <Check size={12} className="mr-1 inline" />}
              {accountLabel(acc)}
            </button>
          );
        })}
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">
        {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
        {importing ? 'Importing' : 'Import'}
        <input
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={onFileUpload}
          disabled={importing}
        />
      </label>
    </div>
  );
}
