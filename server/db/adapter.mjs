import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One way to talk to the database, two things behind it.
 *
 * In production the app container reaches the Postgres that Coolify runs, over the internal docker
 * network. That database is not reachable from a laptop, and demanding a local Postgres just to
 * run `npm run server` would make the server the one part of the app nobody runs before pushing.
 * So when DATABASE_URL is absent the same schema runs on PGlite — Postgres compiled to WebAssembly,
 * persisted under ./data — and the tests use it in memory, where a fresh database costs nothing.
 *
 * Both are real Postgres, so the SQL is written once. What differs is the driver surface, and that
 * is hidden here: `query(text, params)` returns `{ rows }`, and `transaction(fn)` hands `fn` a
 * connection with the same `query` whose work is committed when `fn` resolves and rolled back when
 * it throws. Nothing above this file knows which backend it is talking to, except the health check,
 * which says so on purpose.
 */

/** The one place pg's types are coerced to match PGlite's: int8 comes back as a number, not a string. */
async function openPg(url) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
  const pool = new pg.Pool({ connectionString: url });
  const wrap = (client) => ({
    query: async (text, params = []) => {
      const r = await client.query(text, params);
      return { rows: r.rows, rowCount: r.rowCount };
    },
    exec: (text) => client.query(text),
  });
  return {
    backend: 'pg',
    query: (text, params) => wrap(pool).query(text, params),
    exec: (text) => pool.query(text),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  const wrap = (conn) => ({
    query: async (text, params = []) => {
      const r = await conn.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: (text) => conn.exec(text),
  });
  return {
    backend: 'pglite',
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}

/**
 * @param url      a postgres:// URL, normally from DATABASE_URL; when absent PGlite is used
 * @param dataDir  where PGlite keeps its files; `null` means in memory (tests)
 */
export async function openStore({ url = process.env.DATABASE_URL, dataDir = resolve('data/pglite') } = {}) {
  if (url) return openPg(url);
  return openPglite(dataDir);
}
