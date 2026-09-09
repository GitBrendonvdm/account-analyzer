import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../utils/csv';

/**
 * Loads a real bank export from the gitignored `test-data/` directory.
 *
 * These exports contain personal financial data and are never committed, so tests that depend on
 * them must skip rather than fail when the directory is absent (CI, a fresh clone). Use:
 *
 *   const real = loadRealExport();
 *   describe.skipIf(!real)('…', () => { … });
 */
const DIR = join(process.cwd(), 'test-data');

/**
 * The NEWEST file in the directory, by modification time — the one most recently dropped in.
 *
 * This used to take the last filename alphabetically, which quietly meant a
 * `vault22-data-export-…` sorted past every `transactions_…` however much fresher those were:
 * a September export sat in the folder while the suite kept reading August. Modification time
 * says what a person means by "the export I just downloaded", whatever the exporter called it.
 */
export function loadRealExport() {
  if (!existsSync(DIR)) return null;
  const csv = readdirSync(DIR)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => ({ f, at: statSync(join(DIR, f)).mtimeMs }))
    .sort((a, b) => a.at - b.at)
    .at(-1);
  if (!csv) return null;
  return parseCsv(readFileSync(join(DIR, csv.f), 'utf8'));
}
