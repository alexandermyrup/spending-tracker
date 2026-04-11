# Spending Tracker Overview Redesign Handover

## Summary

This document scopes the first phases of the next product evolution for Spending Tracker.

Primary product goal:

- make the default experience answer: `How did I do last month?`

Product direction:

- simple scorecard first
- drill-down second
- budgeting remains the immediate focus
- savings and investing are shown as progress, not treated as ordinary spending
- fixed costs and discretionary spending are separated in the view
- loans stay separate from true income
- covered/reimbursed items are hidden by default in the overview

Delivery principle:

- use TDD by default
- build pure data/view-model functions first
- render UI on top of tested data functions

This is intentionally scoped before larger platform work like Nordea API sync, loans system, investments/net worth, and advisory personas.

---

## Phase 1: Monthly Scorecard Overview

### Goal

Make the default landing view answer:

- `How did I do last month?`

### User-facing outcome

- Default view is `Last Completed Month`
- Clear verdict at the top:
  - `Under budget and saved X`
  - or an equivalent negative variant if over budget
- Headline metrics:
  - income received
  - total spent vs budget
  - cash saved
  - invested
  - remaining cash
  - categories over budget
- Spending split is visible as:
  - fixed costs
  - discretionary
- Savings are excluded from budget-success calculation
- Loans are shown separately from true income
- Covered/reimbursed items are hidden by default
- Month / Year toggle remains available, but monthly is the default entrypoint

### TDD scope

Write tests first for pure functions:

- `getLastCompletedMonth()`
- `getMonthlyScorecardData()`
- budget success calculation
- fixed vs discretionary grouping
- savings vs investing separation
- loan exclusion from true income
- covered-item exclusion

### Acceptance criteria

- A month with variable income still computes correctly
- An under-budget month shows a positive verdict
- An over-budget month shows a negative verdict
- A month with investments but low cash savings shows both separately
- Covered transactions do not distort headline metrics
- Savings do not count against budget success

### Implementation notes

- No business logic should live only in rendering code
- The overview should be card-based, with each card doing one job
- The top card should function as a scorecard, not a generic dashboard summary

---

## Phase 2: Budget Diagnosis Layer

### Goal

Explain why last month was good or bad.

### User-facing outcome

- Drill-down from the overview into category diagnosis
- Overspent categories ranked by impact
- Primary comparison:
  - category budget
- Secondary comparison:
  - last month
- Tertiary comparison:
  - 3-month average
- The app suggests whether overspend looks like:
  - one-off
  - recurring habit
  - likely budget issue
- App suggestions can be overridden by the user

### TDD scope

Write tests first for pure functions:

- `getCategoryBudgetStatus()`
- `getOverspentCategories()`
- `getCategoryComparisons()`
- `classifyOverspendPattern()`

Cover these cases:

- category over budget but below 3-month average
- one large single transaction
- repeated small recurring overspends
- no meaningful prior history

### Acceptance criteria

- Overspent categories sort by importance
- Budget comparison is the primary comparison in UI and logic
- One-off events are not mislabeled as recurring habits
- Categories with chronic misses are flagged consistently
- A user can override the app’s suggested classification

### Implementation notes

- Diagnosis should be downstream of the scorecard, not mixed into it
- The first view should stay calm and summary-driven
- The diagnosis layer should help decide whether spending changed or budgeting should change

---

## Phase 3: Savings / Investing Progress

### Goal

Make savings feel like progress, not expense.

### User-facing outcome

- Dedicated savings / investing card or section
- Separate values for:
  - cash saved
  - invested
- Show both monthly and YTD values
- Connect the savings result back to the monthly verdict
- Allow drill-down into which transactions counted as savings vs investments

### TDD scope

Write tests first for pure functions:

- `getSavingsProgressData()`
- `getYtdSavingsProgress()`
- classification of saving vs investing transactions
- separation from spending totals

Cover these cases:

- no savings in a month
- investments only
- mixed savings + investments
- months with loan inflows present

### Acceptance criteria

- Savings never count against budget success
- Invested amount remains visible in monthly result
- YTD numbers aggregate correctly across months
- Savings and investing can be understood without opening the transactions table

### Implementation notes

- Use the same mental model everywhere:
  - spending is cost
  - savings is retained cash
  - investing is committed capital

---

## Phase 4: Recurring / Fixed Obligations View

### Goal

Make recurring commitments visible and useful.

### User-facing outcome

- Recurring / fixed obligations card or page
- Upcoming next 2 to 4 weeks
- Group items by:
  - fixed costs
  - subscriptions
  - later: loan payments
- Show:
  - expected date
  - typical amount
  - category
  - trend / history
- Recurring suggestions are app-detected, but user-overridable

### TDD scope

Write tests first for pure functions:

- `detectRecurringObligations()`
- cadence detection
- expected next occurrence
- fixed vs non-fixed grouping
- override behavior

Cover these cases:

- monthly with slight amount variation
- skipped month
- annual payment
- irregular payment that should not be flagged as recurring

### Acceptance criteria

- Recurring items are not over-detected
- Upcoming list is stable and useful
- User override wins over app suggestion
- Fixed obligations become easier to reason about separately from discretionary spending

### Implementation notes

- This phase supports later loan tracking and future all-in-one finance tracking
- Recurring detection should improve diagnosis, not just add another list

---

## TDD Delivery Rules

- Build pure data functions first, UI second
- Every new dashboard card must consume a tested view-model/data function
- No important business logic should exist only in DOM rendering code
- Add regression tests for every bug found during implementation
- Use realistic fixtures:
  - variable income
  - covered items
  - split transactions
  - savings
  - investments
  - loans
- Prefer assertions on derived data objects instead of HTML when possible
- UI verification comes after data-layer tests are green

---

## Recommended Build Order

1. Monthly scorecard overview
2. Budget diagnosis layer
3. Savings / investing progress
4. Recurring / fixed obligations view

Reasoning:

- the current problem is overview clarity
- scorecard comes first
- diagnosis comes second
- savings/investing clarity comes next
- recurring/fixed obligations support stronger planning after the basics are legible

---

## Explicitly Out Of Scope For These Phases

Do not include in the first phases:

- Nordea Open Banking API sync
- full loans / debt tracking system
- investments / net worth platform
- goals framework
- advisory persona features such as a `Dave Ramsey GPT`

These belong in later roadmap phases after the overview and budgeting core are strong.
