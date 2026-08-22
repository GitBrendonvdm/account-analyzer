import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCompress from '@fastify/compress';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { COOKIE, sessionFor } from './auth.mjs';
import healthRoutes from './routes/health.mjs';
import authRoutes from './routes/auth.mjs';
import dataRoutes from './routes/data.mjs';
import importRoutes from './routes/import.mjs';
import accountRoutes from './routes/accounts.mjs';
import planRoutes from './routes/plan.mjs';

/**
 * The one container: the built app and its API, from the same process on the same port.
 *
 * nginx used to serve dist/ and nothing else. Now that there is a server anyway, a second process
 * to hand out static files would be a second thing to configure, log and keep alive, for no gain
 * at this size. Fastify serves the build with the same cache rules nginx applied — hashed assets
 * forever, everything else revalidated — and falls back to index.html for any path that is not
 * an API route, which is what a single-page app needs.
 *
 * Building the app is separate from listening so the tests can drive it with `inject()` against
 * an in-memory database and no port.
 *
 * Two hooks guard the API. Every mutating request has to say `content-type: application/json`:
 * a cross-site form cannot, so together with the SameSite=Strict cookie that shuts the door on
 * CSRF. And every route except health and auth needs a live session.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BODY_LIMIT = 25 * 1024 * 1024;

async function requireJson(request, reply) {
  if (!MUTATING.has(request.method)) return;
  const type = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) {
    return reply.code(415).send({ error: 'Send JSON (content-type: application/json)' });
  }
}

export async function buildApp({ store, distDir = resolve('dist'), logger = false } = {}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: BODY_LIMIT });
  app.decorate('store', store);

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyCompress);

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode ?? err.status ?? 500;
    if (status >= 500) request.log.error({ err }, 'request failed');
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
  });

  await app.register(
    async (api) => {
      api.addHook('onRequest', requireJson);
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(async (secured) => {
        secured.addHook('onRequest', async (request, reply) => {
          const session = await sessionFor(store, request.cookies?.[COOKIE]);
          if (!session) return reply.code(401).send({ error: 'Sign in first' });
          request.session = session;
        });
        await secured.register(dataRoutes);
        await secured.register(importRoutes);
        await secured.register(accountRoutes);
        await secured.register(planRoutes);
      });
    },
    { prefix: '/api' },
  );

  const hasBuild = existsSync(join(distDir, 'index.html'));
  if (hasBuild) {
    await app.register(fastifyStatic, {
      root: distDir,
      cacheControl: false,
      setHeaders(reply, filePath) {
        const hashed = filePath.includes(`${sep}assets${sep}`);
        reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api/') || request.url === '/api';
    if (isApi || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!hasBuild) return reply.code(404).send({ error: 'No build in dist/ — run `npm run build`' });
    reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return app;
}
