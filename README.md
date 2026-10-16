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

**Today** — opens on two answers, then the safe-to-spend figure. *Is net worth going up or down?* The
number, how far it has moved this cycle, and a bar per month; it counts everything, the loans too, so a
refinance reads as debt moving rather than a leap, and a loan with no balance of its own is valued at what
the loan engine says is owed (the card says so). *Do the everyday accounts spend more than they take in?*
The cheque account(s) and card(s) the money actually moves through (found by activity, including ones
closed lately), a verdict from the median of the finished cycles, and a bar per cycle. Everything that
explains those — six vitals (savings rate, debt-service ratio, interest burden, runway, card utilisation,
the deficit), what is coming up with a status per bill and the day-by-day cash path to payday, this
cycle's in and out, and where the money goes — is folded under its own bar, closed until you open it.

**Every screen follows one shape**: the answer it exists for first, the explanation folded under bars
that stay closed until opened, forms in dialogs rather than on the page, and no more than one table in
view at a time.

**Headlines** — the biggest fact in your data, as a sentence carrying the arithmetic behind it, above
every screen but the first two; the other three or four fold under "N more things worth knowing". They
cover which payoff order clears everything by when and what it saves, what the deficit costs in card
interest, debt service as a share of income, what is genuinely overdue.

**Ledger** — income and spend per pay cycle, nested under the export's own Spending Group, with a
forecast to payday. Columns left of the divider are what happened; everything right of it is a
projection, and the header says so. Anything counted twice is raised above the table; finding a
payment, the providers and the rules are folded (a draft rule opens its bar by itself).

**Trends** — net worth, month by month: one bar per pay cycle, green up and red down, the cycle in
progress faint. The running net total and per-period net are folded under it.

**Habits** — where money can be found. Standing charges first (the totals by kind, the lines behind
them folded: cadence, annual cost, price increases as steps), then folded: new and stopped charges,
what changed (median + MAD drift) with trips versus tickets, the merchants, and the weekday shape.

**Plan** — safe to spend, a direction table (three cycles against twelve), "what would it take" to
be debt-free by a date, per-category targets judged against where the cycle is *heading*, a
twelve-cycle trajectory, a ranked way to close the gap, every standing charge, and goals.

**Debt** — what you owe, what it costs a cycle and when it is gone, then each liability's rate,
instalment, fees and remaining term read off its own ledger (typed values win and are labelled; the
pencil opens them in a dialog) and the deficit in one line. Folded under it: the plan and its payoff
strategies — minimum, avalanche, snowball, lifetime, short-term effect, custom — with the cascade of
freed instalments, the balance chart and freed-cash timeline, what R1 000 extra is worth on each debt,
a lump-sum what-if, and rate sensitivity.

**Accounts** — one list of balances with their as-of date and where they came from, then what you
own, then the folded detail: per-cycle positions, what the debt costs with the fees audit, cash in and
out, and per-account movement.

**What you own.** A house or a car is worth money no bank statement shows, and it goes up and down. Add
one under **Accounts → What you own** with a name, a kind, the day you received it and what it was worth
then, and (optionally) the loans taken out against it so the list can say how much of it is yours once
they are paid. Whenever you check what it is worth, log it with the day: net worth moves in a straight
line from one logged value to the next, so a house bought at R600k and worth R630k a year later adds
R2.5k to net worth each month rather than R30k in the month you looked, and a car at R400k, R300k, R100k
and then R150k falls for two years and rises in the third, month by month. After the last value it
holds that figure; before the day you received it, it is not counted. Stored in the settings
(`assets`); no schema.

Every chart is interactive: drag to zoom, hover for the readout, click a legend entry to hide it.

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

**FNB's own history files.** In FNB online banking, *Transaction history → Download* gives one zip per
account with a CSV inside. Drop the zips on **Import** exactly as they came — several at once is fine,
and a zip of zips is not needed. This is the bank's own record rather than an aggregator's reading of it,
and it carries a running balance on every line, which the app uses three ways:

