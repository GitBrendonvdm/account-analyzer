import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importRows } from './importer.mjs';
import { clone, createHarness, row } from './test/harness.mjs';

/**
 * The rest of the API: the shape bootstrap hands the app, what a browser's old copy turns into
 * when it is moved up, and the small authored things — accounts, targets, goals, settings.
 */

// Deliberately not in date order, and with the account's older name appearing before its newer
// one — within a single file the last name seen is the current one, as in the browser.
const ROWS = [
  row('2026-06-01', 'Checkers', 'FNB Savings *9547', -250),
  row('2026-07-20', 'Makro', 'FNB Bank *9547', -900),
  row('2026-06-14', 'Spar', 'FNB Bank *9986', -120),
  row('2026-06-14', 'Salary', 'FNB Bank *9986', 25000),
];

describe('GET /api/bootstrap', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
  });
  afterEach(() => h.close());

  it('returns rows sorted by Date with sequential ids, canonical accounts and numeric amounts', async () => {
    await importRows(h.store, clone(ROWS), 'file.csv');
    const { body, etag } = await h.bootstrap();

    expect(etag).toMatch(/^"[0-9a-f]{20}"$/);
    const dates = body.transactions.map((t) => t.Date);
    expect(dates).toEqual([...dates].sort());
    expect(body.transactions.map((t) => t.id)).toEqual([0, 1, 2, 3]);
    body.transactions.forEach((t) => {
      expect(typeof t.AmountNum).toBe('number');
      expect(t.key).toBeTruthy();
      expect(t.accountId).toBeTruthy();
      expect(t.observedThrough).toBe('2026-07-20');
    });
    // "FNB Savings *9547" was the older name; the pipeline sees one account under the newer one.
    const names = [...new Set(body.transactions.map((t) => t.Account))].sort();
    expect(names).toEqual(['FNB Bank *9547', 'FNB Bank *9986']);

    expect(body.accounts.map((a) => a.id)).toEqual(['fnb|9547', 'fnb|9986']);
    expect(body.imports).toHaveLength(1);
    expect(body.imports[0]).toMatchObject({ fileName: 'file.csv', added: 4 });
    expect(body.budgets).toEqual([]);
    expect(body.goals).toEqual([]);
    expect(body.settings).toEqual({});
  });

  it('changes its ETag when a setting changes, and not when nothing does', async () => {
    const first = await h.bootstrap();
    const again = await h.bootstrap();
    expect(again.etag).toBe(first.etag);

    const put = await h.call('PUT', '/api/settings/monthRange', { value: 9 });
    expect(put.statusCode).toBe(200);
    const after = await h.bootstrap();
    expect(after.etag).not.toBe(first.etag);
    expect(after.body.settings).toEqual({ monthRange: 9 });
  });
});

