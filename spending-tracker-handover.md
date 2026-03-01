# Spending Tracker — Project Handover Document

**March 2026** | Single-file HTML personal finance app
Nordea CSV import | Manual categorisation | Smart categorisation | Budget tracking | Dashboards
Owner: Alex | Implement Consulting Group

---

## 1. Project Overview

The Spending Tracker is a standalone, single-file HTML application for personal finance management. It imports bank transactions from Nordea CSV exports, allows manual categorisation with auto-learn merchant mapping, provides smart categorisation with confidence scoring and recurring detection, tracks budgets on a per-month and per-year basis, and provides monthly and yearly dashboards with cash flow analysis and year-end forecasting.

The app runs entirely in the browser with no server dependencies. All data persists in `localStorage` under the key `spending-tracker-v2`. A JSON export/import feature provides backup and portability.

### Key design decisions

- **Single-file architecture**: HTML + CSS + JS in one file (~2,050 lines). No build step, no framework. Opens directly in any browser.
- **No auto-categorisation on import** (with one exception): All imported transactions start uncategorised. The app suggests categories via badges, but the user must explicitly accept or assign. Exception: recurring merchants with 3+ consistent categorisations are auto-categorised on import.
- **Manual-first categorisation**: Once a user categorises a transaction, the merchant-to-category mapping is learned (`merchantMap` in localStorage). Future transactions from the same merchant get suggestion badges.
- **Confidence-scored suggestions**: Each suggestion badge shows certainty (high/medium/low) based on category history depth, amount consistency, match source, and recurring status.
- **Sign-aware logic**: Income and spending categories are strictly separated. Positive amounts can only receive income-group categories; negative amounts only spending/savings. The sanitiser enforces this on load, but respects the `manualCategory` flag for explicit user overrides.
- **Danish locale**: Currency formatted as DKK with `da-DK` number formatting. Nordea CSV uses semicolons and Danish decimal notation.

---

## 2. File Inventory

| File | Purpose | Size |
|------|---------|------|
| `spending-tracker.html` | Main application (HTML + CSS + JS) | ~2,050 lines |
| `spending-tracker-tests.html` | Automated test suite (119 tests, 21 suites) | ~96 KB |
| `spending-tracker-roadmap.md` | Prioritised feature backlog (P1/P2/P3) | ~3 KB |
| `spending-tracker-handover.md` | This document | — |
| `CLAUDE.md` | Code map for AI-assisted development | ~3 KB |
| `spending-tracker-handover.docx` | **Stale** — original Feb 2026 handover | Legacy |

---

## 3. Data Model

All application state lives in a single `store` object persisted to `localStorage`.

### 3.1 `store.transactions[]`

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Auto-incrementing unique ID (`store.nextId`) |
| `date` | string | ISO date (YYYY-MM-DD). Pending transactions get today. |
| `amount` | number | Signed. Negative = outflow, positive = inflow. |
| `merchant` | string | Resolved merchant name (cleaned by `resolveMerchant()`). |
| `description` | string | Raw description from CSV. |
| `balance` | string | Account balance after transaction (from CSV). |
| `pending` | boolean | True if date was `Reserveret` in Nordea CSV. |
| `category` | string | User-assigned, auto-assigned (recurring only), or empty. |
| `type` | string | One of: `spending`, `saving`, `income`, `loan`, `ignore`. |
| `covered` | boolean | True if parent-paid / reimbursed (excluded from dashboard). |
| `manualCategory` | boolean | True if user explicitly set this category. Sanitiser skips these. |
| `splitInto` | number[] | IDs of child transactions (parent only). Parent becomes `type=ignore`. |
| `splitFrom` | number | ID of parent transaction (child only). |

### 3.2 `store.categories`

Object keyed by group name, each containing an array of category strings. Default groups: Fixed costs, Subscriptions, Insurance, Variable, Savings, Income.

**Invariant:** The Income group contains categories for positive-amount transactions only. All other groups are for negative amounts. `getIncomeCategories()` dynamically merges defaults and user-created categories.

