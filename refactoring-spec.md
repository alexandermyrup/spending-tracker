# Spending Tracker Refactoring Spec

## Context

Single-file HTML app (~1,700 lines). No build step, no module system. All code lives in `spending-tracker.html`. Tests live in `spending-tracker-tests.html` (42 existing tests, copy-paste pattern for functions under test). This spec covers one bug fix and three structural refactors that prepare the codebase for P1 roadmap features (certainty levels, low-certainty review mode, conflicting categorization detection).

## Constraints

- Must remain a single HTML file (no bundler, no imports).
- All extracted functions must be pure where possible (take inputs, return data, no DOM access).
- DOM rendering functions call the pure functions, then build HTML.
- Tests copy-paste the pure functions into the test file (same pattern as today).
- Do not change any user-facing behaviour. All changes are internal refactors.
- Preserve all existing variable names and data structures (store, merchantMap, etc.).

---

## 1. Bug fix: `forecastLoan` uses `monthlyLoanBudget` before definition

**File:** `spending-tracker.html`, inside `renderYearlyDashboard()`

**Problem:** On line 1325, `forecastLoan` is computed using `monthlyLoanBudget`, which is declared on line 1329. Because `let` is hoisted but not initialized, `monthlyLoanBudget` is `undefined` at line 1325, so `forecastLoan` evaluates to `NaN`. This causes the forecast card to display `NaN` for projected loan inflow when a loan budget is set.

**Fix:** Move the `monthlyLoanBudget` and `ytdLoanBudget` declarations (lines 1329-1330) to immediately before line 1325 (the `forecastLoan` calculation). The two lines to move:

```javascript
// MOVE THESE TWO LINES...
const monthlyLoanBudget = annualLoanBudget / 12;
const ytdLoanBudget = monthlyLoanBudget * ytdMonths.length;

// ...TO IMMEDIATELY BEFORE THIS LINE:
const forecastLoan = ytdLoan + (futureMonths.length * monthlyLoanBudget);
```

**Verification:** After the fix, set a non-zero loan budget in the yearly dashboard and confirm the forecast card shows a numeric value (not `NaN`) for "Projected loan inflow".

---

## 2. Extract `CHART_COLORS` constant

**Purpose:** Remove duplication and prepare for the P3 colour scheme overhaul.

The 12-colour array `['#2563eb','#7c3aed','#db2777',...]` is duplicated on lines 1207 and 1401. Extract to a single `const` near the top of the `<script>` block, after `MONTH_KEYS`.

```javascript
const CHART_COLORS = ['#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#4f46e5','#c026d3','#d97706','#059669','#6366f1','#e11d48'];
```

Replace both inline arrays with `CHART_COLORS`.

---

## 3. Extract `getFilteredTransactions(filters)` from `renderTransactions()`

**Purpose:** Separate the filtering/sorting logic from DOM rendering. This pure function will be reusable by the future low-certainty review mode and conflicting categorization detection features.

**Current state:** Lines 785-824 of `renderTransactions()` read filter values from DOM, filter `store.transactions`, compute summary stats, detect duplicates, sort, and then build HTML all in one function.

**Target signature:**

```javascript
/**
 * Filters and sorts transactions based on provided criteria.
 * Pure function: no DOM access.
 *
 * @param {Object} filters
 * @param {string} filters.month - "all" or "YYYY-MM"
 * @param {string} filters.category - "all" or category name
 * @param {string} filters.type - "all", "spending", "saving", "income", "ignore"
 * @param {boolean} filters.uncategorizedOnly - true to show only uncategorized
 * @param {string} filters.search - search string (matched against merchant + description)
 * @param {Array} transactions - full transaction array
 * @returns {Object} {
 *   filtered: Array,          // filtered transactions (excludes split parents)
 *   totalSpending: number,    // absolute value of spending total
 *   totalIncome: number,      // income total
 *   duplicateFingerprints: Object  // { fingerprint: count } for count > 1
 * }
 */
function getFilteredTransactions(filters, transactions) { ... }
```