describe('accounts', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
    await importRows(h.store, clone(ROWS), 'file.csv');
  });
  afterEach(() => h.close());

  const id = encodeURIComponent('fnb|9547');

  it('PATCH with a type override flips the liability flag, and clearing it keeps the type', async () => {
    const toCard = await h.call('PATCH', `/api/accounts/${id}`, { patch: { typeOverride: 'Credit Card' } });
    expect(toCard.statusCode).toBe(200);
    expect(toCard.json()).toMatchObject({ type: 'Credit Card', typeOverride: 'Credit Card', isLiability: true });

    const cleared = await h.call('PATCH', `/api/accounts/${id}`, { patch: { typeOverride: null } });
    expect(cleared.json()).toMatchObject({ type: 'Credit Card', typeOverride: null, isLiability: true });

    const { body } = await h.bootstrap();
    expect(body.accounts.find((a) => a.id === 'fnb|9547').isLiability).toBe(true);
  });

  it('PATCH accepts the statement-derived fields and refuses anything else', async () => {
    const ok = await h.call('PATCH', `/api/accounts/${id}`, {
      patch: { overdraftLimit: 10000, interestRate: 0.2175, minimumPayment: 1500, termMonths: 60, balloon: null, feesMonthly: 69, balanceAsOf: '2026-08-20' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ overdraftLimit: 10000, interestRate: 0.2175, termMonths: 60, balanceAsOf: '2026-08-20' });

    const unknown = await h.call('PATCH', `/api/accounts/${id}`, { patch: { rawName: 'Nope' } });
    expect(unknown.statusCode).toBe(400);
    const external = await h.call('PATCH', `/api/accounts/${id}`, { patch: { external: true } });
    expect(external.statusCode).toBe(400);
    const wrongShape = await h.call('PATCH', `/api/accounts/${id}`, { patch: { termMonths: 12.5 } });
    expect(wrongShape.statusCode).toBe(400);
    const missing = await h.call('PATCH', '/api/accounts/nobody', { patch: { label: 'x' } });
    expect(missing.statusCode).toBe(404);
  });

  it('POST creates an external account that bootstrap then lists in id order', async () => {
    const created = await h.call('POST', '/api/accounts', {
      record: { source: 'statement', bank: 'Allan Gray', type: 'Other', mask: 'RA01', currentBalance: 250000, balanceAsOf: '2026-08-01' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: 'allan gray|ra01',
      rawName: 'Allan Gray Other *RA01',
      seenNames: ['Allan Gray Other *RA01'],
      external: true,
      source: 'statement',
      currentBalance: 250000,
      isLiability: false,
    });

    const duplicate = await h.call('POST', '/api/accounts', { record: { source: 'manual', bank: 'Allan Gray', mask: 'RA01' } });
    expect(duplicate.statusCode).toBe(409);

    const anonymous = await h.call('POST', '/api/accounts', { record: { source: 'manual', rawName: 'Cash under the mattress' } });
    expect(anonymous.statusCode).toBe(201);
    expect(anonymous.json().id).toMatch(/^ext\|[0-9a-f]{8}$/);

    const badSource = await h.call('POST', '/api/accounts', { record: { source: 'guess', rawName: 'x' } });
    expect(badSource.statusCode).toBe(400);

    const { body } = await h.bootstrap();
    expect(body.accounts.map((a) => a.id)).toEqual(['allan gray|ra01', anonymous.json().id, 'fnb|9547', 'fnb|9986']);
    expect(body.accounts.find((a) => a.id === 'allan gray|ra01').external).toBe(true);
  });

  it('DELETE removes only external accounts', async () => {
    const backed = await h.call('DELETE', `/api/accounts/${id}`, {});
    expect(backed.statusCode).toBe(404);

    await h.call('POST', '/api/accounts', { record: { source: 'manual', bank: 'Allan Gray', type: 'Other', mask: 'RA01' } });
    const gone = await h.call('DELETE', `/api/accounts/${encodeURIComponent('allan gray|ra01')}`, {});
    expect(gone.statusCode).toBe(200);
    const { body } = await h.bootstrap();
    expect(body.accounts.map((a) => a.id)).toEqual(['fnb|9547', 'fnb|9986']);

    const twice = await h.call('DELETE', `/api/accounts/${encodeURIComponent('allan gray|ra01')}`, {});
    expect(twice.statusCode).toBe(404);
  });

  it('an import folds an external account in when its transactions arrive, keeping what was typed', async () => {
    await h.call('POST', '/api/accounts', {
      record: { source: 'statement', bank: 'Nedbank', type: 'Credit Card', mask: '4714', currentBalance: -12000, creditLimit: 40000 },
    });
    await importRows(h.store, [row('2026-07-01', 'Fuel', 'Nedbank Credit Card *4714', -800)], 'later.csv');
    const { body } = await h.bootstrap();
    const account = body.accounts.find((a) => a.id === 'nedbank|4714');
    expect(account.external).toBe(false);
    expect(account.currentBalance).toBe(-12000);
    expect(account.creditLimit).toBe(40000);
    expect(account.seenThrough).toBe('2026-07-01');
  });
});

