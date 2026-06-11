# Transaction Analyzer

A React dashboard for analyzing bank transactions from CSV exports. Upload your data, filter by account, and view monthly income/expense breakdowns with expandable categories and expected-value projections.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 and upload a CSV file (see `public/sample-transactions.csv` for format).

## CSV format

Required columns:

| Column    | Description                          |
|-----------|--------------------------------------|
| Account   | Account name (e.g. `FNB Bank *9986`) |
| Pay Month | Month key (e.g. `2026-06`)           |
| Date      | Transaction date                     |
| Description | Transaction description          |
| Amount    | Numeric amount (negative = expense)  |
| Category  | Grouping category                    |

## Features

- Multi-account filtering with toggle chips
- Adjustable month range (3–12 months)
- Collapsible Income / Expense / Transfers groups
- Subcategory drill-down to individual transactions
- Expected value column based on recurring items missing in the current month
- ZAR currency formatting
