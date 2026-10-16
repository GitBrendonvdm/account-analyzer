import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, FileCheck2, Loader2, Plus } from 'lucide-react';
import { accountLabel } from '../db/accountIdentity';
import { historyTextFor, reconcileStatement } from '../lib/reconcile';
import { parseFnbStatement } from '../lib/statements/ledgerStatement';
import { Sheet } from './ui/Sheet';

/**
 * Hold the app against the bank's own statement.
 *
 * The imported history is only as good as the files it came from, and the one document that says
 * what an account held and what moved is the statement the bank sends. Drop it here and the app
 * checks itself against it: do the balances at both ends agree, is every line on the statement a
 * line the app holds, and is there anything the app holds that the statement does not.
 *
 * Nothing is written by looking. A line the statement has and the app does not can be added — it goes
 * through the same door as any other bank line, so it is paired against what is held, categorised
 * the same way and never counted twice — and the statement's facility limit can replace a derived one.
 * Everything else is reported, because a difference the reader has not explained is not one to
 * paper over: it is the thing to go and look for.
 *
 * Reading is by the page's columns and needs the PDF's text layer; a scan is declined with a reason.
 * Only the cheque/savings layout is read — the one seen — and a card or loan statement says so
 * rather than being guessed at.
 */

const rand = (n) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(n ?? 0);
const dayLabel = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '';
const dayLong = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function BalanceRow({ label, check }) {
  const tone = check.agrees == null ? 'text-label-3' : check.agrees ? 'text-good' : 'text-bad';
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-2 pr-4 text-left text-sm font-normal text-label-2">
        {label}
      </th>
      <td className="num py-2 pr-4 text-right text-sm text-label">{check.statement == null ? '—' : rand(check.statement)}</td>
      <td className="num py-2 pr-4 text-right text-sm text-label">{check.app == null ? 'no balance held' : rand(check.app)}</td>
      <td className={`num py-2 text-right text-sm ${tone}`}>
        {check.agrees == null ? '' : check.agrees ? 'agrees' : `${check.difference > 0 ? '+' : '−'}${rand(Math.abs(check.difference))}`}
      </td>
    </tr>
  );
}