describe('POST /api/migrate', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
  });
  afterEach(() => h.close());

  /** What the browser's Dexie tables look like when dumped — rows already keyed and stamped. */
  function dump() {
    const stamp = '2026-08-10T08:00:00.000Z';
    const transactions = [
      { ...row('2026-06-01', 'Checkers', 'FNB Savings *9547', -250), id: 0 },
      { ...row('2026-07-02', 'Woolworths', 'FNB Bank *9986', -430, { Status: 'Pending' }), id: 1 },
    ].map((r) => ({
      ...r,
      key: `${r.Date}|${r.Account === 'FNB Bank *9986' ? 'fnb|9986' : 'fnb|9547'}|${Math.round(r.AmountNum * 100)}|${r.Description.toLowerCase()}`,
      accountId: r.Account === 'FNB Bank *9986' ? 'fnb|9986' : 'fnb|9547',
      payMonth: r['Pay Month'],
      date: r.Date,
      firstSeen: stamp,
      lastSeen: stamp,
      observedThrough: '2026-07-02',
    }));
    return {
      transactions,
      accounts: [
        {
          id: 'fnb|9547', bank: 'FNB', type: 'Savings', typeOverride: null, mask: '9547', rawName: 'FNB Savings *9547',
          seenNames: ['FNB Savings *9547'], seenThrough: '2026-06-01', label: 'Rainy day', isLiability: false,
          currentBalance: 1234, balanceAsOf: '2026-08-01', creditLimit: null, hidden: false,
        },
        {
          id: 'fnb|9986', bank: 'FNB', type: 'Bank', typeOverride: null, mask: '9986', rawName: 'FNB Bank *9986',
          seenNames: ['FNB Bank *9986'], seenThrough: '2026-07-02', label: null, isLiability: false,
          currentBalance: null, balanceAsOf: null, creditLimit: null, hidden: false,
        },
      ],
      imports: [{ id: 1, fileName: 'old.csv', importedAt: stamp, rowsTotal: 2, added: 2, updated: 0, unchanged: 0, superseded: 0, dateFrom: '2026-06-01', dateTo: '2026-07-02', vintage: '2026-07-02', accountsNew: ['FNB Savings *9547', 'FNB Bank *9986'], accountsRenamed: [], updatedExamples: [] }],
      budgets: [{ scope: 'default', category: 'Groceries', amount: 6000 }],
      goals: [{ id: 7, name: 'Emergency fund', target: 50000, saved: 1000, createdAt: '2026-08-01T00:00:00.000Z' }],
      settings: [{ key: 'monthRange', value: 4 }, { key: 'selectedAccountIds', value: ['fnb|9986'] }],
    };
  }

  it('lands everything once, and a second post changes nothing', async () => {
    const first = await h.call('POST', '/api/migrate', dump());
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      transactions: { inserted: 2, updated: 0, kept: 0 },
      accounts: { inserted: 2, merged: 0 },
      imports: { inserted: 1, skipped: 0 },
      goals: { inserted: 1, existing: 0 },
    });
    const { body, etag } = await h.bootstrap();
    expect(body.transactions).toHaveLength(2);
    expect(body.transactions.map((t) => t.id)).toEqual([0, 1]);
    expect(body.accounts.find((a) => a.id === 'fnb|9547')).toMatchObject({ currentBalance: 1234, label: 'Rainy day' });
    expect(body.imports).toHaveLength(1);
    expect(body.budgets).toEqual([{ scope: 'default', category: 'Groceries', amount: 6000 }]);
    expect(body.goals).toHaveLength(1);
    expect(body.goals[0]).toMatchObject({ name: 'Emergency fund', createdAt: '2026-08-01T00:00:00.000Z' });
    expect(body.settings).toEqual({ monthRange: 4, selectedAccountIds: ['fnb|9986'] });

    const second = await h.call('POST', '/api/migrate', dump());
    expect(second.json()).toMatchObject({
      transactions: { inserted: 0, updated: 0, kept: 2 },
      accounts: { inserted: 0, merged: 0 },
      imports: { inserted: 0, skipped: 1 },
      goals: { inserted: 0, existing: 1 },
    });
    const after = await h.bootstrap();
    expect(after.etag).toBe(etag);
    expect(after.body.transactions).toHaveLength(2);
    expect(after.body.goals).toHaveLength(1);
  });

  it('keeps a balance the browser knew when the server has none, and the newer sighting of a row', async () => {
    // The server imported a newer file first: the same account, no balance typed, and Woolworths settled.
    await importRows(h.store, [
      row('2026-07-02', 'Woolworths', 'FNB Bank *9986', -430, { Status: 'Completed' }),
      row('2026-07-20', 'Makro', 'FNB Bank *9547', -900),
    ], 'newer.csv');

    const r = await h.call('POST', '/api/migrate', dump());
    expect(r.json().transactions).toEqual({ inserted: 1, updated: 0, kept: 1 });
    // Only the savings account gains anything from the dump; the cheque account is identical.
    expect(r.json().accounts).toEqual({ inserted: 0, merged: 1 });

    const { body } = await h.bootstrap();
    const savings = body.accounts.find((a) => a.id === 'fnb|9547');
    expect(savings.currentBalance).toBe(1234);
    expect(savings.label).toBe('Rainy day');
    // The server's newer name wins; the browser's older one is remembered.
    expect(savings.rawName).toBe('FNB Bank *9547');
    expect(savings.seenNames).toEqual(expect.arrayContaining(['FNB Savings *9547', 'FNB Bank *9547']));
    // The browser's Pending copy of Woolworths does not undo the server's settled one.
    expect(body.transactions.find((t) => t.Description === 'Woolworths').Status).toBe('Completed');
  });
});

