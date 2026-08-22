import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileText, Loader2, ScanText, X } from 'lucide-react';
import { accountLabel } from '../db/accountIdentity';
import { formatCurrency } from '../utils/format';
import { externalRecord, matchStatement, parseStatement, patchIsNoop } from '../lib/statements';
import { todayIso } from '../lib/statements/amounts';
import { Card } from './ui/Surface';

/**
 * Balances from the bank's own overview page, instead of typed in one at a time.
 *
 * The transaction export says what moved, never what an account holds, so every balance used to be
 * a number the user read off the banking app and keyed into the editor. FNB and Nedbank both let
 * you save the account overview as a PDF; drop that here and each balance is read, matched to the
 * account the export knows by its last four digits, and shown for approval before anything is
 * written. Accounts the export has never seen — a retirement annuity, an emergency fund — can be
 * added as external accounts in the same step, so net worth stops being a partial figure.
 *
 * Nothing is written until Confirm. The preview is the whole point: OCR of a scanned page is good,
 * not perfect, and a balance that is wrong by a digit should be caught by a glance, not a bank
 * reconciliation later. A large account whose type the page did not give is held back until the
 * user says what it is, because the type decides the sign, and the sign decides net worth.
 *
 * The date is the user's to set. A Nedbank page prints the day it was saved; an FNB page does not,
 * and the day of the upload is wrong for a PDF saved last week — so the sheet asks for the date the
 * PDF was saved, and that date goes on every balance written. Confirming the same page twice
 * writes nothing the second time: a patch that changes nothing is counted, not sent.
 */

const READ_ERROR =
  "Couldn't read this PDF — it may be a scan. Enter the balances by hand under Accounts.";
const TYPE_CHOICES = ['Bank', 'Savings', 'Credit Card', 'Loan'];

