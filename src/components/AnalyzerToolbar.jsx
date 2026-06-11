import { useCallback, useEffect, useState } from 'react';
import { Upload, FileSpreadsheet, Check } from 'lucide-react';

export function AnalyzerToolbar({
  fileName,
  monthRange,
  onMonthRangeChange,
  availableMonthCount = 12,
  allAccounts,
  selectedAccounts,
  onToggleAccount,
  onFileUpload,
}) {
  const [draftMonthRange, setDraftMonthRange] = useState(monthRange);

  useEffect(() => {
    setDraftMonthRange(monthRange);
  }, [monthRange]);

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
        {fileName && <p className="mt-1 text-xs text-slate-500">Saved: {fileName}</p>}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>{draftMonthRange} months</span>
        <input
          type="range"
          min="3"
          max={Math.max(3, availableMonthCount)}
          value={draftMonthRange}
          onChange={(e) => setDraftMonthRange(parseInt(e.target.value, 10))}
          onPointerUp={commitMonthRange}
          onKeyUp={commitMonthRange}
          className="w-32 accent-blue-600"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {allAccounts.map((acc) => (
          <button
            key={acc}
            type="button"
            onClick={() => onToggleAccount(acc)}
            className={`rounded border px-3 py-1 text-xs ${
              selectedAccounts.includes(acc)
                ? 'border-blue-400 bg-blue-100 text-blue-700'
                : 'border-slate-200 bg-white'
            }`}
          >
            {selectedAccounts.includes(acc) && <Check size={12} className="mr-1 inline" />}
            {acc}
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">
        <Upload size={18} />
        Upload
        <input type="file" accept=".csv,.txt" className="hidden" onChange={onFileUpload} />
      </label>
    </div>
  );
}
