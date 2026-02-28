# Spending Tracker

A single-file personal spending tracker built with HTML, CSS, and vanilla JavaScript. Designed for tracking transactions from Nordea bank CSV exports with manual categorization and budgeting.

## Features

- **Nordea CSV import** with duplicate detection
- **Manual categorization** with merchant auto-learn
- **116 built-in merchant patterns** for automatic categorization
- **MobilePay / NordeaPay** smart merchant resolution
- **Budget grid** — Excel-style per-month budgeting with fill-right
- **Dashboard** — actual cash flow: income − spending − savings = remaining
- **Split transactions** (e.g., SU grant/loan split)
- **"Covered" toggle** for parent-paid or reimbursed expenses
- **JSON export/import** for backup
- **Category manager** — create, rename, delete categories

## Usage

Open `spending-tracker.html` in a browser. All data is stored in `localStorage` — no server needed.

## Tests

Open `spending-tracker-tests.html` in a browser to run the test suite.