function formatDay(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

const sameCents = (a, b) => a != null && b != null && Math.round(a * 100) === Math.round(b * 100);

/** A date on or before today, as the statement's date must be; anything else becomes today. */
function clampDay(iso, today) {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso <= today ? iso : today;
}

function progressLabel(p) {
  if (p?.stage === 'ocr') {
    if (p.status === 'recognizing text' && typeof p.progress === 'number') {
      return `Recognising ${Math.round(p.progress * 100)}%`;
    }
    return 'Preparing OCR…';
  }
  return 'Reading…';
}

/** Where the balance the record holds today came from — so a re-upload reads as one. */
function provenance(account) {
  if (account.currentBalance == null) return 'no balance yet';
  const when = account.balanceAsOf ? formatDay(account.balanceAsOf) : '';
  if (account.source === 'statement') {
    return `was: from your ${account.bank || 'bank'} summary${when ? `, ${when}` : ''}`;
  }
  if (account.source === 'manual' || account.source === 'user') {
    return `was: typed${when ? ` ${when}` : ''}`;
  }
  return `was: set${when ? ` ${when}` : ' earlier'}`;
}

function Sheet({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="fixed inset-0 cursor-default bg-ground/70"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative mx-auto my-24 w-full max-w-2xl px-4">
        <Card className="materialize p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="t-head">{title}</h2>
              {subtitle && <p className="t-label mt-1.5 max-w-prose">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press shrink-0 rounded-full p-1.5 text-label-3 hover:bg-fill hover:text-label"
            >
              <X size={16} />
            </button>
          </div>
          {children}
        </Card>
      </div>
    </div>
  );
}

function MatchedRow({ match, asOf }) {
  const { account, parsed, patch, note } = match;
  const unchanged = patchIsNoop(patch, account);
  const old = account.currentBalance;
  const next = patch.currentBalance;
  const changed = !sameCents(old, next);
  // A position: higher is better whether it is cash growing or debt shrinking.
  const tone = old == null || !changed ? 'text-label' : next > old ? 'text-good' : 'text-bad';
  const limit =
    patch.creditLimit != null
      ? ` · limit ${formatCurrency(patch.creditLimit)}`
      : patch.overdraftLimit != null
        ? ` · overdraft ${formatCurrency(patch.overdraftLimit)}`
        : '';

  return (
    <li className="flex items-center justify-between gap-4 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="truncate text-sm text-label">{accountLabel(account)}</div>
        <div className="t-caption truncate">
          {parsed.name} · as of {formatDay(asOf)}
          {limit}
          {note && <span className="text-warn"> · {note}</span>}
        </div>
        <div className="t-caption truncate">
          {unchanged ? <span className="text-good">already up to date</span> : provenance(account)}
        </div>
      </div>
      <div className="num shrink-0 text-right text-sm">
        {changed && old != null && (
          <span className="mr-2 text-label-3 line-through">{formatCurrency(old)}</span>
        )}
        <span className={unchanged ? 'text-label-2' : tone}>{formatCurrency(next)}</span>
      </div>
    </li>
  );
}

function UnmatchedRow({ entry, checked, onToggle }) {
  const { parsed, record } = entry;
  const kind = parsed.kind ? ` · ${parsed.kind}` : '';
  return (
    <li className="flex items-center justify-between gap-4 border-b py-2.5 last:border-0">
      <label className="flex min-w-0 cursor-pointer items-center gap-3">
        <input type="checkbox" className="accent-info" checked={checked} onChange={onToggle} />
        <div className="min-w-0">
          <div className="truncate text-sm text-label">{parsed.name}</div>
          <div className="t-caption truncate">
            {record.type}
            {kind} · *{record.mask} · add as external account
            {parsed.signFromType && <span className="text-warn"> · sign taken from the account type</span>}
          </div>
        </div>
      </label>
      <div className="num shrink-0 text-sm text-label">{formatCurrency(record.currentBalance)}</div>
    </li>
  );
}

/** A large account the page did not type: the user says what it is before it can be added. */
function AttentionRow({ entry, bank, asOf, choice, onChange }) {
  const { parsed } = entry;
  const preview = choice.type ? externalRecord(parsed, { bank, asOf, type: choice.type }) : null;
  const hint =
    parsed.type === 'Other'
      ? 'type unknown'
      : `looks like a ${parsed.type.toLowerCase()}, but the page did not say`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b py-2.5 last:border-0">
      <label className={`flex min-w-0 items-center gap-3 ${choice.type ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
        <input
          type="checkbox"
          className="accent-info"
          checked={choice.add}
          disabled={!choice.type}
          onChange={() => onChange({ ...choice, add: !choice.add })}
        />
        <div className="min-w-0">
          <div className="truncate text-sm text-label">{parsed.name}</div>
          <div className="t-caption truncate">
            *{parsed.last4} · {hint} · choose a type to add it
          </div>
        </div>
      </label>
      <div className="flex items-center gap-3">
        <select
          value={choice.type}
          onChange={(e) => onChange({ type: e.target.value, add: choice.add && !!e.target.value })}
          aria-label={`Type for ${parsed.name}`}
          className="rounded-full border bg-ground-lift px-3 py-1.5 text-[12.5px] text-label focus:border-info/30 focus:outline-none"
        >
          <option value="">Type…</option>
          {TYPE_CHOICES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="num w-28 text-right text-sm text-label">
          {formatCurrency(preview ? preview.currentBalance : parsed.printedBalance)}
        </div>
      </div>
    </li>
  );
}

export function StatementUpload({ accounts, onPatchAccount, onCreateAccount, onDone }) {
  // idle → reading → preview → confirming, or idle → reading → error.
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [adds, setAdds] = useState({});
  // needsAttention entries, keyed by account number: { type, add }.
  const [choices, setChoices] = useState({});
  const today = todayIso();
  const [asOf, setAsOf] = useState(today);

  // Re-matched whenever the date changes, so every patch and record carries the chosen day.
  const match = useMemo(
    () => (result ? matchStatement(result.parsed, { knownAccounts: accounts, asOf }) : null),
    [result, accounts, asOf],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setProgress(null);
    setResult(null);
    setError(null);
    setAdds({});
    setChoices({});
  }, []);

  const onFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setError(null);
      setResult(null);
      setPhase('reading');
      setProgress(null);
      try {
        const { default: extractLines } = await import('../lib/statements/extract');
        const extracted = await extractLines(file, { onProgress: setProgress });
        const now = todayIso();
        const parsed = parseStatement(extracted.lines, { asOf: now, knownAccounts: accounts });
        if (!parsed.bank || parsed.accounts.length === 0) {
          setError({ message: READ_ERROR });
          setPhase('error');
          return;
        }
        const initialAsOf = clampDay(parsed.asOf, now);
        const first = matchStatement(parsed, { knownAccounts: accounts, asOf: initialAsOf });
        setAsOf(initialAsOf);
        setAdds(Object.fromEntries(first.unmatched.map((u) => [u.record.id, true])));
        setChoices(
          Object.fromEntries(first.needsAttention.map((n) => [n.parsed.number, { type: '', add: false }])),
        );
        setResult({ parsed, method: extracted.method, fileName: file.name });
        setPhase('preview');
      } catch (err) {
        setError({ message: READ_ERROR, detail: err?.message });
        setPhase('error');
      }
    },
    [accounts],
  );

  const confirm = useCallback(async () => {
    if (!result || !match) return;
    setPhase('confirming');
    const { parsed, method, fileName } = result;
    const updatedNames = [];
    const createdNames = [];
    let unchanged = 0;
    try {
      for (const m of match.matched) {
        if (patchIsNoop(m.patch, m.account)) {
          unchanged += 1;
          continue;
        }
        await onPatchAccount(m.account.id, m.patch);
        updatedNames.push(accountLabel(m.account));
      }
      for (const u of match.unmatched) {
        if (!adds[u.record.id]) continue;
        await onCreateAccount(u.record);
        createdNames.push(u.parsed.name);
      }
      for (const n of match.needsAttention) {
        const choice = choices[n.parsed.number];
        if (!choice?.type || !choice.add) continue;
        await onCreateAccount(externalRecord(n.parsed, { bank: parsed.bank, asOf, type: choice.type }));
        createdNames.push(n.parsed.name);
      }
      onDone?.({
        kind: 'statement',
        fileName,
        bank: parsed.bank,
        asOf,
        method,
        updated: updatedNames.length,
        unchanged,
        created: createdNames.length,
        skipped: parsed.skipped.length,
        updatedNames,
        createdNames,
      });
      reset();
    } catch (err) {
      setError({ message: `Couldn't save: ${err?.message ?? 'unknown error'}` });
      setPhase('preview');
    }
  }, [result, match, asOf, adds, choices, onPatchAccount, onCreateAccount, onDone, reset]);

  const busy = phase === 'reading';
  const matchedRows = match?.matched ?? [];
  const unchangedCount = matchedRows.filter((m) => patchIsNoop(m.patch, m.account)).length;
  const toUpdate = matchedRows.length - unchangedCount;
  const toAdd = match
    ? match.unmatched.filter((u) => adds[u.record.id]).length +
      match.needsAttention.filter(
        (n) => choices[n.parsed.number]?.type && choices[n.parsed.number]?.add,
      ).length
    : 0;

  return (
    <>
      <label
        className={`glass-chip press flex items-center gap-2 px-4 py-2 text-[12.5px] text-label-2 hover:text-label ${
          busy ? 'cursor-wait' : 'cursor-pointer'
        }`}
        title="Upload the account overview PDF from FNB or Nedbank online banking"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
        {busy ? progressLabel(progress) : 'Account summary'}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onFile}
          disabled={busy}
        />
      </label>

      {phase === 'error' && (
        <Sheet title="Account summary" subtitle="Nothing was changed." onClose={reset}>
          <p className="mt-5 text-sm text-bad">{error?.message}</p>
          {error?.detail && <p className="t-caption mt-1.5">{error.detail}</p>}
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={reset}
              className="glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label"
            >
              Close
            </button>
          </div>
        </Sheet>
      )}

      {(phase === 'preview' || phase === 'confirming') && result && match && (
        <Sheet
          title="Account summary"
          subtitle={`${result.parsed.bank} · ${
            result.method === 'ocr' ? 'read from an image' : 'read from the PDF text'
          }`}
          onClose={reset}
        >
          {result.method === 'ocr' && (
            <p className="mt-4 flex items-center gap-2 rounded-full bg-warn/10 px-3 py-1.5 text-[12.5px] text-warn">
              <ScanText size={14} className="shrink-0" />
              Read from an image — check the numbers before confirming.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label htmlFor="statement-as-of" className="t-label">
              As of
            </label>
            <input
              id="statement-as-of"
              type="date"
              value={asOf}
              max={today}
              onChange={(e) => e.target.value && setAsOf(clampDay(e.target.value, today))}
              className="rounded-full border bg-ground-lift px-3 py-1.5 text-[12.5px] text-label focus:border-info/30 focus:outline-none"
            />
            <span className="t-caption">Use the date you saved the PDF.</span>
          </div>

          {matchedRows.length > 0 && (
            <section className="mt-5">
              <h3 className="t-label">
                Update {toUpdate} account{toUpdate === 1 ? '' : 's'}
                {unchangedCount > 0 && ` · ${unchangedCount} already up to date`}
              </h3>
              <ul className="mt-1">
                {matchedRows.map((m) => (
                  <MatchedRow key={m.account.id} match={m} asOf={asOf} />
                ))}
              </ul>
            </section>
          )}

          {match.unmatched.length > 0 && (
            <section className="mt-5">
              <h3 className="t-label">Not in your transaction export</h3>
              <ul className="mt-1">
                {match.unmatched.map((u) => (
                  <UnmatchedRow
                    key={u.record.id}
                    entry={u}
                    checked={!!adds[u.record.id]}
                    onToggle={() =>
                      setAdds((prev) => ({ ...prev, [u.record.id]: !prev[u.record.id] }))
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          {match.needsAttention.length > 0 && (
            <section className="mt-5">
              <h3 className="t-label">Needs a type before it can be added</h3>
              <ul className="mt-1">
                {match.needsAttention.map((n) => (
                  <AttentionRow
                    key={n.parsed.number}
                    entry={n}
                    bank={result.parsed.bank}
                    asOf={asOf}
                    choice={choices[n.parsed.number] ?? { type: '', add: false }}
                    onChange={(choice) =>
                      setChoices((prev) => ({ ...prev, [n.parsed.number]: choice }))
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          {result.parsed.skipped.length > 0 && (
            <details className="mt-4">
              <summary className="t-caption cursor-pointer select-none">
                {result.parsed.skipped.length} line{result.parsed.skipped.length === 1 ? '' : 's'}{' '}
                skipped
              </summary>
              <ul className="mt-2 space-y-1">
                {result.parsed.skipped.map((s, i) => (
                  <li key={`${i}-${s.line}`} className="t-caption truncate">
                    <span className="text-label-2">{s.reason}</span> — {s.line}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {error && <p className="mt-4 text-sm text-bad">{error.message}</p>}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={phase === 'confirming'}
              className="glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={phase === 'confirming' || toUpdate + toAdd === 0}
              className="press flex items-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {phase === 'confirming' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              {toUpdate > 0 && `Update ${toUpdate}`}
              {toUpdate > 0 && toAdd > 0 && ' · '}
              {toAdd > 0 && `Add ${toAdd}`}
              {toUpdate + toAdd === 0 && (unchangedCount > 0 ? 'All up to date' : 'Nothing to apply')}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
