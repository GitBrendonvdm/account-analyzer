import { X, FilePlus2, RefreshCw, CircleCheck, TriangleAlert } from 'lucide-react';

/**
 * What the last import actually did.
 *
 * Imports used to be invisible and destructive — you uploaded a file, the dataset was replaced, and
 * nothing told you that rows had fallen off the far end of the window. Now nothing is deleted, and
 * the app says what changed: how much was genuinely new, what was revised (a Pending charge
 * settling, a category re-assigned upstream), and whether an account arrived or was renamed.
 *
 * An upload can now be several files at once — FNB's zips, one per account — so the summary is a
 * list: `{ items, ignored }`, one block per import the upload became. A bare summary object, the
 * shape it used to be, still renders.
 */

const n = (x) => (x ?? 0).toLocaleString('en-ZA');
const rand = (x) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(x ?? 0);

function Tally({ icon: Icon, count, label }) {
  return (
    <li className="flex items-center gap-1.5">
      {Icon && <Icon size={12} />}
      <b className="font-semibold">{n(count)}</b> {label}
    </li>
  );
}

/** One account out of an FNB upload: every file for it folded into one line. */
function accountsOf(bank) {
  const byName = new Map();
  (bank?.files ?? []).forEach((f) => {
    if (f.status !== 'ok') return;
    const entry = byName.get(f.rawName) ?? { ...f, files: 0 };
    entry.files += 1;
    byName.set(f.rawName, entry);
  });
  return [...byName.values()];
}

function BankBlock({ summary }) {
  const { bank } = summary;
  const accounts = accountsOf(bank);
  const skipped = (bank?.files ?? []).filter((f) => f.status === 'skipped');
  const totals = bank?.totals ?? {};
  const breaks = accounts.reduce((sum, a) => sum + (a.chain?.breaks ?? 0), 0);

  return (
    <div className="min-w-0 text-sm">
      <p className="font-medium text-good">
        Imported {n(totals.used)} FNB history file{totals.used === 1 ? '' : 's'}
        {summary.dateFrom && summary.dateTo && (
          <span className="font-normal"> covering {summary.dateFrom} to {summary.dateTo}</span>
        )}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-good">
        <Tally icon={FilePlus2} count={totals.added} label="new" />
        <Tally count={totals.alreadyHeld} label="already held" />
        {totals.pairedWithOldExport > 0 && (
          <Tally icon={RefreshCw} count={totals.pairedWithOldExport} label="matched to rows you already had" />
        )}
      </ul>

      {accounts.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs text-good">
          {accounts.map((a) => (
            <li key={a.rawName} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="min-w-0 truncate">
                <b className="font-semibold">{a.accountName}</b> *{a.last4}
                {a.isNew && ' · new account'}
                <span className="opacity-80">
                  {' '}
                  · {n(a.added)} new
                  {a.pairedWithOldExport > 0 && `, ${n(a.pairedWithOldExport)} matched`}
                  {a.nonPosting?.length > 0 && `, ${n(a.nonPosting.length)} that never moved the balance left out`}
                  {a.files > 1 && ` · ${a.files} overlapping files merged`}
                </span>
              </span>
              {a.balance && (
                <span className="num shrink-0">
                  {rand(a.balance.currentBalance)}
                  <span className="opacity-80"> on {a.balance.balanceAsOf}</span>
                </span>
              )}
              {!a.balance && a.balanceNote && <span className="opacity-80">{a.balanceNote}</span>}
            </li>
          ))}
        </ul>
      )}

      {breaks > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {n(breaks)} line{breaks === 1 ? '' : 's'} where the bank's running balance does not follow from the line
          below — a transaction may be missing from the file. Upload a longer window to fill it.
        </p>
      )}
      {skipped.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-good opacity-90">
          {skipped.map((f) => (
            <li key={`${f.from}-${f.name}`} className="truncate">
              Left out: {f.accountName ?? f.name} — {f.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LegacyBlock({ summary }) {
  const { fileName, rowsTotal, added, updated, unchanged, dateFrom, dateTo } = summary;
  const ignored = summary.duplicatesIgnored ?? 0;
  const repeats = summary.repeatsCollapsed ?? 0;
  const renamed = summary.accountsRenamed ?? [];
  const created = summary.accountsNew ?? [];
  const examples = summary.updatedExamples ?? [];

  return (
    <div className="min-w-0 text-sm">
      <p className="font-medium text-good">
        Imported {fileName} · {n(rowsTotal)} rows read
        {dateFrom && dateTo && (
          <span className="font-normal text-good">
            {' '}
            covering {dateFrom} to {dateTo}
          </span>
        )}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-good">
        <Tally icon={FilePlus2} count={added} label="new" />
        <Tally icon={RefreshCw} count={updated} label="revised" />
        <Tally count={unchanged} label="already held" />
      </ul>

      {/* A file that turns 4 060 lines into 3 206 transactions has to say so. The 2026 export
          shadows most settled transactions with a stale pending copy and repeats some rows
          outright; both are removed on the way in, and both are counted here. */}
      {(ignored > 0 || repeats > 0) && (
        <p className="mt-2 text-xs text-good">
          {ignored > 0 && (
            <>
              <b className="font-semibold">{n(ignored)}</b> pending {ignored === 1 ? 'copy' : 'copies'} of
              transactions that have already settled
            </>
          )}
          {ignored > 0 && repeats > 0 && ', and '}
          {repeats > 0 && (
            <>
              <b className="font-semibold">{n(repeats)}</b>{' '}
              {repeats === 1 ? 'row the file repeated' : 'rows the file repeated'} word for word
            </>
          )}{' '}
          — left out, so nothing is counted twice.
        </p>
      )}

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
        <p className="mt-1 text-xs text-good">Renamed by the export, kept as one account: {renamed.join(', ')}</p>
      )}
    </div>
  );
}

export function ImportSummary({ summary, onDismiss }) {
  if (!summary) return null;
  const items = Array.isArray(summary.items) ? summary.items : [summary];
  const ignored = summary.ignored ?? [];

  return (
    <div className="rounded-[22px] border border-good/25 bg-good/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <CircleCheck size={18} className="mt-0.5 shrink-0 text-good" />
          <div className="min-w-0 space-y-4">
            {items.map((item, i) =>
              item.bank ? (
                <BankBlock key={`${item.fileName}-${i}`} summary={item} />
              ) : (
                <LegacyBlock key={`${item.fileName}-${i}`} summary={item} />
              ),
            )}
            {ignored.length > 0 && (
              <ul className="space-y-0.5 text-xs text-good opacity-90">
                {ignored.map((f) => (
                  <li key={f.name} className="truncate">
                    Not used: {f.name} — {f.reason}
                  </li>
                ))}
              </ul>
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