**Sorting rules to preserve:**
- Uncategorized mode: suggestions first (has autoMatchMerchant result), then uncategorized without suggestions, then categorized. Within each group, sort by date descending, then id descending.
- Normal mode: date descending, id descending.
- Always exclude split parent transactions (those with `splitInto`) from the returned `filtered` array.

**Refactored `renderTransactions()`** should:
1. Read filter values from DOM elements (as today).
2. Call `getFilteredTransactions(filters, store.transactions)`.
3. Use the returned data to build HTML.

---

## 4. Extract `getYearlyDashboardData(year, options)` from `renderYearlyDashboard()`

**Purpose:** `renderYearlyDashboard()` is 170 lines of interleaved data aggregation and HTML rendering. Extracting the data layer makes it testable and reusable for year-over-year comparison (P3).

**Target signature:**

```javascript
/**
 * Computes all yearly dashboard metrics.
 * Pure function: no DOM access.
 *
 * @param {string} year - "2026"
 * @param {Object} options
 * @param {boolean} options.excludeCovered - exclude covered transactions
 * @param {Array} options.transactions - full transaction array
 * @param {Object} options.budgets - store.budgets
 * @param {Object} options.categories - store.categories
 * @param {Object} options.loanBudget - store.loanBudget
 * @returns {Object} {
 *   monthData: Array<{mk, ym, month, spend, save, inc, loan, budget, hasActuals, isPast}>,
 *   ytd: {spend, save, income, loan, remaining, budget, monthCount},
 *   annual: {budget, avgSpend, avgIncome},
 *   forecast: {spend, income, save, loan, remaining, futureMonthCount},
 *   catTotals: Object,     // { categoryName: totalAmount }
 *   catBudgets: Object     // { categoryName: annualBudget }
 * }
 */
function getYearlyDashboardData(year, options) { ... }
```

**Key rules to preserve:**
- `monthData.isPast` is true if `i <= currentMonthIdx` or the year is before the current year.
- `monthData.hasActuals` is true if there are any transactions for that month.
- `ytdMonths` = months with `hasActuals === true`.
- Future months for forecast = months where `hasActuals === false && isPast === false`.
- Forecast logic: future spending uses budget, future income uses trailing average, future savings uses trailing average, future loan uses `monthlyLoanBudget`.
- **Important:** `monthlyLoanBudget` must be computed before `forecastLoan` (see bug fix in section 1).

**Refactored `renderYearlyDashboard()`** should:
1. Read year and excludeCovered from DOM.
2. Call `getYearlyDashboardData(year, { excludeCovered, transactions: store.transactions, budgets: store.budgets, categories: store.categories, loanBudget: store.loanBudget })`.
3. Use returned data to build HTML.

---

## Implementation order

1. **Bug fix** (section 1) — no risk.
2. **Extract `CHART_COLORS`** (section 2) — trivial.
3. **Extract `getFilteredTransactions()`** (section 3).
4. **Extract `getYearlyDashboardData()`** (section 4) — largest change.

**After each step:**

- Commit with a descriptive message (e.g. `fix: compute monthlyLoanBudget before forecastLoan`, `refactor: extract CHART_COLORS constant`, etc.).
- Run all 42 existing tests + manual browser check (open `spending-tracker.html`, click through each tab: Dashboard monthly, Dashboard yearly, Transactions, Budgets, Categories).
- If anything breaks, revert to the last commit and investigate.

---

## Testing requirements

New tests should be added to `spending-tracker-tests.html` following the existing pattern:
- Copy the extracted pure functions into the test file's `<script>` block.
- Add new test suites for each extracted function.
- See `refactoring-tests-spec.md` for the exact test cases (19 new tests across 4 suites: forecastLoan bug fix, CHART_COLORS, getFilteredTransactions, getYearlyDashboardData).
