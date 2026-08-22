/**
 * What the deployment platform polls. Public, because a health check has no cookie, and honest
 * about the backend so a pglite fallback in production — DATABASE_URL missing — is visible from
 * the first request rather than discovered when the container is replaced and the data is gone.
 */
export default async function healthRoutes(app) {
  app.get('/health', async (request, reply) => {
    try {
      await app.store.query('select 1');
      return { ok: true, db: 'ok', backend: app.store.backend };
    } catch (err) {
      request.log.error({ err }, 'health check: database query failed');
      return reply.code(503).send({ ok: false, db: 'error', backend: app.store.backend });
    }
  });
}