### 3.3 `store.budgets`

Nested object: `budgets[year][category][monthKey] = number`. Month keys are zero-padded strings (`01`–`12`). Default budgets seeded from `getDefaultYearBudget()`.

### 3.4 `store.merchantMap`

Object keyed by **normalised merchant name** (via `normalizeMerchantName()`: strips `*-_.,;:/\|`, collapses whitespace, trims, uppercases). Value is `{ category, type }`.

**Important:** Keys are NOT plain `.toUpperCase()` — they go through `normalizeMerchantName()`. This was changed in March 2026 to handle formatting differences between 2025 and 2026 CSV data. A migration in `loadStore()` re-keys existing entries on load.

### 3.5 `store.loanBudget`

Object keyed by year string, value is the expected annual loan amount (e.g. SU-lån). Used by the yearly dashboard for loan tracking and forecast projections.

### 3.6 `store.salaryShiftDay`

Number (default: 0). When > 0, income received after this day of the month is shifted to the following month for budget purposes. E.g., `salaryShiftDay = 25` means salary received on the 28th counts as next month's income.

---

## 4. Architecture and Key Functions

The app follows a render-loop pattern: user actions mutate the store, call `saveStore()`, then re-render affected views.

### 4.1 Import pipeline

1. **`parseNordeaCSV(text)`**: Splits semicolon-delimited rows, parses amounts (Danish format: dots as thousands, comma as decimal), resolves merchant names via `resolveMerchant()`.
2. **`resolveMerchant(name, desc)`**: Cleans merchant names from both 2025 and 2026 CSV formats:
   - **MobilePay**: Strips "MobilePay" prefix from name (2026) or desc (2025).
   - **Overførsel MobilePay**: Extracts person name from transfer descriptions.
   - **Nordea Pay**: Handles both "NordeaPay" (2026) and "Nordea pay køb, ." (2025) formats; extracts actual merchant name; strips `Den DD.MM` date suffix.
   - **Pay modpost.**: Cleans refund/reversal entries.
   - **Card transactions**: Strips `Den DD.MM` date suffix (2025 format).
   - **Foreign currency**: Strips `CCC amount` prefix (e.g. `SEK 1240,00  TICKSTER.COM` → `TICKSTER.COM`).
   - **Bs betaling**: Strips direct debit prefix.
3. **Deduplication**: `txFingerprint()` creates a composite key of `date|amount|merchant|description`.
4. **`confirmImport()`**: Adds transactions. Auto-categorises recurring merchants with 3+ consistent categorisations. All others start with `category=''`.

### 4.2 Categorisation engine

**`autoMatchMerchant(merchantName, amount)`**: Three-tier matching:
1. `merchantMap` lookup using `normalizeMerchantName()` key, with sign validation.
2. Special-case rules (Macbook payment at exact 910 DKK, salary via Lønoverførsel, person-name heuristic for MobilePay).
3. `MERCHANT_PATTERNS` array (118 hardcoded patterns).

**`selectCategory(txId, category)`**: Sets `tx.category`, `tx.manualCategory=true`, and updates `merchantMap` (using normalised key). Clearing a category removes the `merchantMap` entry.

**`sanitizeTransactions()`**: Runs on every load. Strips categories where sign mismatches group. Skips transactions with `manualCategory=true`.

### 4.3 Smart categorisation suite

Five-phase system layered on top of the base categorisation engine:

| Phase | Function | Purpose |
|-------|----------|---------|
| 1 | `computeMerchantStats(transactions)` | Per-merchant stats: count, categories, mean/stddev amounts, primary category |
| 2 | `detectRecurringMerchants(merchantStats)` | Monthly subscriptions: 3+ txs, 25–38 day median gap, <15% CV |
| 3 | `computeCategoryCertainty(tx, suggestion, stats, recurring)` | Score 0–1 combining history depth (0.35), amount consistency (0.25), match source (0.25), recurring (0.15) |
| 4 | `detectConflicts(merchantStats)` | Merchants with 2+ different categories (grouped by normalised name) |
| 5 | Low-certainty review (UI filter) | Checkbox to show only categorised transactions with certainty < 0.4 |

