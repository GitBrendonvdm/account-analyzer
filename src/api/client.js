/**
 * The browser's side of the API, and nothing else.
 *
 * Every call goes through one `request` so the rules live in one place: same-origin cookies, JSON
 * both ways, a body on every mutating call because the server insists on `application/json` even
 * when there is nothing to say (that header is half of the CSRF defence), and a 401 from anywhere
 * announced as a window event so the shell can show the sign-in screen without every caller
 * having to know about sessions.
 *
 * The last bootstrap is kept here too. Two hooks need slices of it — the analyzer wants rows and
 * accounts, the plan wants budgets and goals — and fetching the whole dataset twice on every load
 * would be silly, so whichever hook fetches it publishes it, and the other subscribes.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const UNAUTHENTICATED_EVENT = 'mv:unauthenticated';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function request(method, path, body, { headers = {} } = {}) {
  const init = { method, credentials: 'same-origin', headers: { accept: 'application/json', ...headers } };
  if (MUTATING.has(method)) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  const response = await fetch(path, init);
  if (response.status === 304) return { status: 304, data: null };
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
    throw new ApiError(response.status, data?.error ?? data?.message ?? `${method} ${path} failed (${response.status})`);
  }
  return { status: response.status, data, etag: response.headers.get('etag') };
}

// ---- auth -------------------------------------------------------------------------------------

export const authStatus = () => request('GET', '/api/auth/status').then((r) => r.data);
export const setup = (passphrase) => request('POST', '/api/auth/setup', { passphrase }).then((r) => r.data);
export const login = (passphrase) => request('POST', '/api/auth/login', { passphrase }).then((r) => r.data);
export const logout = () => request('POST', '/api/auth/logout').then((r) => r.data);

// ---- the dataset ------------------------------------------------------------------------------

let cached = { etag: null, payload: null };
const listeners = new Set();

function publish(payload) {
  cached = { ...cached, payload };
  listeners.forEach((fn) => fn(payload));
}

/**
 * Subscribe to every bootstrap that lands. The listener is called at once with the last one, if
 * there is one, so a hook that mounts after the fetch is not left waiting for the next.
 */
export function subscribeBootstrap(listener) {
  listeners.add(listener);
  if (cached.payload) listener(cached.payload);
  return () => listeners.delete(listener);
}

export async function bootstrap() {
  const headers = cached.etag && cached.payload ? { 'if-none-match': cached.etag } : {};
  const r = await request('GET', '/api/bootstrap', null, { headers });
  if (r.status === 304) {
    publish(cached.payload);
    return cached.payload;
  }
  cached = { etag: r.etag, payload: r.data };
  publish(r.data);
  return r.data;
}

/** On sign-out the copy is dropped; the next person to sign in must not see it. */
export function forgetBootstrap() {
  cached = { etag: null, payload: null };
  listeners.forEach((fn) => fn(null));
}

export const importFile = (text, fileName) => request('POST', '/api/import', { text, fileName }).then((r) => r.data);
export const migrate = (dump) => request('POST', '/api/migrate', dump).then((r) => r.data);
export const wipe = () => request('DELETE', '/api/data', { confirm: 'DELETE' }).then((r) => r.data);
export const exportUrl = () => '/api/export.csv';

// ---- accounts ---------------------------------------------------------------------------------

export const patchAccount = (id, patch) =>
  request('PATCH', `/api/accounts/${encodeURIComponent(id)}`, { patch }).then((r) => r.data);
export const createAccount = (record) => request('POST', '/api/accounts', { record }).then((r) => r.data);
export const deleteAccount = (id) =>
  request('DELETE', `/api/accounts/${encodeURIComponent(id)}`).then((r) => r.data);

// ---- plan -------------------------------------------------------------------------------------

const budgetPath = (scope, category) => `/api/budgets/${encodeURIComponent(scope)}/${encodeURIComponent(category)}`;
export const putBudget = (scope, category, amount) => request('PUT', budgetPath(scope, category), { amount }).then((r) => r.data);
export const deleteBudget = (scope, category) => request('DELETE', budgetPath(scope, category)).then((r) => r.data);
export const addGoal = (goal) => request('POST', '/api/goals', { goal }).then((r) => r.data);
export const deleteGoal = (id) => request('DELETE', `/api/goals/${encodeURIComponent(id)}`).then((r) => r.data);
export const putSetting = (key, value) =>
  request('PUT', `/api/settings/${encodeURIComponent(key)}`, { value }).then((r) => r.data);
