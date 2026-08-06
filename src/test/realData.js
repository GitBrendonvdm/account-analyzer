import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

export function loadRealExport() {
  if (!existsSync(DIR)) return null;
  const csv = readdirSync(DIR)
    .filter((f) => f.endsWith('.csv'))
    .sort()
    .at(-1);
  if (!csv) return null;
  return parseCsv(readFileSync(join(DIR, csv), 'utf8'));
}
