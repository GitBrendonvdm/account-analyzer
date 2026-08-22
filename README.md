# Transaction Analyzer

A local dashboard for South African bank exports. It reads your pay cycle (23rd → 22nd) rather than
the calendar month, forecasts the rest of the current cycle, and tells you what the numbers mean
instead of only printing them.

Your data lives on your own server, behind a passphrase you choose the first time you open the app,
and is reachable from any browser you sign in on. Nothing goes to a third party.

```bash
npm install
npm run server     # the API + database on http://localhost:8080
npm run dev        # the app on http://localhost:3000, proxying /api to 8080
```

Import a CSV export (see `public/sample-transactions.csv` for the shape). Then open **Accounts** and
enter what each account holds today — one number each. That single step turns positions into real
balances and unlocks net worth, the debt trajectory and payoff dates.

## What it shows

**Headlines** — the three to five biggest facts in your data, as sentences, each carrying the
arithmetic behind it. The deficit and what's funding it, what the debt costs, which card is running
out of room.

**Table** — income and spend per pay cycle, nested under the export's own Spending Group, with a
forecast to payday. Columns left of the divider are what happened; everything right of it is a
projection, and the header says so.

**Charts** — running net total and per-period net, projected to the next payday.

**Habits** — who you actually pay. Merchants rather than categories, standing commitments with
their annual cost, which categories are rising or falling, and the weekday shape of a typical cycle.

**Plan** — safe to spend today, per-category targets judged against where the cycle is *heading*,
a twelve-cycle trajectory with debt crossing dates, a ranked way to close the gap, and goals with
honest arrival dates.

**Accounts** — balances, per-cycle positions, what the debt costs, and per-account movement.

## Importing

Imports **add**; they never replace. Each export covers a sliding window — comparing two files two
weeks apart, 66 rows arrived and 67 fell off the front — so replacing the dataset on every upload
silently destroyed history. Instead:

- A row is identified by date + account + amount + description. Exact duplicates within one file are
  numbered, so two identical coffees both survive.
- Accounts are identified by bank + mask, so an export renaming `FNB Savings *9547` to
  `FNB Bank *9547` keeps one account rather than splitting its history.
- Every file carries a **vintage** — its latest transaction date. An older export may only add rows,
  never revise them, so importing an old file to recover history can't roll a settled transaction
  back to Pending.
- Anything you author — balances, card limits, account names, targets, goals — survives every future
  import.

Import order doesn't matter. Any sequence of the same files converges on the same data.

## Server & database

The app is a single Node process (Fastify) that serves the built SPA and a JSON API under `/api`.
The API stores everything in Postgres; where that Postgres lives is decided by one variable:

- **`DATABASE_URL` set** — the real thing. On Coolify this is the `analyzer` Postgres 16 service on
  the internal docker network (`postgres://analyzer:…@<host>:5432/analyzer`).
- **`DATABASE_URL` unset** — the same schema on [PGlite](https://pglite.dev) (Postgres compiled to
  WebAssembly), persisted under `./data/pglite`. This is what `npm run server` uses locally, and the
  tests use it in memory. `data/` is gitignored.

The schema is applied at boot from `server/db/migrations/` and recorded in `schema_migrations`;
restarting is safe.

**The passphrase.** The first visit asks you to choose one (at least 8 characters); every visit after
that asks you to type it. It is stored as an scrypt hash and the session is a 30-day HttpOnly cookie.
There is no reset link. If it is lost, restart the server once with `RESET_PASSPHRASE=1` — the hash is
cleared, every session is signed out, and the next visit chooses again. Remove the variable afterwards.

**Moving a browser's old data up.** Before the server existed everything lived in the browser's
IndexedDB. A browser that still holds rows, opened against an empty server, shows a banner offering
to move them; the merge is careful (it keeps whichever side saw a row more recently and never loses
a balance you typed) and idempotent, so pressing it twice is harmless.

