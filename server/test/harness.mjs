import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../app.mjs';
import { openStore } from '../db/adapter.mjs';
import { migrate } from '../db/migrate.mjs';

/**
 * A whole server on an in-memory database, for the tests.
 *
 * PGlite is the same Postgres the container runs (see db/adapter.mjs), so what passes here is
 * what runs in production — the tests are not exercising a stand-in. Each harness is its own
 * database: tests never share state, and a file can be run alone.
 *
 * `call` sends a request with the session cookie attached; `signIn` takes the setup path on a
 * fresh database and the login path if a passphrase is already set.
 */

export const PASSPHRASE = 'correct horse battery staple';

export async function createHarness() {
  const store = await openStore({ url: null, dataDir: null });
  await migrate(store);
  const app = await buildApp({ store, distDir: join(process.cwd(), 'no-such-dist') });
  const harness = {
    app,
    store,
    cookies: {},
    call(method, url, payload, extra = {}) {
      return app.inject({ method, url, payload, cookies: harness.cookies, ...extra });
    },
    async signIn(passphrase = PASSPHRASE) {
      let r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { passphrase } });
      if (r.statusCode === 409) {
        r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase } });
      }
      if (r.statusCode !== 200) throw new Error(`sign-in failed: ${r.statusCode} ${r.body}`);
      harness.cookies = { mv_session: r.cookies[0].value };
      return r;
    },
    async bootstrap() {
      const r = await harness.call('GET', '/api/bootstrap');
      if (r.statusCode !== 200) throw new Error(`bootstrap failed: ${r.statusCode} ${r.body}`);
      return { body: r.json(), etag: r.headers.etag };
    },
    async close() {
      await app.close();
      await store.close();
    },
  };
  return harness;
}

// ---- rows and files ---------------------------------------------------------------------------

/** A transaction row in the export's shape; the same helper src/db/importTransactions.test.js uses. */
export function row(date, description, account, amount, extra = {}) {
  return {
    Date: date,
    Description: description,
    Account: account,
    Category: 'Groceries',
    'Spending Group': 'Day-to-day',
    'Pay Month': `${date.slice(0, 7)}`,
    Amount: String(amount),
    AmountNum: amount,
    Type: amount < 0 ? 'Expense' : 'Income',
    Status: 'Completed',
    ...extra,
  };
}

export const clone = (rows) => rows.map((r) => ({ ...r }));

const COLUMNS = ['Date', 'Description', 'Account', 'Spending Group', 'Category', 'Pay Month', 'Amount', 'Type', 'Status'];

/** Rows as CSV text, the way the import route receives a file. */
export function csvOf(rows) {
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => quote(r[c])).join(','))].join('\n') + '\n';
}

/**
 * The real exports in test-data/, oldest first — personal data, gitignored, so tests that need
 * them skip when they are absent. Returns null unless there are at least two.
 */
export function loadRealExports() {
  const dir = join(process.cwd(), 'test-data');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^transactions_.*\.csv$/.test(f))
    .sort();
  if (files.length < 2) return null;
  return files.map((f) => ({ fileName: f, text: readFileSync(join(dir, f), 'utf8') }));
}
