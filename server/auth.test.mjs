import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, PASSPHRASE } from './test/harness.mjs';
import { hashPassphrase, verifyPassphrase } from './auth.mjs';

/**
 * The door, end to end: nothing before setup, setup once, the wrong passphrase refused, the right
 * one admitted, and a session that stops working the moment it is signed out.
 */
describe('auth', () => {
  let h;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('reports unconfigured and unauthenticated before setup', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ configured: false, authenticated: false });
  });

  it('refuses protected routes without a cookie', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(r.statusCode).toBe(401);
  });

  it('rejects a passphrase that is too short', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { passphrase: 'short' } });
    expect(r.statusCode).toBe(400);
  });

  it('sets the passphrase once and hands out a cookie', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { passphrase: PASSPHRASE } });
    expect(r.statusCode).toBe(200);
    const cookie = r.cookies.find((c) => c.name === 'mv_session');
    expect(cookie).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.path).toBe('/');
    h.cookies = { mv_session: cookie.value };

    const again = await h.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { passphrase: 'another one' } });
    expect(again.statusCode).toBe(409);
  });

  it('marks the cookie Secure behind an https proxy', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { passphrase: PASSPHRASE },
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.cookies.find((c) => c.name === 'mv_session').secure).toBe(true);
  });

  it('turns the wrong passphrase away and lets the right one in', async () => {
    const wrong = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: 'not it' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.cookies.find((c) => c.name === 'mv_session')).toBeUndefined();

    const right = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
    expect(right.statusCode).toBe(200);
    expect(right.cookies.find((c) => c.name === 'mv_session')).toBeTruthy();
  });

  it('admits the session to protected routes, then invalidates it on logout', async () => {
    const before = await h.call('GET', '/api/bootstrap');
    expect(before.statusCode).toBe(200);
    const status = await h.call('GET', '/api/auth/status');
    expect(status.json()).toEqual({ configured: true, authenticated: true });

    const out = await h.call('POST', '/api/auth/logout', {});
    expect(out.statusCode).toBe(200);

    const after = await h.call('GET', '/api/bootstrap');
    expect(after.statusCode).toBe(401);
  });

  it('insists on JSON for anything that mutates', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'passphrase=whatever',
    });
    expect(r.statusCode).toBe(415);
  });

  it('hashes with a fresh salt each time and verifies in either direction', () => {
    const a = hashPassphrase('the same words');
    const b = hashPassphrase('the same words');
    expect(a).not.toBe(b);
    expect(verifyPassphrase('the same words', a)).toBe(true);
    expect(verifyPassphrase('the same words', b)).toBe(true);
    expect(verifyPassphrase('different words', a)).toBe(false);
    expect(verifyPassphrase('the same words', 'garbage')).toBe(false);
  });
});
