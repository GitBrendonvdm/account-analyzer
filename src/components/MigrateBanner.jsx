import { CloudUpload, Loader2 } from 'lucide-react';

/**
 * The bridge from the browser-only days.
 *
 * Before the server existed every import landed in this browser's IndexedDB, and the balances,
 * labels and targets typed since are in there too. The server starts empty, so the first visit
 * from a browser that still holds rows is offered a one-click move — once, and only while the
 * server has nothing, because a second browser moving its copy on top of a populated server is a
 * merge the server does carefully but the person should choose knowingly.
 */
export function MigrateBanner({ dump, onMigrate, busy, onDismiss }) {
  const count = dump?.transactions?.length ?? 0;
  if (!count) return null;
  const accounts = dump?.accounts?.length ?? 0;

  return (
    <div className="materialize glass-tile flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <CloudUpload size={18} className="shrink-0 text-info" />
        <div className="min-w-0 text-[14px]">
          <span className="font-medium text-label">
            This browser holds {count.toLocaleString('en-ZA')} transaction{count === 1 ? '' : 's'} that aren't on the server yet
          </span>
          <span className="text-label-3">
            {' '}
            — and {accounts} account{accounts === 1 ? '' : 's'} with whatever you entered against them.
          </span>
        </div>
      </div>
      {/* On a phone the two buttons share the full width under the text, at thumb height. */}
      <div className="flex items-center gap-2 max-md:w-full">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="press rounded-full px-4 py-2 text-[13px] text-label-3 hover:bg-fill hover:text-label-2 max-md:min-h-11 max-md:flex-1"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onMigrate}
          disabled={busy}
          className="press flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60 max-md:min-h-11 max-md:flex-1"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
          {busy ? 'Moving' : 'Move to server'}
        </button>
      </div>
    </div>
  );
}
