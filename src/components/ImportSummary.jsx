import { X, FilePlus2, RefreshCw, CircleCheck } from 'lucide-react';

/**
 * What the last import actually did.
 *
 * Imports used to be invisible and destructive — you uploaded a file, the dataset was replaced, and
 * nothing told you that rows had fallen off the far end of the window. Now nothing is deleted, and
 * the app says what changed: how much was genuinely new, what was revised (a Pending charge
 * settling, a category re-assigned upstream), and whether an account arrived or was renamed.
 */
export function ImportSummary({ summary, onDismiss }) {
  if (!summary) return null;
  const { fileName, rowsTotal, added, updated, unchanged, dateFrom, dateTo } = summary;
  const renamed = summary.accountsRenamed ?? [];
  const created = summary.accountsNew ?? [];
  const examples = summary.updatedExamples ?? [];

  return (
    <div className="rounded-[22px] border border-good/25 bg-good/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <CircleCheck size={18} className="mt-0.5 shrink-0 text-good" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-good">
              Imported {fileName} · {rowsTotal.toLocaleString('en-ZA')} rows read
              {dateFrom && dateTo && (
                <span className="font-normal text-good">
                  {' '}
                  covering {dateFrom} to {dateTo}
                </span>
              )}
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-good">
              <li className="flex items-center gap-1.5">
                <FilePlus2 size={12} />
                <b className="font-semibold">{added.toLocaleString('en-ZA')}</b> new
              </li>
              <li className="flex items-center gap-1.5">
                <RefreshCw size={12} />
                <b className="font-semibold">{updated.toLocaleString('en-ZA')}</b> revised
              </li>
              <li>
                <b className="font-semibold">{unchanged.toLocaleString('en-ZA')}</b> already held
              </li>
            </ul>

            {examples.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-good">
                {examples.map((ex) => (
                  <li key={`${ex.date}-${ex.description}`} className="truncate">
                    {ex.date} · {ex.description} — {ex.fields.join('; ')}
                  </li>
                ))}
              </ul>
            )}

            {created.length > 0 && (
              <p className="mt-2 text-xs text-good">
                New account{created.length > 1 ? 's' : ''}: {created.join(', ')}
              </p>
            )}
            {renamed.length > 0 && (
              <p className="mt-1 text-xs text-good">
                Renamed by the export, kept as one account: {renamed.join(', ')}
              </p>
            )}
          </div>
        </div>
        {/* A 44px hit area around a 16px glyph; the negative margin keeps the glyph where it was. */}
        <button
          type="button"
          onClick={onDismiss}
          className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-good hover:bg-good/15"
          aria-label="Dismiss import summary"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
