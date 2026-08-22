import {
  COOKIE,
  MIN_PASSPHRASE_LENGTH,
  checkPassphrase,
  cookieOptions,
  createSession,
  destroySession,
  isConfigured,
  sessionFor,
  setPassphrase,
} from '../auth.mjs';

/**
 * Setup, login, logout, and "where do I stand" — the only routes that work without a session.
 *
 * Setup and login are rate-limited per IP because a passphrase is the whole defence; ten tries a
 * minute is generous for a person and hopeless for a script. Nothing here logs the passphrase,
 * and the only thing the client ever sees back is whether it worked.
 */

const LIMITED = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

function passphraseOf(body) {
  const value = body?.passphrase;
  return typeof value === 'string' ? value : null;
}

export default async function authRoutes(app) {
  const { store } = app;

  app.get('/auth/status', async (request) => {
    const [configured, session] = await Promise.all([
      isConfigured(store),
      sessionFor(store, request.cookies?.[COOKIE]),
    ]);
    return { configured, authenticated: !!session };
  });

  app.post('/auth/setup', LIMITED, async (request, reply) => {
    const passphrase = passphraseOf(request.body);
    if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return reply.code(400).send({ error: `Choose a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters` });
    }
    const stored = await setPassphrase(store, passphrase);
    if (!stored) return reply.code(409).send({ error: 'A passphrase is already set' });
    const token = await createSession(store);
    reply.setCookie(COOKIE, token, cookieOptions(request));
    return { configured: true, authenticated: true };
  });

  app.post('/auth/login', LIMITED, async (request, reply) => {
    const passphrase = passphraseOf(request.body);
    if (!(await isConfigured(store))) {
      return reply.code(409).send({ error: 'No passphrase has been set yet' });
    }
    if (!passphrase || !(await checkPassphrase(store, passphrase))) {
      return reply.code(401).send({ error: 'That passphrase is not right' });
    }
    const token = await createSession(store);
    reply.setCookie(COOKIE, token, cookieOptions(request));
    return { configured: true, authenticated: true };
  });

  app.post('/auth/logout', async (request, reply) => {
    await destroySession(store, request.cookies?.[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { authenticated: false };
  });
}
