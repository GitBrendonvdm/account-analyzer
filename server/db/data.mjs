import { createHash } from 'node:crypto';

/**
 * Every read and write the routes need, as plain functions over a connection.
 *
 * The routes stay thin and the SQL stays in one file, which matters more than usual here because
 * the same statements have to hold up on two backends (see adapter.mjs). Each function takes the
 * connection as its first argument so the same code runs inside a transaction or outside one.
 *
 * Rows go in and out as the objects the browser already works with. The typed columns beside the
 * jsonb exist for indexes and for the export, never as a second source of truth: when a row is
 * written the columns are derived from the object, and when it is read only the object comes back.
 */

const CHUNK = 200;

// ---- versioning -------------------------------------------------------------------------------

/** Call inside every mutating transaction. The bootstrap ETag is a hash of this counter. */
export async function bumpVersion(conn) {
  await conn.query(
    `update meta set value = ((value::bigint) + 1)::text where key = 'data_version'`,
  );
}

export async function dataVersion(conn) {
  const { rows } = await conn.query(`select value from meta where key = 'data_version'`);
  return rows[0]?.value ?? '0';
}

export function etagFor(version) {
  return `"${createHash('sha256').update(`mv:${version}`).digest('hex').slice(0, 20)}"`;
}

// ---- transactions -----------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const DMY = /^(\d{2})\/(\d{2})\/(\d{4})/;

