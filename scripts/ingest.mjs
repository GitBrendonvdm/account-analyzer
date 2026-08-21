/**
 * Automated ingestion.
 *
 * The manual step this removes is the download, not the bank connection. Both FNB and Nedbank can
 * email statements on a schedule, and the aggregator that produces these exports can too — so the
 * job here is to watch a folder those attachments land in, merge every file it finds into one
 * append-only master export, and never lose a row.
 *
 * It exists because the exports SLIDE. Each file starts later than the last: comparing the
 * 6 August and 21 August exports, 66 rows arrived and 67 fell off the front. Any workflow that
 * treats the newest file as the truth discards real history every time it runs.
 *
 * The merge rules are the app's own (see lib/mergeTransactions.js), so importing the master file
 * into the browser is idempotent — the app recognises every row it already holds.
 *
 *   npm run ingest              watch ./inbox and merge anything that appears
 *   npm run ingest -- --once    one pass, then exit (what a cron job or CI would run)
 *   npm run ingest -- --inbox ./mail --master ./data/all.csv
 *
 * What this does NOT do: sign into a bank. Setting up the scheduled statement email is a one-off
 * job for you, in your own banking app — see README.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { parseCsv } from '../src/utils/csv.js';
import { toCsv } from '../src/utils/csvWrite.js';
import { mergeTransactions } from '../src/lib/mergeTransactions.js';
import { assignKeys } from '../src/db/txnKey.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const INBOX = resolve(flag('inbox', process.env.MV_INBOX ?? './inbox'));
const MASTER = resolve(flag('master', process.env.MV_MASTER ?? './test-data/master.csv'));
const PROCESSED = join(INBOX, 'processed');
const ONCE = args.includes('--once');
const QUIET = args.includes('--quiet');

const log = (...a) => { if (!QUIET) console.log(...a); };
const money = (n) => `R${Math.round(n).toLocaleString('en-ZA')}`;

function loadMaster() {
  if (!existsSync(MASTER)) return [];
  const rows = parseCsv(readFileSync(MASTER, 'utf8'));
  // The master writes its own `key` column, which parseCsv reads back as an ordinary field. A
  // master written before that column existed gets keys derived on load instead.
  if (rows.length > 0 && !rows[0].key) assignKeys(rows);
  return rows;
}

function ingestFile(path, held) {
  const incoming = parseCsv(readFileSync(path, 'utf8'));
  if (incoming.length === 0) {
    log(`  ${basename(path)}: no rows, skipped`);
    return held;
  }
  const result = mergeTransactions(held, incoming);
  const { counts } = result;

  const parts = [`${counts.total} read`, `${counts.added} new`];
  if (counts.updated) parts.push(`${counts.updated} revised`);
  if (counts.superseded) parts.push(`${counts.superseded} ignored as older`);
  parts.push(`${counts.held} held`);
  log(`  ${basename(path)}: ${parts.join(' · ')}`);

  result.updated.slice(0, 5).forEach((u) => {
    log(`      revised ${u.row.Date} ${String(u.row.Description).slice(0, 34)} — ${u.changed.join(', ')}`);
  });

  return result.rows;
}

function writeMaster(rows) {
  const dir = MASTER.slice(0, Math.max(MASTER.lastIndexOf('/'), MASTER.lastIndexOf('\\')));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(MASTER, toCsv(rows), 'utf8');
}

function archive(path) {
  if (!existsSync(PROCESSED)) mkdirSync(PROCESSED, { recursive: true });
  const target = join(PROCESSED, basename(path));
  try {
    renameSync(path, target);
  } catch {
    // Same-name file already archived — leave the original where it is rather than losing it.
  }
}

function sweep() {
  if (!existsSync(INBOX)) {
    mkdirSync(INBOX, { recursive: true });
    log(`Created ${INBOX} — drop bank exports in here.`);
    return 0;
  }
  const files = readdirSync(INBOX)
    .filter((f) => /\.(csv|txt)$/i.test(f))
    .map((f) => join(INBOX, f))
    .filter((f) => statSync(f).isFile())
    // Oldest first, so a newer export always gets the last word on a revised row.
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);

  if (files.length === 0) return 0;

  log(`\nIngesting ${files.length} file${files.length === 1 ? '' : 's'}…`);
  let held = loadMaster();
  const before = held.length;
  files.forEach((f) => { held = ingestFile(f, held); });
  writeMaster(held);
  files.forEach(archive);

  const dates = held.map((r) => r.Date).filter(Boolean).sort();
  const spend = held.reduce((s, r) => s + (r.AmountNum < 0 ? -r.AmountNum : 0), 0);
  log(
    `  master: ${held.length} rows (+${held.length - before}) · ${dates[0]} to ${dates[dates.length - 1]} · ${money(spend)} of outflow`,
  );
  log(`  written to ${MASTER}`);
  return files.length;
}

sweep();

if (!ONCE) {
  log(`\nWatching ${INBOX} … (ctrl-c to stop)`);
  let pending = null;
  watch(INBOX, (_event, filename) => {
    if (!filename || !/\.(csv|txt)$/i.test(filename)) return;
    // A file copied in arrives as several events; wait for it to settle before reading it.
    clearTimeout(pending);
    pending = setTimeout(sweep, 600);
  });
}