**Backups.** `GET /api/export.csv` (signed in) returns every transaction as a CSV with the export's own
columns in their original order. It re-imports cleanly — the app recognises every row it already
holds — so a periodic download is a complete backup of the transactions. Balances, labels, targets
and goals live in Postgres; back those up with Coolify's database backups.

**Routes**, all JSON, all under `/api`: `auth/status|setup|login|logout`, `bootstrap` (everything,
with an ETag), `import` (`{ fileName, text }`), `migrate` (a Dexie dump), `accounts` (`POST`, `PATCH
/:id`, `DELETE /:id` for external ones), `budgets/:scope/:category`, `goals`, `settings/:key`,
`export.csv`, `data` (`DELETE` with `{ confirm: 'DELETE' }` to start over), and `health`.

```bash
npm run server        # API on :8080 (PGlite under ./data unless DATABASE_URL is set)
npm run test:server   # the server's tests, against PGlite in memory
```

## Automated ingestion

`npm run ingest` watches a folder and merges everything that lands in it into one append-only master
export, using the same rules as the app.

```bash
npm run ingest                                  # watch ./inbox
npm run ingest -- --once                        # single pass, for cron or CI
npm run ingest -- --inbox ./mail --master ./data/all.csv
```

Processed files are moved to `inbox/processed/`. Re-ingesting the master is a no-op, so it's safe to
run on a schedule.

**The bank side is a one-off job for you.** This tool won't sign into FNB or Nedbank — automated
logins against a retail banking portal generally breach the bank's terms, and a script holding your
credentials is what a bank points at when declining a fraud claim. What to set up instead:

1. In your banking app (and/or whichever service produces these exports), schedule a statement or
   transaction export to be emailed on a regular cadence.
2. Point a mail rule at a dedicated folder, and have it save attachments into `./inbox`.
3. Run `npm run ingest` on a schedule, or leave it watching.
4. Import the master file into the app when you want fresh numbers.

The proper alternative — consent-based aggregation where you authenticate at the bank and a provider
hands the app clean JSON — exists in South Africa (Stitch, BankLink) but is built for merchants and
expects company registration. Worth revisiting if the email route proves brittle.

## CSV format

The export's own columns are used as-is. Required:

| Column | Description |
|---|---|
| `Date` | Transaction date (`YYYY-MM-DD`) |
| `Description` | Transaction description |
| `Account` | e.g. `FNB Bank *9986` — bank, type and mask |
| `Category` | Grouping category |
| `Pay Month` | Cycle key, e.g. `2026-06` |
| `Amount` | Numeric, negative = expense |

Optional, used when present: `Spending Group` (adds a nesting level), `Status` (a `Pending` row can
be revised by a later export), `Type`.

## How the numbers work

- **Pay cycles, not months.** Boundaries come from the export's own `Pay Month` column rather than a
  hardcoded payday, so the weeks always tile the period the transactions belong to.
- **The forecast** locks completed weeks at their actuals, prorates the current week by how much of
  it is left, and carries typical spend for later weeks. Bills aren't prorated — a debit order that
  always lands Friday isn't written off on Thursday.
- **Averages** are recency-weighted with outlier cycles capped, so one abnormal month can't set the
  level.
- **Loan accounts are excluded from the flows.** The interest, fees and credit insurance charged
  inside a loan are already contained in the instalment leaving your bank; counting both would bill
  the same money twice. The **Accounts** tab shows that cost separately, as analysis.
- **Transfers net to zero** by definition — both legs are the same money — so the group total is
  zero and the detail rows show gross volume instead.
- **Overdue** only flags payments that repeat at a *consistent amount*, measured against the data's
  last date rather than the wall clock. Presence alone used to flag nine categories including
  Clothing.

## Scripts

```bash
npm run dev          # dev server on :3000 (proxies /api to :8080)
npm run server       # API + database on :8080
npm test             # unit tests, app and server
npm run backtest     # replay the forecast over past cycles and score it
npm run ingest       # watch a folder and merge exports
npm run lint
npm run build
```

Real exports go in `test-data/` (gitignored). The dev server serves the newest one at
`/__fixture.csv`, and `?index=1` reaches the one before it.