- **It proves the file.** Each line's balance must be the line below it plus its amount. A line that
  breaks the chain is reported ("a transaction may be missing — upload a longer window"). A line that
  never moved the balance (an unpaid debit order's collection attempt is printed as a credit) is left
  out so it cannot count as income, and eBucks, whose amounts are points, is left out with a reason.
- **It states the balance.** The header's balance becomes the account's balance on its newest line, so
  nobody types it in; a limit it implies fills a gap but never overwrites one a statement printed.
- **It meets what is already held.** Files of one account overlap and are merged first. A line is then
  recognised as already held either by key (a repeat of an earlier history file) or as the same
  transaction the old aggregator export described in other words — same account, same amount to the
  cent, dated within two days, one for one — so the weeks the two sources overlap are not counted twice.
  Rows you have corrected are never sent again, so a correction survives every re-upload.

You only need to upload the accounts you spend from — cheque and card. Everything else is inferred (below).

**Loans you do not upload.** Once the app has seen a loan's own rows — from its history file, its
statement, or the old export — it knows the loan: rate (read off the interest postings, ACT/365),
instalment, posting day, monthly fee. After the loan's last real row it writes the rows the loan would
have shown, on every load and never stored: each payment it can see leaving another account (matched by
what the payments were *called* — "fnb home", "toyota fin" — or, failing that, by an amount equal to
the instalment), the interest the balance would have attracted day by day, and the fee. The estimate
stops where the paying account's history stops, is labelled under **Accounts**, and disappears the day
the loan's own rows catch up or you type its balance. A loan whose rate it has only assumed is not
projected. (`lib/loanProjection.js`; on a simulated bond it reproduces two hidden months to within R3.)

**Checking against the bank's statement.** **Check statement** (or drop the PDF on Import) reads the
official FNB account statement by its columns and holds the app against it: opening and closing balance
side by side, then every line. The statement proves itself first — its running balance, closing balance
and the bank's own turnover count and total must agree, or it says it may have been misread. A line the
statement has and the app lacks can be added (through the same door as any bank line, so it is paired
and categorised and cannot be counted twice); the statement's facility limit can replace a derived one.
Cheque/savings layouts only; a card or loan statement says it is not read yet.

**Accounts** is one list, grouped by type, with net worth above it; each line has an **Edit** that opens a
dialog (name, balance, the day it was read, limit, **Close this account…**, **Hide**), so there is no form on
the page. The tables below it (balance at each pay cycle, what the debt costs, cash in and out, account
movement) are folded. A hidden account leaves every list, chart and total — nothing is deleted — and
**Manage** under the list shows it again; accounts quiet for over a year with nothing held get one line to
hide them together.

**Paid off or closed.** Nothing in a bank's data says a loan was cleared, so the app *suggests*: a loan
whose estimated balance is met (within 15%) by one large settlement-like payment out of another
account, or an account that has been quiet for a month with nothing still arriving and no balance
held. Press **Close** on its line under **Accounts** and the account ends at exactly nothing: closing records the one
transaction that gets it there (a payment in for a debt, a withdrawal out for money held — filed as a
movement between your own accounts, so it is neither income nor spending), sized from what the ledger
says it holds that day, or for a loan from what the loan engine says is owed. Earlier months keep the
balance they had. Payments expected of it stop, its estimate stops, and the bills it used to pay carry
on from the account that took over, as one line with their whole history. **Reopen** deletes the
settlement and restores the balance the account stated before.

**Account-summary PDFs.** The *Account summary* button takes the "account overview" PDF that FNB
and Nedbank online banking print. FNB's has a text layer; Nedbank's is an image and is read by OCR
in your browser (nothing leaves it). Each account is matched to a known account by the last four
digits of its number, a preview shows what would change, and on confirm balances, as-of dates and
derived card/overdraft limits are written; balances the export never sees (a retirement annuity,
an emergency fund) become external accounts so net worth is complete.

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
with an ETag), `import` (`{ fileName, text }`), `import/bank` (`{ files: [{ name, text }] }`, FNB history files), `migrate` (a Dexie dump), `accounts` (`POST`, `PATCH
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
- **Exceptions are split, not moved.** A category that usually costs R10 000 and cost R15 000 this
  cycle is still a R10 000 category: the usual stays where it is and only the R5 000 goes to
  Exceptions, so the averages and the forecast keep describing an ordinary cycle while the surprise
  stays visible and still counted. The surplus comes off the largest transactions of that cycle, so
  it can always be pointed at. A category seen in only one cycle is exceptional in full. A raised
  cycle sitting next to another raised one is left alone — a bill that has gone up is a new level,
  not the same surprise twice — and pay is never split, because two salary runs in one cycle are a
  matter of timing rather than of earning more.
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
