-- The browser's six Dexie tables, moved to Postgres, plus what a server needs that a browser did
-- not: who may read them, and a version counter so a client can tell whether anything changed.
--
-- Every table keeps the full object the app already works with as jsonb (`row`, `record`,
-- `summary`, `goal`) and lifts out only the columns worth indexing. That is deliberate: the shape
-- the pipeline consumes is decided in src/, and duplicating it as forty typed columns would mean
-- two places to change when a field is added.

create table if not exists transactions (
  key               text primary key,
  account_id        text not null,
  date              date not null,
  pay_month         text not null,
  category          text,
  amount_cents      bigint not null,
  row               jsonb not null,
  first_seen        timestamptz not null,
  last_seen         timestamptz not null,
  observed_through  date,
  import_id         integer
);
create index if not exists transactions_date_idx       on transactions (date);
create index if not exists transactions_pay_month_idx  on transactions (pay_month);
create index if not exists transactions_account_idx    on transactions (account_id);
create index if not exists transactions_category_idx   on transactions (category);

create table if not exists accounts (
  id          text primary key,
  record      jsonb not null,
  updated_at  timestamptz not null
);

create table if not exists imports (
  id           serial primary key,
  imported_at  timestamptz not null,
  summary      jsonb not null
);

create table if not exists budgets (
  scope     text not null,
  category  text not null,
  amount    double precision not null,
  primary key (scope, category)
);

create table if not exists goals (
  id          serial primary key,
  created_at  timestamptz not null,
  goal        jsonb not null
);

create table if not exists settings (
  key    text primary key,
  value  jsonb
);

-- Single-user by design: one row, one passphrase. The session secret is minted at first boot and
-- kept for signed tokens later; nothing reads it yet.
create table if not exists auth (
  id               integer primary key check (id = 1),
  passphrase_hash  text,
  session_secret   text not null,
  created_at       timestamptz not null,
  updated_at       timestamptz not null
);

create table if not exists sessions (
  token_hash  text primary key,
  created_at  timestamptz not null,
  expires_at  timestamptz not null
);

-- Bumped inside every mutating transaction; GET /api/bootstrap hashes it into an ETag.
create table if not exists meta (
  key    text primary key,
  value  text not null
);
insert into meta (key, value) values ('data_version', '1') on conflict (key) do nothing;