**Caching**: `getMerchantStats()` and `getRecurringMerchants()` are cached and invalidated via `invalidateMerchantCaches()` (called on category changes).

**Certainty bands**: `high` (≥ 0.8), `medium` (≥ 0.4), `low` (< 0.4). Displayed as badge styling and percentage tooltip.

### 4.4 Category lifecycle

Category rename and delete propagate across five data stores:
1. `store.categories[group]` (the definition)
2. `store.transactions[].category` (all tagged transactions)
3. `store.budgets[year][category]` (budget entries)
4. `store.merchantMap` (learned mappings)
5. `MERCHANT_PATTERNS` (in-memory hardcoded rules; resets on page refresh)

### 4.5 Split transactions

A parent transaction can be split into 2+ child transactions (e.g. SU payment split into grant + loan). The parent gets `splitInto=[childId1, childId2]` and `type='ignore'`. Children get `splitFrom=parentId`. Deletion logic handles three cases: (a) deleting the parent also deletes all children, (b) deleting one of many children removes it from the parent's `splitInto` array, (c) deleting down to one child absorbs that child back into the parent.

### 4.6 Dashboard rendering

- **Monthly** (`renderDashboard()`): Cash flow (income, loan, spending, savings, budget, variance, remaining). Charts: category bars with budget lines, top merchants, monthly trend, budget vs actual grid.
- **Yearly** (`renderYearlyDashboard()`): 12-month aggregation. YTD uses months with data. Forecast: past months use actuals, future months use budget for spending and trailing averages for income/savings. Loan budget via `store.loanBudget`.

### 4.7 Salary month-shift rule

Configurable via `store.salaryShiftDay`. Income (and savings) received after the shift day are assigned to the following month for dashboard/budget purposes. Spending and loans are not shifted. Applied in both monthly filtering and yearly aggregation.

### 4.8 Person-name heuristic

Regex `/^[A-ZÆØÅ][a-zæøå]+ [A-ZÆØÅ]/` detects MobilePay person-to-person transfers. Known institutions (Udbetaling Danmark, Sygesikring Danmark, Topdanmark) are excluded. Positive amounts → `Reimbursement`, negatives → `Transfer out`.

### 4.9 Merchant name normalisation

`normalizeMerchantName(name)` strips `*-_.,;:/\|`, collapses whitespace, trims, and uppercases. Used as the key for all `merchantMap` operations. This ensures `COOP*365` and `COOP.365` resolve to the same key (`COOP365`), and `FOETEX  STORE` matches `FOETEX STORE`.

A migration in `loadStore()` re-keys all existing `merchantMap` entries through this function on every load. The migration is idempotent.

---

## 5. Known Issues and Technical Debt

| Issue | Severity | Detail |
|-------|----------|--------|
| `MERCHANT_PATTERNS` is in-memory only | Low | Rename/delete updates patterns at runtime, but they reset on page refresh. `merchantMap` takes priority, so practical impact is minimal. |
| No data migration versioning | Low | `localStorage` schema changes handled ad-hoc in `loadStore()`. No formal migration system. |
| Budget editor has no undo | Low | Right-click fill-right is destructive. No confirmation. |
| Old 2025 `tx.merchant` values not retroactively cleaned | Low | Transactions imported before the `resolveMerchant()` cleanup still have messy merchant names (e.g. with `Den DD.MM` suffixes). Matching works via normalisation, but display is messy. A one-time data migration could fix this. |
| `merchantKey()` is dead code | Trivial | Defined but never called. Can be removed. |
| SU loan feature may have bugs | Medium | Flagged for investigation (P1 roadmap). Needs scoping. |
| Roadmap P1 items are stale | Low | Several P1 backlog items (certainty levels, recurring detection, conflict detection, low-certainty review) are actually already shipped in code but not moved to "Shipped" in the roadmap file. |