describe('targets, goals and settings', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
  });
  afterEach(() => h.close());

  it('round-trip through bootstrap', async () => {
    expect((await h.call('PUT', `/api/budgets/default/${encodeURIComponent('Home & Garden')}`, { amount: 1500 })).statusCode).toBe(200);
    expect((await h.call('PUT', '/api/budgets/default/Groceries', { amount: 'lots' })).statusCode).toBe(400);
    const goal = await h.call('POST', '/api/goals', { goal: { name: 'Holiday', target: 20000, saved: 0 } });
    expect(goal.statusCode).toBe(201);
    expect(goal.json()).toMatchObject({ id: expect.any(Number), name: 'Holiday', createdAt: expect.any(String) });
    await h.call('PUT', '/api/settings/monthlySaving', { value: 2500 });

    let { body } = await h.bootstrap();
    expect(body.budgets).toEqual([{ scope: 'default', category: 'Home & Garden', amount: 1500 }]);
    expect(body.goals).toHaveLength(1);
    expect(body.settings).toEqual({ monthlySaving: 2500 });

    expect((await h.call('DELETE', `/api/budgets/default/${encodeURIComponent('Home & Garden')}`, {})).statusCode).toBe(200);
    expect((await h.call('DELETE', `/api/goals/${goal.json().id}`, {})).statusCode).toBe(200);
    expect((await h.call('DELETE', `/api/goals/${goal.json().id}`, {})).statusCode).toBe(404);
    ({ body } = await h.bootstrap());
    expect(body.budgets).toEqual([]);
    expect(body.goals).toEqual([]);
  });
});

describe('the rest', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness();
    await h.signIn();
    await importRows(h.store, clone(ROWS), 'file.csv');
  });
  afterEach(() => h.close());

  it('exports the original columns in the original order', async () => {
    const r = await h.call('GET', '/api/export.csv');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/csv/);
    const lines = r.body.trim().split('\n');
    expect(lines[0]).toBe('Date,Description,Account,Spending Group,Category,Pay Month,Split Transaction,Currency,Amount,Original Currency,Original Amount,Type,Status,Tags,Notes');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('"2026-06-01"');
  });

  it('wipes everything except the passphrase, with the word', async () => {
    expect((await h.call('DELETE', '/api/data', {})).statusCode).toBe(400);
    expect((await h.call('DELETE', '/api/data', { confirm: 'DELETE' })).statusCode).toBe(200);
    const { body } = await h.bootstrap();
    expect(body.transactions).toEqual([]);
    expect(body.accounts).toEqual([]);
    expect(body.imports).toEqual([]);
    const status = await h.call('GET', '/api/auth/status');
    expect(status.json()).toEqual({ configured: true, authenticated: true });
  });

  it('answers health publicly and unknown API paths with JSON', async () => {
    const health = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ ok: true, db: 'ok', backend: 'pglite' });
    const missing = await h.call('GET', '/api/nothing-here');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'Not found' });
  });
});