function StatementResult({ entry, data, accounts, onAddLines, onPatchAccount }) {
  const { parsed, fileName } = entry;
  const result = useMemo(() => reconcileStatement(parsed, data, accounts), [parsed, data, accounts]);
  const [picked, setPicked] = useState(() => new Set(parsed.lines.map((_, i) => i)));
  const [state, setState] = useState({ busy: false, error: null });

  const missingIndexes = useMemo(
    () => (result.missing ?? []).map((line) => parsed.lines.indexOf(line)),
    [result.missing, parsed.lines],
  );
  const chosen = missingIndexes.filter((i) => picked.has(i));

  const add = useCallback(async () => {
    setState({ busy: true, error: null });
    try {
      const lines = chosen.map((i) => parsed.lines[i]);
      await onAddLines({
        name: `statement-${parsed.statementNumber ?? parsed.account.last4}.csv`,
        from: fileName,
        text: historyTextFor(parsed, lines),
      });
      setState({ busy: false, error: null });
    } catch (err) {
      setState({ busy: false, error: err?.message ?? 'Could not add the lines' });
    }
  }, [chosen, fileName, onAddLines, parsed]);

  const limit = parsed.facilityLimit;
  const limitDiffers =
    result.matched && limit != null && result.account?.type !== 'Credit Card' && (result.account?.overdraftLimit ?? null) !== limit;
  const readIssues = !parsed.checks.chain || !parsed.checks.turnover || !parsed.checks.closing;

  const verdictTone = result.verdict === 'agrees' ? 'text-good' : result.verdict === 'differs' ? 'text-bad' : 'text-label-2';
  const Icon = result.verdict === 'agrees' ? CircleCheck : CircleAlert;

  return (
    <section className="border-b py-5 first:pt-4 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-label">
            {result.account ? accountLabel(result.account) : `${parsed.account.name} *${parsed.account.last4}`}
          </h3>
          <p className="t-caption mt-0.5">
            {dayLong(parsed.period.from)} – {dayLong(parsed.period.to)}
            {parsed.statementNumber && ` · statement ${parsed.statementNumber}`} · {parsed.lines.filter((l) => !l.nonPosting).length} lines
          </p>
        </div>
        {result.matched && (
          <span className={`flex shrink-0 items-center gap-1.5 text-sm ${verdictTone}`}>
            <Icon size={15} />
            {result.verdict === 'agrees' ? 'Agrees' : result.verdict === 'differs' ? 'Differs' : 'Not checked'}
          </span>
        )}
      </div>

      {readIssues && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          This PDF may not have been read correctly — {parsed.warnings[0] ?? 'its own totals do not add up'}. Treat the
          comparison below with care.
        </p>
      )}

      {!result.matched ? (
        <p className="mt-3 text-sm text-label-2">{result.reason}</p>
      ) : (
        <>
          <table className="mt-3 w-full">
            <thead>
              <tr className="text-left">
                <th className="t-caption pb-1 font-normal" />
                <th className="t-caption pb-1 pr-4 text-right font-normal">Statement</th>
                <th className="t-caption pb-1 pr-4 text-right font-normal">The app</th>
                <th className="t-caption pb-1 text-right font-normal" />
              </tr>
            </thead>
            <tbody>
              <BalanceRow label={`Opening, ${dayLabel(parsed.period.from)}`} check={result.balances.opening} />
              <BalanceRow label={`Closing, ${dayLabel(parsed.period.to)}`} check={result.balances.closing} />
            </tbody>
          </table>
          <p className="t-caption mt-2">
            {result.pairs.length} of {result.pairs.length + result.missing.length} lines on the statement are in the app
            {result.extra.length > 0 && ` · ${result.extra.length} in the app are not on it`}.
          </p>

          {result.missing.length > 0 && (
            <div className="mt-4">
              <h4 className="t-label">On the statement, not in the app</h4>
              <ul className="mt-1">
                {result.missing.map((line, k) => {
                  const i = missingIndexes[k];
                  return (
                    <li key={`${line.date}-${line.amount}-${k}`} className="flex items-center justify-between gap-4 border-b py-2 last:border-0">
                      <label className="flex min-w-0 cursor-pointer items-center gap-3 max-md:min-h-11">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-info"
                          checked={picked.has(i)}
                          onChange={() =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i);
                              else next.add(i);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 truncate text-sm text-label">
                          {dayLabel(line.date)} · {line.description || 'Bank charge'}
                        </span>
                      </label>
                      <span className={`num shrink-0 text-sm ${line.amount < 0 ? 'text-label' : 'text-good'}`}>{rand(line.amount)}</span>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={add}
                disabled={state.busy || chosen.length === 0}
                className="press mt-3 flex items-center justify-center gap-2 rounded-full bg-info px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 max-md:min-h-11 max-md:w-full"
              >
                {state.busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Add {chosen.length} line{chosen.length === 1 ? '' : 's'}
              </button>
              {state.error && <p className="mt-2 text-sm text-bad">{state.error}</p>}
            </div>
          )}

          {result.extra.length > 0 && (
            <div className="mt-4">
              <h4 className="t-label">In the app, not on the statement</h4>
              <ul className="mt-1">
                {result.extra.map((row) => (
                  <li key={row.key ?? `${row.Date}-${row.Description}-${row.AmountNum}`} className="flex items-center justify-between gap-4 border-b py-2 last:border-0">
                    <span className="min-w-0 truncate text-sm text-label-2">
                      {dayLabel(row.Date)} · {row.Description}
                    </span>
                    <span className="num shrink-0 text-sm text-label-2">{rand(row.AmountNum)}</span>
                  </li>
                ))}
              </ul>
              <p className="t-caption mt-1.5">
                Usually a charge that has not posted yet, or one the bank dated more than two days away from the app's copy.
              </p>
            </div>
          )}

          {limitDiffers && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-label-2">
                The statement's facility limit is <b className="font-semibold text-label">{rand(limit)}</b>
                {result.account.overdraftLimit != null && <> — the app has {rand(result.account.overdraftLimit)}</>}.
              </span>
              <button
                type="button"
                onClick={() => onPatchAccount(result.account.id, { overdraftLimit: limit })}
                className="glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label max-md:min-h-11"
              >
                Use the statement's
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function StatementCheck({ data, accounts, incoming, onIncomingHandled, onAddLines, onPatchAccount }) {
  const [phase, setPhase] = useState('idle');
  const [entries, setEntries] = useState([]);

  const read = useCallback(async (files) => {
    setPhase('reading');
    const { extractItems } = await import('../lib/statements/extract');
    const out = [];
    for (const file of files) {
      const name = file.name;
      try {
        // A File has a `bytes()` method of its own in current browsers, so "has bytes" cannot tell a
        // File from the { name, bytes } the Import button hands over; being a Blob can.
        const source = file instanceof Blob ? file : new File([file.bytes], name, { type: 'application/pdf' });
        const { pages, scanned } = await extractItems(source);
        if (scanned) {
          out.push({ fileName: name, error: 'This PDF is a picture of a page, not text — download the statement again from online banking.' });
          continue;
        }
        const parsed = parseFnbStatement(pages);
        out.push(parsed.ok ? { fileName: name, parsed } : { fileName: name, error: parsed.reason });
      } catch (err) {
        out.push({ fileName: name, error: `Could not open this PDF${err?.message ? ` (${err.message})` : ''}` });
      }
    }
    setEntries(out);
    setPhase('ready');
  }, []);

  const onFiles = useCallback(
    (e) => {
      const files = [...(e.target.files ?? [])];
      e.target.value = '';
      if (files.length) read(files);
    },
    [read],
  );

  // PDFs that arrived through the Import button. Started on the next tick: reading sets state, and an
  // effect must not set state in its own body.
  useEffect(() => {
    if (!incoming?.length) return undefined;
    const timer = setTimeout(() => {
      read(incoming);
      onIncomingHandled?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [incoming, read, onIncomingHandled]);

  const close = useCallback(() => {
    setPhase('idle');
    setEntries([]);
  }, []);

  const busy = phase === 'reading';
  return (
    <>
      <label
        className={`glass-chip press flex items-center gap-2 px-4 py-2 text-[12.5px] text-label-2 hover:text-label max-md:min-h-11 max-md:w-full max-md:text-[14px] ${busy ? 'cursor-wait' : 'cursor-pointer'}`}
        title="Check the app against an official FNB account statement (PDF)"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <FileCheck2 size={15} />}
        {busy ? 'Reading…' : 'Check statement'}
        <input type="file" multiple accept="application/pdf,.pdf" className="hidden" onChange={onFiles} disabled={busy} />
      </label>

      {phase === 'ready' && (
        <Sheet
          title="Statement check"
          subtitle="The app's ledger, held against what the bank printed. Nothing changes unless you add lines."
          onClose={close}
          footer={
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={close}
                className="glass-chip press px-4 py-2 text-[13px] text-label-2 hover:text-label max-md:min-h-11 max-md:w-full"
              >
                Done
              </button>
            </div>
          }
        >
          {entries.map((entry) =>
            entry.error ? (
              <section key={entry.fileName} className="border-b py-4 last:border-0">
                <h3 className="truncate text-sm font-medium text-label">{entry.fileName}</h3>
                <p className="mt-1 text-sm text-bad">{entry.error}</p>
              </section>
            ) : (
              <StatementResult
                key={entry.fileName}
                entry={entry}
                data={data ?? []}
                accounts={accounts}
                onAddLines={onAddLines}
                onPatchAccount={onPatchAccount}
              />
            ),
          )}
        </Sheet>
      )}
    </>
  );
}
