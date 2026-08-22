import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * One passphrase, one person, no accounts.
 *
 * The data on the server is a complete picture of someone's finances, so it cannot sit behind an
 * open endpoint — but a single-user app does not need users, roles, email or password reset
 * flows. It needs a passphrase chosen on first visit, a session cookie that proves it was typed,
 * and a way back in when it is forgotten (RESET_PASSPHRASE=1 at boot, see index.mjs).
 *
 * The passphrase is stored as an scrypt hash with a random salt; the session token is random and
 * stored only as its SHA-256, so a copy of the database does not yield a usable cookie. Neither the
 * passphrase nor a token is ever written to a log — the routes are careful not to, and so must any
 * future change here.
 */

export const COOKIE = 'mv_session';
const SESSION_DAYS = 30;
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export const MIN_PASSPHRASE_LENGTH = 8;

function derive(passphrase, salt) {
  return scryptSync(passphrase, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // Node's default ceiling is exactly what N=2^15 needs, with nothing spare for overhead.
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
}

export function hashPassphrase(passphrase) {
  const salt = randomBytes(16);
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${derive(passphrase, salt).toString('hex')}`;
}

/** Constant-time: the comparison takes as long for a wrong guess as for a right one. */
export function verifyPassphrase(passphrase, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, n, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || Number(n) !== SCRYPT_N || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = derive(passphrase, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// ---- the auth row -----------------------------------------------------------------------------

export async function isConfigured(conn) {
  const { rows } = await conn.query('select passphrase_hash from auth where id = 1');
  return rows[0]?.passphrase_hash != null;
}

/** Sets the passphrase only while none is set. Returns false when one already was. */
export async function setPassphrase(conn, passphrase) {
  const { rowCount } = await conn.query(
    'update auth set passphrase_hash = $1, updated_at = now() where id = 1 and passphrase_hash is null',
    [hashPassphrase(passphrase)],
  );
  return rowCount > 0;
}

export async function checkPassphrase(conn, passphrase) {
  const { rows } = await conn.query('select passphrase_hash from auth where id = 1');
  const stored = rows[0]?.passphrase_hash;
  if (stored == null) return false;
  return verifyPassphrase(passphrase, stored);
}

/** Forgets the passphrase and every session. The next visit sees the setup screen again. */
export async function resetPassphrase(store) {
  await store.transaction(async (tx) => {
    await tx.query('update auth set passphrase_hash = null, updated_at = now() where id = 1');
    await tx.query('delete from sessions');
  });
}

// ---- sessions ---------------------------------------------------------------------------------

export async function createSession(conn) {
  const token = randomBytes(32).toString('hex');
  await conn.query(
    `insert into sessions (token_hash, created_at, expires_at)
     values ($1, now(), now() + ($2 || ' days')::interval)`,
    [hashToken(token), String(SESSION_DAYS)],
  );
  // Expired sessions are swept here rather than on a timer: this is the only moment they grow.
  await conn.query('delete from sessions where expires_at < now()');
  return token;
}

export async function sessionFor(conn, token) {
  if (typeof token !== 'string' || token.length !== 64) return null;
  const { rows } = await conn.query(
    'select token_hash, expires_at from sessions where token_hash = $1 and expires_at > now()',
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function destroySession(conn, token) {
  if (typeof token !== 'string' || !token) return;
  await conn.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

/**
 * Secure is decided per request rather than per build: behind Coolify's proxy the app sees plain
 * HTTP with x-forwarded-proto saying https, and in production the cookie must never travel over
 * anything else. Locally, over http://localhost, Secure would stop the browser sending it at all.
 */
export function cookieOptions(request) {
  const secure =
    request.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
