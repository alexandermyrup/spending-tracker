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
- Excel-style per-month budget grid with right-click fill-right, live total/avg updates
- Dashboard: actual cash flow (income - spending - savings = remaining)
- "Covered" toggle for parent-paid / reimbursed expenses
- JSON export/import for backup
- Category manager (create, rename, delete with deletedCategories tracking so defaults don't resurrect)
- Split transaction feature (for SU grant/loan split)
- Loan inflow type (excluded from true income in dashboard)
- Delete transactions: single delete + clear all
- Known institution exclusion from person-name heuristic
- Normalize merchantMap keys via `normalizeMerchantName()`
- Clean 2025 CSV merchant names in `resolveMerchant()`
- Categorization certainty levels (merchant history, amount deviation, match quality)
- Low-certainty review mode + conflict detection + recurring transaction detection
- Pre-loaded historical data (Nov 25 - Jan 26)
- Monthly scorecard overview + budget diagnosis with expandable category breakdown
- Category breakdown: sorted by most over budget, inline trend context (last month, 3-mo avg, 1-yr avg)
- Salary month-shift rule (configurable day threshold)
- Yearly dashboard overview with YTD, forecast, monthly bars
- Income budget integrated into budget grid
- Accessibility pass: contrast, keyboard nav, ARIA, touch targets, mobile table
- Test suite: 119 tests, 21 suites

## Backlog

### P1: Do next

- **Review week (weekly dashboard)**: Weekly spending view alongside the existing monthly/yearly toggle. Purpose: drive spending awareness by shortening the feedback loop from monthly to weekly. Shows variable costs only (fixed costs hidden -- rent/subscriptions aren't weekly decisions). Core content: total variable spend this week vs weekly budget target (monthly budget / 4.33), category breakdown with WoW delta and 4-week rolling average, daily run rate (actual vs target kr/day), and a "month pace" indicator (on track for the month given weeks remaining?). Week = Mon-Sun. Current week shown as partial until Sunday. Transactions attributed to the week they fall in regardless of month boundaries. No new data model needed -- purely a view layer on existing transactions. Scope: ~1 session for basic view + comparisons, second session for polish if needed.

- **Yearly view polish**: YoY dots should also appear on the monthly spend vs budget chart (currently only on the cash flow chart). Scope: ~15 min.

- **Nav & import restructure**: Remove "Import CSV" as a standalone nav page. Move import functionality into the Transactions page as a button/section. Fix sidebar and mobile nav icons (currently wrong/mismatched). Scope: ~1 session.

- **Feriepenge auto-budget**: Feriepenge budget should auto-calculate as 12.5% of part-time job income budget per month, not a manual flat number. Scope: ~15 min.

- **Asset & loan overview**: New tab/section that aggregates financial positions beyond monthly spending. Start with SU loan tracking (total borrowed to date, projected total at graduation, repayment terms from su.dk, outstanding balance). Extend to show investment contributions over time (pension + investment categories aggregated from transaction data), and a simple net worth view (assets minus liabilities). This replaces the old "SU tracker" and "Investing overview" items as one unified surface. Data model needs: a liabilities store (loan name, principal, rate, term) and an asset aggregation layer on top of existing savings/investment transaction types. Scope: ~2-3 sessions. First session: data model + SU loan card. Second session: investment aggregation. Third session: net worth view.

- **Fix recurring transactions**: Investigate and fix recurring transaction detection. May be related to the categorization/certainty system. Scope: TBD.

- **Tagging & certainty UX review**: The certainty system works well mechanically but the user-facing experience needs polish. Current issues to investigate: (1) badge colours and labels may not be intuitive to scan quickly, (2) the relationship between suggestion badges, certainty bands, and review modes isn't obvious to a first-time user, (3) "low certainty" and "conflicts" review modes are powerful but hidden behind a dropdown. Goal: make the categorization workflow feel obvious without reading documentation. Scope: ~1 session. Approach: use the app for a real import, note friction points, then redesign the affordances.

### P2: Important, after P1

- **Review budget gap**: Go through each category and compare budgeted amounts against 3+ months of actual spending. Identify categories that are consistently over (budget too low or spending habit to address) and categories that are consistently under (budget too high, wasting headroom). Output: adjusted budget defaults and a short list of spending habits worth changing. This is a manual review exercise, not a code feature, but could be supported by a budget health summary card. Scope: ~1 session.

- **SU tracker (standalone)**: If the asset & loan overview is too big to start, this is the minimal version. Track SU-lan balance as a running total: each "loan" type transaction increases the balance, show cumulative borrowed, projected total at graduation, and monthly/quarterly inflow rate. No repayment modelling, just visibility. Scope: ~1 session.

### P3: Nice to have, park for now

- **Colour scheme overhaul**: Replace the hardcoded 12-colour `CHART_COLORS` array with a perceptually uniform, colourblind-friendly palette (Viridis, ColorBrewer Set2/Set3). Also review the semantic colours for income/expense/savings across the app. Small scope (~30 min) but low urgency since charts are being replaced with list views.

- **Sankey diagram**: Annual flow visualization showing how true income flows into fixed costs, discretionary spending, savings, and investing. Useful for the "where does my money actually go" question at year-end. Build with d3-sankey once 6+ months of data exist. Scope: ~1 session. Could live inside the yearly view or the asset overview.

- **Year-over-year comparison**: Side-by-side or overlay view comparing spending patterns across calendar years. Earliest useful: mid-2026 when there's enough 2025 vs 2026 data. Scope: ~1 session.

- **CSV export**: Export categorized transactions back to CSV for use in Excel or sharing. Low urgency since JSON export covers backup needs. Scope: small.

- **Multi-account support**: Support for multiple bank accounts or credit cards feeding into the same budget. Only build when a second account is actually added. Would need: account tagging on import, per-account filtering, merged dashboard. Scope: medium.

- **Local LLM auto-categorization**: Use a local model to categorize transactions that the rule-based system can't handle. Only revisit if certainty levels + recurring detection still leave too much manual work after 6+ months of use. Likely overkill given current accuracy. Scope: medium-large.
