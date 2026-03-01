# Refactoring Test Spec

Tests for the pure functions extracted per `refactoring-spec.md` (4 sections: bug fix, CHART_COLORS constant, getFilteredTransactions, getYearlyDashboardData). Add these as new suites in `spending-tracker-tests.html`, following the existing pattern (copy functions into test file, use `TestRunner`, `assert`, `assertEquals`, `assertDeepEqual`). Total: 19 new tests across 4 suites.

---

## Suite: "forecastLoan Bug Fix"

Validates that the yearly dashboard data computation produces correct (non-NaN) forecast values when a loan budget is set.

### Test 1: forecastLoan is numeric when loan budget is set

```
Setup:
  - resetStore()
  - store.loanBudget = { "2026": 24000 }
  - Add 2 months of transactions (Jan + Feb 2026):
    - id:1, date:"2026-01-15", amount:5000, type:"income"
    - id:2, date:"2026-01-15", amount:2000, type:"loan"
    - id:3, date:"2026-01-15", amount:-3000, type:"spending"
    - id:4, date:"2026-02-15", amount:5000, type:"income"
    - id:5, date:"2026-02-15", amount:2000, type:"loan"
    - id:6, date:"2026-02-15", amount:-3500, type:"spending"

Call: getYearlyDashboardData("2026", {
  excludeCovered: false,
  transactions: store.transactions,
  budgets: store.budgets,
  categories: store.categories,
  loanBudget: store.loanBudget
})

Assert:
  - result.forecast.loan is a finite number (not NaN, not undefined)
  - result.forecast.loan === ytdLoan + (futureMonths * 24000/12)
    where ytdLoan = 4000, futureMonths = 10
    so expected = 4000 + (10 * 2000) = 24000
  - result.forecast.remaining is a finite number (not NaN)
```

### Test 2: forecastLoan is 0 when no loan budget is set

```
Setup:
  - resetStore()
  - store.loanBudget = {} (no entry for 2026)
  - Add 1 month of transactions (Jan 2026):
    - id:1, date:"2026-01-15", amount:5000, type:"income"
    - id:2, date:"2026-01-15", amount:-3000, type:"spending"

Call: getYearlyDashboardData("2026", { ... })

Assert:
  - result.forecast.loan === 0
```

---

## Suite: "getFilteredTransactions"

### Test 1: Filters by month

```
Setup:
  - resetStore()
  - Add 3 transactions:
    - id:1, date:"2026-01-15", amount:-100, merchant:"A", type:"spending", category:""
    - id:2, date:"2026-02-15", amount:-200, merchant:"B", type:"spending", category:""
    - id:3, date:"2026-02-20", amount:-300, merchant:"C", type:"spending", category:""

Call: getFilteredTransactions(
  { month:"2026-02", category:"all", type:"all", uncategorizedOnly:false, search:"" },
  store.transactions
)

Assert:
  - result.filtered.length === 2
  - result.filtered every tx has date starting with "2026-02"
```

### Test 2: Filters by category

```
Setup:
  - resetStore()
  - Add 3 transactions:
    - id:1, amount:-100, category:"Groceries", type:"spending"
    - id:2, amount:-200, category:"Eating out", type:"spending"
    - id:3, amount:-300, category:"Groceries", type:"spending"
  (all same date, e.g. "2026-02-15")

Call: getFilteredTransactions(
  { month:"all", category:"Groceries", type:"all", uncategorizedOnly:false, search:"" },
  store.transactions
)

Assert:
  - result.filtered.length === 2
  - all have category === "Groceries"
```

### Test 3: Filters by type

```
Setup:
  - resetStore()
  - Add transactions with types: spending, saving, income

Call: getFilteredTransactions(
  { month:"all", category:"all", type:"saving", uncategorizedOnly:false, search:"" },
  store.transactions
)

Assert:
  - All returned transactions have type === "saving"
```

### Test 4: Uncategorized-only filter excludes categorized and ignored

```
Setup:
  - Add 3 transactions:
    - id:1, category:"Groceries", type:"spending"
    - id:2, category:"", type:"spending"
    - id:3, category:"", type:"ignore"

Call: getFilteredTransactions(
  { month:"all", category:"all", type:"all", uncategorizedOnly:true, search:"" },
  store.transactions
)

Assert:
  - result.filtered.length === 1 (only id:2)
```

### Test 5: Search filters by merchant and description

```
Setup:
  - Add 3 transactions:
    - id:1, merchant:"FOETEX", description:"Groceries"
    - id:2, merchant:"DSB", description:"Train ticket"
    - id:3, merchant:"REMA1000", description:"Weekly groceries"

Call: getFilteredTransactions(
  { month:"all", category:"all", type:"all", uncategorizedOnly:false, search:"grocer" },
  store.transactions
)

Assert:
  - result.filtered.length === 2 (id:1 and id:3)
```

### Test 6: Excludes split parent transactions

```
Setup:
  - Add parent + 2 children:
    - id:1, amount:-300, splitInto:[2,3], type:"ignore"
    - id:2, amount:-200, splitFrom:1, type:"spending"
    - id:3, amount:-100, splitFrom:1, type:"spending"

Call: getFilteredTransactions(
  { month:"all", category:"all", type:"all", uncategorizedOnly:false, search:"" },
  store.transactions
)

Assert:
  - result.filtered does NOT contain id:1 (the split parent)
  - result.filtered contains id:2 and id:3
```

### Test 7: Duplicate fingerprint detection