/** The `date` column wants a real date; the export writes ISO, older hand-made files wrote DMY. */
export function isoDate(value) {
  if (!value) return null;
  const iso = String(value).match(ISO);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = String(value).match(DMY);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

function columnsOf(row, importId) {
  const date = isoDate(row.date ?? row.Date);
  if (!date) throw Object.assign(new Error(`Row has no usable date: ${JSON.stringify(row.Date)}`), { statusCode: 400 });
  return [
    row.key,
    row.accountId,
    date,
    row.payMonth ?? row['Pay Month'] ?? '',
    row.Category ?? null,
    Math.round((Number(row.AmountNum ?? row.Amount) || 0) * 100),
    JSON.stringify(row),
    row.firstSeen ?? new Date().toISOString(),
    row.lastSeen ?? row.firstSeen ?? new Date().toISOString(),
    isoDate(row.observedThrough),
    importId ?? null,
  ];
}

/**
 * Insert-or-replace by key, in chunks. The caller has already decided which rows may be written —
 * the vintage rule lives in the importer, not here — so an existing key is simply overwritten.
 */
export async function upsertTransactions(conn, rows, importId = null) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((row) => {
      const cols = columnsOf(row, importId);
      const base = params.length;
      params.push(...cols);
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`;
    });
    await conn.query(
      `insert into transactions
         (key, account_id, date, pay_month, category, amount_cents, row, first_seen, last_seen, observed_through, import_id)
       values ${tuples.join(',')}
       on conflict (key) do update set
         account_id = excluded.account_id,
         date = excluded.date,
         pay_month = excluded.pay_month,
         category = excluded.category,
         amount_cents = excluded.amount_cents,
         row = excluded.row,
         first_seen = excluded.first_seen,
         last_seen = excluded.last_seen,
         observed_through = excluded.observed_through,
         import_id = excluded.import_id`,
      params,
    );
  }
}

/** The stored rows for a set of keys, as a Map. Keys not held are simply absent. */
export async function transactionsByKey(conn, keys) {
  const found = new Map();
  for (let i = 0; i < keys.length; i += 1000) {
    const { rows } = await conn.query(
      `select key, row from transactions where key in (select jsonb_array_elements_text($1::jsonb))`,
      [JSON.stringify(keys.slice(i, i + 1000))],
    );
    rows.forEach((r) => found.set(r.key, r.row));
  }
  return found;
}

export async function countTransactions(conn) {
  const { rows } = await conn.query('select count(*)::int as n from transactions');
  return rows[0].n;
}

/**
 * Everything, oldest first, exactly as the browser's loadAllTransactions produced it: sorted by
 * Date, `id` the position in that order, and `Account` rewritten to the account's canonical raw
 * name so a renamed account reads as one account downstream. See src/db/db.js for why the raw
 * name and not the user's label.
 */
export async function listTransactions(conn, accounts) {
  const { rows } = await conn.query('select row from transactions order by key');
  const canonical = new Map(accounts.map((a) => [a.id, a.rawName]));
  const list = rows.map((r) => r.row);
  list.sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
  list.forEach((r, i) => {
    r.id = i;
    r.Account = canonical.get(r.accountId) ?? r.Account;
  });
  return list;
}

// ---- accounts ---------------------------------------------------------------------------------

export async function accountsById(conn, ids) {
  if (!ids.length) return new Map();
  const { rows } = await conn.query(
    `select id, record from accounts where id in (select jsonb_array_elements_text($1::jsonb))`,
    [JSON.stringify(ids)],
  );
  return new Map(rows.map((r) => [r.id, r.record]));
}

export async function getAccount(conn, id) {
  const { rows } = await conn.query('select record from accounts where id = $1', [id]);
  return rows[0]?.record ?? null;
}

/** Writes only records that differ, and says how many did, so re-sending the same data is a no-op. */
export async function putAccounts(conn, records) {
  let changed = 0;
  for (const record of records) {
    const { rowCount } = await conn.query(
      `insert into accounts (id, record, updated_at) values ($1, $2, now())
       on conflict (id) do update set record = excluded.record, updated_at = now()
       where accounts.record is distinct from excluded.record`,
      [record.id, JSON.stringify(record)],
    );
    changed += rowCount > 0 ? 1 : 0;
  }
  return changed;
}

export async function deleteAccount(conn, id) {
  const { rowCount } = await conn.query('delete from accounts where id = $1', [id]);
  return rowCount > 0;
}

export async function listAccounts(conn) {
  const { rows } = await conn.query('select record from accounts order by id');
  return rows.map((r) => r.record);
}

// ---- imports ----------------------------------------------------------------------------------

export async function addImport(conn, summary) {
  const { rows } = await conn.query(
    'insert into imports (imported_at, summary) values ($1, $2) returning id',
    [summary.importedAt, JSON.stringify(summary)],
  );
  return rows[0].id;
}

export async function hasImport(conn, fileName, importedAt) {
  const { rows } = await conn.query(
    `select 1 from imports where summary->>'fileName' = $1 and summary->>'importedAt' = $2 limit 1`,
    [fileName ?? '', importedAt ?? ''],
  );
  return rows.length > 0;
}

/** Newest first, the order the import log is read in. */
export async function listImports(conn) {
  const { rows } = await conn.query('select id, summary from imports order by imported_at desc, id desc');
  return rows.map((r) => ({ ...r.summary, id: r.id }));
}

// ---- budgets, goals, settings -----------------------------------------------------------------

export async function putBudget(conn, scope, category, amount) {
  const { rowCount } = await conn.query(
    `insert into budgets (scope, category, amount) values ($1, $2, $3)
     on conflict (scope, category) do update set amount = excluded.amount
     where budgets.amount is distinct from excluded.amount`,
    [scope, category, amount],
  );
  return rowCount > 0;
}

export async function deleteBudget(conn, scope, category) {
  const { rowCount } = await conn.query('delete from budgets where scope = $1 and category = $2', [scope, category]);
  return rowCount > 0;
}

export async function listBudgets(conn) {
  const { rows } = await conn.query('select scope, category, amount from budgets order by scope, category');
  return rows.map((r) => ({ scope: r.scope, category: r.category, amount: Number(r.amount) }));
}

export async function addGoal(conn, goal) {
  const { rows } = await conn.query(
    'insert into goals (created_at, goal) values ($1, $2) returning id',
    [goal.createdAt, JSON.stringify(goal)],
  );
  return { ...goal, id: rows[0].id };
}

export async function findGoal(conn, createdAt, name) {
  const { rows } = await conn.query(
    `select id from goals where goal->>'createdAt' = $1 and goal->>'name' = $2 limit 1`,
    [createdAt ?? '', name ?? ''],
  );
  return rows[0]?.id ?? null;
}

export async function deleteGoal(conn, id) {
  const { rowCount } = await conn.query('delete from goals where id = $1', [id]);
  return rowCount > 0;
}

export async function listGoals(conn) {
  const { rows } = await conn.query('select id, goal from goals order by created_at, id');
  return rows.map((r) => ({ ...r.goal, id: r.id }));
}

export async function putSetting(conn, key, value) {
  const { rowCount } = await conn.query(
    `insert into settings (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value
     where settings.value is distinct from excluded.value`,
    [key, JSON.stringify(value ?? null)],
  );
  return rowCount > 0;
}

/** As an object, `{ key: value }`, which is what the hooks read. */
export async function allSettings(conn) {
  const { rows } = await conn.query('select key, value from settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---- the lot ----------------------------------------------------------------------------------

export async function bootstrapPayload(conn) {
  const accounts = await listAccounts(conn);
  return {
    transactions: await listTransactions(conn, accounts),
    accounts,
    imports: await listImports(conn),
    budgets: await listBudgets(conn),
    goals: await listGoals(conn),
    settings: await allSettings(conn),
  };
}

/** Everything the user holds, gone. Auth and sessions stay: starting over is not logging out. */
export async function wipeData(conn) {
  for (const table of ['transactions', 'accounts', 'imports', 'budgets', 'goals', 'settings']) {
    await conn.query(`delete from ${table}`);
  }
  await bumpVersion(conn);
}
