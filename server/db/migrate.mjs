import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

/**
 * Schema changes, applied at boot, each exactly once.
 *
 * There is no migration tool because there is nothing for one to do: the files in ./migrations
 * run in name order, and `schema_migrations` remembers which have run. A second boot on the same
 * database finds them all recorded and touches nothing, which is what lets the container restart
 * freely and the tests build a database from scratch every time.
 *
 * Each file runs inside one transaction so a half-applied migration cannot be recorded as done.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(store) {
  await store.exec(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null)',
  );
  const applied = new Set(
    (await store.query('select name from schema_migrations')).rows.map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await store.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (name, applied_at) values ($1, now())', [file]);
    });
    ran.push(file);
  }
  await ensureAuthRow(store);
  return ran;
}

/** The auth row exists from first boot so a session secret is minted before anyone can log in. */
async function ensureAuthRow(store) {
  await store.query(
    `insert into auth (id, passphrase_hash, session_secret, created_at, updated_at)
     values (1, null, $1, now(), now())
     on conflict (id) do nothing`,
    [randomBytes(32).toString('hex')],
  );
}