```
Setup:
  - Add 3 transactions:
    - id:1, date:"2026-02-15", amount:-150, merchant:"FOETEX", description:"Groceries"
    - id:2, date:"2026-02-15", amount:-150, merchant:"FOETEX", description:"Groceries" (exact dupe)
    - id:3, date:"2026-02-16", amount:-200, merchant:"DSB", description:"Train"

Call: getFilteredTransactions({ month:"all", ... }, store.transactions)

Assert:
  - result.duplicateFingerprints has exactly one key
  - that key's value === 2
  - the fingerprint for id:3 is NOT in duplicateFingerprints (or has value 1)
```

### Test 8: Summary totals are correct

```
Setup:
  - Add transactions:
    - id:1, amount:-150, type:"spending"
    - id:2, amount:-50, type:"spending"
    - id:3, amount:5000, type:"income"
    - id:4, amount:-1000, type:"saving"

Call: getFilteredTransactions({ month:"all", ... }, store.transactions)

Assert:
  - result.totalSpending === 200 (absolute value)
  - result.totalIncome === 5000
```

### Test 9: Uncategorized mode sorts suggestions first

```
Setup:
  - Add 3 uncategorized transactions:
    - id:1, merchant:"FOETEX", category:"", type:"spending", amount:-100 (has pattern match)
    - id:2, merchant:"Unknown Shop", category:"", type:"spending", amount:-50 (no match)
    - id:3, merchant:"DSB", category:"", type:"spending", amount:-75 (has pattern match)

Call: getFilteredTransactions(
  { month:"all", category:"all", type:"all", uncategorizedOnly:true, search:"" },
  store.transactions
)

Assert:
  - result.filtered[0] and result.filtered[1] have merchants that match MERCHANT_PATTERNS
  - result.filtered[2].merchant === "Unknown Shop" (no suggestion, sorted last)
```

---

## Suite: "getYearlyDashboardData"

### Test 1: Correct YTD aggregation

```
Setup:
  - resetStore()
  - Add Jan + Feb transactions:
    - Jan: income 10000, spending -4000, saving -2000
    - Feb: income 10000, spending -5000, saving -2000

Call: getYearlyDashboardData("2026", { excludeCovered:false, ... })

Assert:
  - result.ytd.income === 20000
  - result.ytd.spend === 9000
  - result.ytd.save === 4000
  - result.ytd.remaining === 20000 - 9000 - 4000 = 7000
  - result.ytd.monthCount === 2
```

### Test 2: Exclude covered transactions

```
Setup:
  - resetStore()
  - Add 2 transactions in Jan:
    - id:1, amount:-1000, type:"spending", covered:false
    - id:2, amount:-500, type:"spending", covered:true

Call with excludeCovered:true

Assert:
  - result.ytd.spend === 1000 (excludes covered)

Call with excludeCovered:false

Assert:
  - result.ytd.spend === 1500 (includes covered)
```

### Test 3: Forecast uses budget for future spending

```
Setup:
  - resetStore()
  - Set budget for Groceries: 3200/month (all 12 months)
  - Add Jan transaction: amount:-3000, category:"Groceries", type:"spending"
  - (remaining 11 months have no actuals)

Call: getYearlyDashboardData("2026", { ... })

Assert:
  - result.forecast.futureMonthCount >= 10 (depends on current date vs test date)
  - result.forecast.spend > result.ytd.spend (future months add budget)
```

### Test 4: Category totals aggregate correctly across months

```
Setup:
  - resetStore()
  - Jan: FOETEX -150 (Groceries), DSB -75 (Transport)
  - Feb: FOETEX -200 (Groceries), FOETEX -100 (Groceries)

Call: getYearlyDashboardData("2026", { ... })

Assert:
  - result.catTotals["Groceries"] === 450
  - result.catTotals["Transport"] === 75
```

### Test 5: Annual budget totals sum across months

```
Setup:
  - resetStore()
  - Set Groceries budget: 3200 all 12 months
  - Set Transport budget: 710 all 12 months

Call: getYearlyDashboardData("2026", { ... })

Assert:
  - result.catBudgets["Groceries"] === 38400 (3200 * 12)
  - result.catBudgets["Transport"] === 8520 (710 * 12)
```

### Test 6: Month data array has 12 entries with correct structure

```
Setup:
  - resetStore()
  - Add at least 1 transaction in Jan 2026.

Call: getYearlyDashboardData("2026", { ... })

Assert:
  - result.monthData.length === 12
  - result.monthData[0].mk === "01"
  - result.monthData[0].month === "Jan"
  - result.monthData[0].hasActuals === true (has a transaction)
  - result.monthData[11].mk === "12"
  - result.monthData[11].hasActuals === false (no transactions in Dec)
```

---

## Suite: "CHART_COLORS constant"

### Test 1: CHART_COLORS has 12 entries

```
Assert: CHART_COLORS.length === 12
```

### Test 2: All entries are valid hex colour strings

```
Assert: CHART_COLORS.every(c => /^#[0-9a-fA-F]{6}$/.test(c))
```

---

## Notes for the implementer

- Each test should call `resetStore()` at the start.
- For `getYearlyDashboardData` tests, be aware that "current month" affects `isPast` and `hasActuals` calculations. If tests run after Feb 2026, the expected future month counts will differ. To make tests deterministic, the extracted function should accept an optional `currentDate` parameter (default: `new Date()`). The test suite can pass a fixed date like `new Date("2026-03-01")` to make assertions stable.
- The existing 42 tests must continue to pass after refactoring. Run the full suite after each change.
