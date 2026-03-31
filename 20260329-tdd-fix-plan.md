# TDD Fix Plan for Spending Tracker Correctness

**Date:** 2026-03-29
**Status:** Implemented

Fixes correctness bugs identified by Codex code review, verified against actual codebase. Three red/green/refactor phases, correctness first, architecture cleanup only where it prevents the same bug class from returning.

## Success Criteria

1. No transaction can reference a category that the store, budgets, and dashboards do not recognize
2. Salary-shifted month logic is identical in dashboard and transaction drill-downs
3. Yearly YTD/forecast math remains conservative and correct with sparse or missing months
4. Import and split-delete flows never lose or inflate money totals

---

## Phase 1: Category invariants and matcher safety

Split into 1a (safety net) and 1b (new capability) so 1a can ship independently.

### Phase 1a: MERCHANT_PATTERNS immutability + centralized category resolution

**store.js:**
- `resolveCategory(name, store)`: resolves aliases first (takes priority over tombstone), then checks deletedCategories. Handles alias-to-deleted chains (A aliased to B, B deleted = empty)
- `registerCategory(name, type, store)`: auto-registers unknown categories into fallback groups (Income/Savings/Variable) with budget rows in all years
- `applyBudgetSideEffect(budgets, year, cat, month, value)`: centralized Feriepenge 12.5% calculation, extracted from duplicated inline logic

**ui.js:**
- `renameCat`: stops mutating MERCHANT_PATTERNS. Writes `categoryAliases[oldName] = newName`. Updates existing aliases that pointed to oldName. Tombstones default categories so normalizeStore does not resurrect them
- `deleteCat`: stops mutating MERCHANT_PATTERNS. Cleans up aliases pointing to deleted category
- `setBudgetCell` / `fillRight`: use `applyBudgetSideEffect()` instead of duplicated Feriepenge logic

### Phase 1b: categoryAliases, rename/delete safety, schema v4

**store.js:**
- Bump `STORE_VERSION` to 4
- Add `categoryAliases: {}` to `createEmptyStore()`
- `normalizeStore`: initializes `categoryAliases` for v3 stores (adds empty object)

**transactions.js:**
- `autoMatchMerchant`: all match paths (merchantMap, special cases, MERCHANT_PATTERNS) go through `resolvedMatch()` which calls `resolveCategory`. Deleted pattern categories return null. Merchant map entries also resolve through aliases

**Key design decision:** aliases are one level deep. When renaming B to C, the rename function updates any existing alias A->B to A->C. No recursive resolution needed.

**Migration:** v3 stores get `categoryAliases: {}` added by normalizeStore. No data transformation needed. Backward compatible with existing localStorage and JSON exports.

---

## Phase 2: Month semantics and yearly math

**store.js:**
- `getEffectiveMonth(tx, shiftDay)`: moved here from dashboard.js (canonical location for shared utilities)

**dashboard.js:**
- Re-exports `getEffectiveMonth` from store.js (backward compatible)
- `getYearlyDashboardData`: three-bucket model replaces two-bucket:
  - `elapsedMonths`: all months where `isPast` (Jan through current month for current year, all 12 for past years)
  - `dataMonths`: elapsed months that contain transactions
  - `futureMonths`: months after the current month in the selected year
- YTD budget computed across all elapsed months (not just data months)
- Forecast averages divide by elapsed month count (not data month count), so sparse imports degrade conservatively
- Return shape: `ytd.monthCount` replaced by `ytd.elapsedMonthCount` + `ytd.dataMonthCount`

**transactions.js:**
- `getFilteredTransactions`: month filter changed from `tx.date.startsWith(filters.month)` to `getEffectiveMonth(tx, shiftDay) !== filters.month`
- Salary-shifted transactions now appear in the same month in both dashboard and transaction list

**ui.js:**
- All `data.ytd.monthCount` references updated:
  - "months of data" display label uses `dataMonthCount`
  - Average denominators and cumulative indices use `elapsedMonthCount`

---

## Phase 3: Mutation safety for import and split flows

**transactions.js:**
- `deduplicateImport(existingTransactions, newRows)`: count-aware dedupe keyed by exact fingerprint. Two identical legitimate transactions on the same day survive if the existing store does not already have that many. Split parents/children excluded from fingerprint counts
- `collapseSplitParent(parent, remainingChild)`: returns surviving child's amount, category, type, manualCategory, and covered. Prevents silent amount inflation when deleting one split child

**ui.js:**
- `getImportPreviewMeta`: uses `deduplicateImport()` instead of set-based dedupe
- `deleteTx` (split collapse): uses `collapseSplitParent()` which sets `parent.amount = child.amount` instead of keeping the original parent amount

---

## Test Plan

22 new tests added to `js/tests.js`:

### Category resolution (7 tests)
- resolveCategory returns name unchanged when no alias exists
- resolveCategory resolves through aliases
- resolveCategory returns empty for deleted categories
- resolveCategory returns empty when alias points to deleted category
- resolveCategory handles empty and null input
- resolveCategory resolves renamed default categories that are also tombstoned (alias priority over tombstone)
- normalizeStore adds categoryAliases to v3 stores / preserves existing aliases (2 tests)

### Budget side effects (3 tests)
- applyBudgetSideEffect calculates Feriepenge as 12.5% of Part-time job
- applyBudgetSideEffect creates Feriepenge row if missing
- applyBudgetSideEffect does nothing for non-Part-time-job categories

### autoMatchMerchant with aliases (4 tests)
- Resolves pattern categories through aliases
- Skips patterns for deleted categories
- Resolves merchantMap categories through aliases
- Skips merchantMap entries for deleted categories

### Transaction filtering with salary shift (2 tests)
- Shifted income appears in effective month, not calendar month
- Spending stays in calendar month (unshifted)

### Yearly dashboard sparse months (3 tests)
- Sparse year uses elapsed months for YTD budget (includes empty months)
- Forecast averages use elapsed month count for conservative estimates
- Past year treats all 12 months as elapsed

### Import deduplication (4 tests)
- Count-aware dedupe allows legitimate identical transactions
- All-new transactions pass through as fresh
- Exact match count blocks all duplicates
- Split transactions excluded from existing fingerprint counts

### Split mutation safety (3 tests)
- collapseSplitParent uses child amount, not parent amount
- Collapsed amount preserves surviving child total
- Handles income child correctly

---

## Assumptions

- String category names retained (no stable IDs yet)
- Backward compatibility with existing localStorage and JSON exports required
- Unknown matched spending categories default to Variable
- Aliases are one level deep (rename function maintains this invariant)
- Public-repo cleanup and performance/storage migration are follow-on phases

## Files Changed

| File | Changes |
|------|---------|
| `js/store.js` | Schema v4, categoryAliases, getEffectiveMonth, resolveCategory, registerCategory, applyBudgetSideEffect |
| `js/transactions.js` | autoMatchMerchant alias resolution, getFilteredTransactions salary shift, deduplicateImport, collapseSplitParent |
| `js/dashboard.js` | getEffectiveMonth re-export, yearly three-bucket math, field renames |
| `js/ui.js` | Import updates, renameCat/deleteCat alias system, budget side effect helper, split collapse fix, import dedupe fix |
| `js/tests.js` | 22 new tests, schema version assertion updated |
