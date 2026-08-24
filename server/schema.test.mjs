import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStore } from './db/adapter.mjs';
import { migrate } from './db/migrate.mjs';

/** Whatever is in the migrations directory, in the order the runner will take them. */
const EXPECTED = readdirSync(join(dirname(fileURLToPath(import.meta.url)), 'db/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

/**
 * The schema comes up from nothing and, crucially, comes up again on a database that already has
 * it. A container restarts; a migration that ran twice would either fail the boot or, worse,
 * recreate something.
 */
describe('migrations', () => {
  let store;
  beforeAll(async () => {
    store = await openStore({ url: null, dataDir: null });
  });
  afterAll(() => store.close());

  it('apply once, and a second boot applies nothing', async () => {
    const first = await migrate(store);
    expect(first).toEqual(EXPECTED);
    expect(EXPECTED[0]).toBe('001_init.sql');
    const second = await migrate(store);
    expect(second).toEqual([]);

    const { rows } = await store.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ['transactions', 'accounts', 'imports', 'budgets', 'goals', 'settings', 'auth', 'sessions', 'meta', 'schema_migrations']) {
      expect(names).toContain(t);
    }
  });

  it('mints the auth row with a session secret and no passphrase', async () => {
    const { rows } = await store.query('select passphrase_hash, session_secret from auth where id = 1');
    expect(rows).toHaveLength(1);
    expect(rows[0].passphrase_hash).toBeNull();
    expect(rows[0].session_secret).toMatch(/^[0-9a-f]{64}$/);
    // And booting again keeps the same secret rather than rotating it.
    await migrate(store);
    const again = await store.query('select session_secret from auth where id = 1');
    expect(again.rows[0].session_secret).toBe(rows[0].session_secret);
  });

  it('rolls a failed transaction back', async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.query(`insert into settings (key, value) values ('probe', '1')`);
        throw new Error('abandon');
      }),
    ).rejects.toThrow('abandon');
    const { rows } = await store.query(`select 1 from settings where key = 'probe'`);
    expect(rows).toHaveLength(0);
  });
});