---

## 6. Shipped Features

- Nordea CSV import with duplicate detection and `dup?` flagging
- Manual categorisation with merchant auto-learn (`merchantMap`)
- 118 hardcoded merchant patterns from historical data
- MobilePay/NordeaPay/Vipps smart merchant name resolution
- 2025 CSV format support: strips date suffixes, currency prefixes, payment platform prefixes
- Normalised merchantMap keys (resilient to formatting differences)
- Suggestion badges with certainty scoring (high/medium/low) and one-click accept
- Smart sort: suggestions-first in uncategorised mode, sorted by certainty
- Recurring transaction detection with auto-categorise on import
- Conflict detection banner (merchants with 2+ categories)
- Low-certainty review mode (filtered view for auditing)
- Category quick-create with sign-aware group picker
- Context-aware dropdowns (income vs spending categories by transaction sign)
- Sanitiser respects manual categorisations (`manualCategory` flag)
- Excel-style per-month budget grid with right-click fill-right
- Monthly dashboard: actual cash flow (income − spending − savings = remaining)
- Yearly dashboard: YTD overview, monthly bars, category breakdown, year-end forecast
- Salary month-shift rule (income after day X counts as next month)
- "Covered" toggle for parent-paid / reimbursed expenses
- JSON export/import for backup
- Category manager: create, rename, delete (propagates to all stores)
- Split transaction feature (for SU grant/loan split)
- Loan inflow type (excluded from true income in dashboard)
- Annual loan budget input with forecast integration
- Delete transactions: single delete + clear all
- Known institution exclusion from person-name heuristic

---

## 7. Roadmap (see `spending-tracker-roadmap.md` for full detail)

### P1: High impact, do next
- Debug SU loan feature
- Pre-load historical data (Nov 25 / Dec 25 / Jan 26 from Excel)

### P2: Important
- Review budget gap
- Income budget from Excel
- Budget review (cross-check vs Excel)
- SU tracker (balance, repayment schedule)

### P3: Nice to have
- Colour scheme overhaul, Sankey diagram, year-over-year comparison, CSV export, multi-account, LLM categorisation, investing overview

---

## 8. How to Continue Development

### 8.1 Local development
Open `spending-tracker.html` directly in Chrome. No build step. Data persists in `localStorage`. For clean state, use incognito or clear `localStorage` for the `spending-tracker-v2` key.

### 8.2 Adding a new feature
1. Check if the feature touches the data model. If so, add a migration in `loadStore()`.
2. Implement the logic. Pattern: mutate `store` → `saveStore()` → re-render.
3. If adding a new category group or type, update `getIncomeCategories()`, `sanitizeTransactions()`, and the type dropdown.
4. If the feature affects merchantMap, use `normalizeMerchantName()` for keys and call `invalidateMerchantCaches()` after changes.
5. Add tests in `spending-tracker-tests.html`. Copy pure functions into the test file (copy-paste pattern).

### 8.3 Testing
119 tests across 21 suites. Tests run in-browser with a visual runner (`TestRunner` class). They use an in-memory mock `localStorage` and do not touch production data. Suites cover: import/dedup, categorisation, sanitiser, category management, split transactions, dashboard calculations, type changes, person-name heuristic, filters, getFilteredTransactions, getYearlyDashboardData, salary month-shift, CHART_COLORS, merchant stats, recurring detection, certainty levels, conflict detection, low-certainty review, normalised merchantMap keys, resolveMerchant cleanup.

### 8.4 Backup and recovery
Use the **Export JSON** button in the app header to download a full snapshot. **Import JSON** restores the snapshot. The JSON contains transactions, categories, budgets, merchantMap, loanBudget, salaryShiftDay, and nextId.

### 8.5 GitHub
Repository: `alexandermyrup/spending-tracker` on GitHub. Branch: `main`. Push directly to main (single developer).

---

*End of handover document.*
