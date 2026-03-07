# Spending Tracker

A static personal spending tracker built with HTML, CSS, and vanilla JavaScript. Designed for tracking transactions from Nordea bank CSV exports with manual categorization and budgeting.

## Production URL

When GitHub Pages is enabled for this repository, the app should be available at:

`https://alexandermyrup.github.io/spending-tracker/`

Open that URL for normal day-to-day use.

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

- Production: open the GitHub Pages URL above
- Local dev: open `spending-tracker.html` through a static server

All data is stored in browser `localStorage`.

Important:
- `localStorage` is origin-specific
- `file://`, `http://localhost:8000`, and `https://alexandermyrup.github.io` each have separate storage
- if you switch origins, your data will not appear automatically

## Tests

Open `spending-tracker-tests.html` in a browser to run the test suite.
This is a test harness, not the main app entrypoint.

## GitHub Pages

Recommended repository settings:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

Once enabled, every push to `main` republishes the site automatically.

The repository includes:

- `index.html` as the GitHub Pages root entrypoint
- `.nojekyll` so Pages serves the static files as committed

## Migrating Existing Data

If your transactions currently live in `file://` or `localhost`:

1. Open the old app at the origin where your data currently appears
2. Export JSON
3. Open the GitHub Pages URL
4. Import JSON once

After that, keep using the GitHub Pages URL in the same browser/profile.
