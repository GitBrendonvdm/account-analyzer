import { buildApp } from './app.mjs';
import { resetPassphrase } from './auth.mjs';
import { openStore } from './db/adapter.mjs';
import { migrate } from './db/migrate.mjs';

/**
 * Boot: open the database, bring the schema up to date, honour a reset if one was asked for, and
 * listen. Everything interesting lives in app.mjs; this file is the part that cannot be tested
 * with `inject()` and so holds as little as possible.
 *
 *   npm run server                      local, PGlite under ./data
 *   DATABASE_URL=postgres://… node …     production, the Coolify database
 *   RESET_PASSPHRASE=1 node …            forget the passphrase and every session, then boot
 */

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const store = await openStore();
const applied = await migrate(store);

const app = await buildApp({ store, logger: { level: process.env.LOG_LEVEL ?? 'info' } });
app.log.info({ backend: store.backend, migrations: applied }, 'database ready');
if (store.backend === 'pglite' && process.env.NODE_ENV === 'production') {
  app.log.warn('DATABASE_URL is not set: running on PGlite inside the container. Data will not survive a redeploy.');
}

if (process.env.RESET_PASSPHRASE === '1') {
  await resetPassphrase(store);
  app.log.warn('RESET_PASSPHRASE=1: the passphrase has been cleared and every session signed out. Remove the variable before the next restart.');
}

const shutdown = async (signal) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await app.listen({ port: PORT, host: HOST });
