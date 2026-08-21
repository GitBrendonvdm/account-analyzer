# Transaction Analyzer

A local dashboard for South African bank exports. It reads your pay cycle (23rd → 22nd) rather than
the calendar month, forecasts the rest of the current cycle, and tells you what the numbers mean
instead of only printing them.

Everything stays on your machine. No server, no account, no data leaves the browser.

```bash
npm install
npm run dev        # http://localhost:3000
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
npm run dev          # dev server on :3000
npm test             # unit tests
npm run backtest     # replay the forecast over past cycles and score it
npm run ingest       # watch a folder and merge exports
npm run lint
npm run build
```

Real exports go in `test-data/` (gitignored). The dev server serves the newest one at
`/__fixture.csv`, and `?index=1` reaches the one before it.
