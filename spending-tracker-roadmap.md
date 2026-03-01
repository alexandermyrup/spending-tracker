# Spending Tracker Roadmap

## Shipped
- Nordea CSV import with duplicate detection and "dup?" flagging
- Manual categorization with merchant auto-learn (merchantMap)
- Merchant auto-map: 116 hard-coded patterns from historical data
- MobilePay/NordeaPay smart merchant resolution
- Suggestion badges with one-click accept for uncategorized transactions
- Smart sort: suggestions-first in uncategorized mode, date-sort otherwise
- Category quick-create with group picker (sign-aware)
- Context-aware dropdowns (income vs spending categories by transaction sign)
- Sanitizer respects manual categorizations (manualCategory flag)
- Excel-style per-month budget grid with right-click fill-right
- Dashboard: actual cash flow (income - spending - savings = remaining)
- "Covered" toggle for parent-paid / reimbursed expenses
- JSON export/import for backup
- Category manager (create, rename, delete, remove from transaction)
- Split transaction feature (for SU grant/loan split)
- Loan inflow type (excluded from true income in dashboard)
- Delete transactions: single delete + clear all
- Known institution exclusion from person-name heuristic
- Refactoring: extract `getFilteredTransactions()` and `getYearlyDashboardData()` pure functions, extract `CHART_COLORS` constant, fix forecastLoan NaN bug
- Test suite expanded to 61 tests (19 new tests covering extracted functions)
- Normalize merchantMap keys: use `normalizeMerchantName()` for all merchantMap storage/lookup so formatting differences (spaces, punctuation) don't break matching
- Clean 2025 CSV merchant names in `resolveMerchant()`: strip `Den DD.MM` date suffixes, foreign currency prefixes, `Nordea pay`/`Bs betaling`/`Pay modpost.` prefixes, handle MobilePay-in-desc format. Test suite at 119 tests.

## Backlog

### P1: High impact, do next
- **Debug SU loan feature**: Investigate and fix issues with the SU loan tracking/split functionality. Needs scoping — reproduce the bug, identify root cause, then fix. Scope: ~1 session.
- **Categorization certainty levels**: Confidence scoring for auto-categorization suggestions. Signals: (1) number of past categorizations for this merchant, (2) amount deviation from historical mean/range, (3) exact vs fuzzy match. High certainty (e.g., Louis Nielsen ~360 DKK = Contacts) shown as solid green badge. Low certainty (e.g., Louis Nielsen 200 DKK) shown as dashed orange badge. No auto-accept on import (all transactions require manual review). Scope: ~2 sessions. Depends on: enough transaction history to be useful.
- **Low-certainty review mode**: Filtered view in transactions tab showing only categorized transactions where certainty is below a threshold. Lets you periodically audit auto-learned mappings and catch miscategorizations early. Could surface: amount outliers for a given merchant, categories that were only used once, merchants where the user has categorized differently over time. Scope: ~1 session. Depends on: certainty levels being implemented first.
- **Conflicting categorization detection**: Flag transactions where near-identical payments (similar merchant name, similar amount, same description pattern) have been categorized differently. E.g., "MICROSOFT*MICROSOFT 365 P" categorized as M365 but "MICROSOFT*MICROSOFT 365 PE" uncategorized or under a different name. Could use fuzzy string matching (Levenshtein distance or token overlap) to group likely-same merchants and surface inconsistencies. Scope: ~1 session. Synergy with certainty levels and low-certainty review.
- **Recurring transaction detection**: Identify subscriptions and fixed costs by pattern (same merchant, similar amount, monthly cadence). Flag them in transaction view, auto-categorize with near-100% confidence. Scope: ~1 session. Synergy with certainty levels.
- **Pre-load historical data**: Import Nov 25 / Dec 25 / Jan 26 transactions from existing Excel. One-time conversion. Gives the certainty engine training data and makes the dashboard useful historically. Scope: ~1 session.

### P2: Important, after P1 lands
- **Review budget gap**: Audit the gap between budgeted and actual spending across categories. Identify where budgets are consistently over/under reality and adjust. Scope: ~1 session.
- **Income budget from Excel**: Import 2026 income projections from Budget26 Excel sheet into the spending tracker's budget system. Populate monthly income expectations so the yearly dashboard and forecast use real projections instead of trailing averages. Scope: ~30 min. File ready in uploads.
- **Salary month-shift rule**: Configurable setting to auto-assign income received after day X (default: 25) to the following month's budget. Solves the "paid on the 28th but it's next month's money" problem. Approach: add threshold day setting in dashboard, apply shift during budget aggregation (not on the raw transaction date). Scope: ~1 session.
- **Budget review**: Cross-check default budget amounts against actual Budget26 Excel sheet. Quick win, but only meaningful once enough actuals exist to compare. Scope: ~30 min.
- ~~**Yearly dashboard overview**~~: SHIPPED. Monthly/Yearly toggle, YTD cash flow, monthly bars with budget lines, annual category breakdown, year-end forecast.
- **SU tracker**: Track SU-lan balance, repayment schedule, total liability over time. Useful but isolated from core categorization workflow. Scope: ~1 session.

### P3: Nice to have, park for now
- **Colour scheme overhaul**: Review and adopt a proper data visualization palette. Reference: https://www.datanovia.com/en/blog/top-r-color-palettes-to-know-for-great-data-visualization/. Currently using a hardcoded 12-colour array for charts. Replace with a perceptually uniform, colourblind-friendly palette (e.g., Viridis, ColorBrewer Set2/Set3). Also review the CSS variables for income/expense/savings colours. Scope: small, ~30 min.
- **Sankey diagram**: Annual flow visualization (income -> spending categories -> savings). Cool but doesn't change decisions. Build with 6+ months of data. Scope: ~1 session (d3-sankey).
- **Year-over-year comparison**: Compare spending patterns across years. Earliest useful: mid-2026. Scope: ~1 session.
- **CSV export**: Export categorized transactions back to CSV. Low urgency given JSON export exists. Scope: small.
- **Multi-account support**: Only if/when a second bank account or credit card is added. Don't build until the need is real. Scope: medium.
- **Local LLM auto-categorization**: Revisit only if certainty levels + recurring detection still leave too much manual work. Likely overkill once simpler signals are in place.
- **Investing overview**: Portfolio view showing investment contributions over time, allocation breakdown, and performance tracking. Could integrate with pension + investment savings categories to show total wealth picture alongside spending. Scope: medium-large, depends on data sources available.
