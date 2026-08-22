import { toCsv, SOURCE_COLUMNS } from '../../src/utils/csvWrite.js';
import { bootstrapPayload, dataVersion, etagFor, listAccounts, listTransactions, wipeData } from '../db/data.mjs';
import { mergeDump } from '../dump.mjs';

/**
 * The whole dataset, in and out.
 *
 * The app reads everything at once — it always has; the pipeline wants every row in memory — so
 * bootstrap is one payload with an ETag derived from the data version. A reload after nothing has
 * changed costs a 304 rather than the full set, and the client keeps the copy it had.
 */
export default async function dataRoutes(app) {
  const { store } = app;

  app.get('/bootstrap', async (request, reply) => {
    const version = await dataVersion(store);
    const etag = etagFor(version);
    reply.header('etag', etag);
    reply.header('cache-control', 'no-cache');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return bootstrapPayload(store);
  });

  app.post('/migrate', async (request, reply) => {
    const dump = request.body;
    if (!dump || typeof dump !== 'object') return reply.code(400).send({ error: 'Send the browser dump as JSON' });
    return mergeDump(store, dump);
  });

  /** The export's own columns, in its own order — a backup the app can re-import. */
  app.get('/export.csv', async (request, reply) => {
    const rows = await listTransactions(store, await listAccounts(store));
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="transactions_${stamp}.csv"`);
    reply.header('cache-control', 'no-store');
    return toCsv(rows, SOURCE_COLUMNS);
  });

  /** Start over. The word is required so a stray DELETE from a tool cannot do it. */
  app.delete('/data', async (request, reply) => {
    if (request.body?.confirm !== 'DELETE') {
      return reply.code(400).send({ error: "Send { confirm: 'DELETE' } to wipe everything" });
    }
    await store.transaction((tx) => wipeData(tx));
    return { ok: true };
  });
}
