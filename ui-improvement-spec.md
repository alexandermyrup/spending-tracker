# Spending Tracker: UI/UX Improvement Spec

**Date:** 2026-03-21
**Audited using:** ui-ux-pro-max v2.0.1
**Scope:** Complete audit of `spending-tracker.html` + JS modules
**Approach:** Review against 10 priority categories (Accessibility through Charts & Data)

---

## Current State Summary

**What's working well:**
- Clean card-based layout with consistent border/shadow treatment
- Good use of Inter font with tabular-nums for financial data
- Material Symbols for icons (no emoji abuse)
- Responsive sidebar/bottom nav pattern
- Solid information hierarchy on the monthly scorecard
- Context-aware category dropdowns (income vs spending)
- Certainty-banded suggestion badges (green/amber with dashed borders)
- Smart review modes (uncategorized, low-certainty, conflicts, recent imports)

**What needs work:** See findings below, organized by priority.

---

## P1: Critical (Accessibility + Touch + Core Usability)

### 1.1 Color-Only Information Encoding

**Where:** Transaction amounts, budget bars, scorecard verdict
**Issue:** Red/green is the sole indicator for negative/positive amounts, over/under budget, and pass/fail verdicts. ~8% of men have red-green color vision deficiency.
**Fix:**
- Add directional icons next to amounts: `arrow_downward` for outflows, `arrow_upward` for inflows
- Budget bars: add a small icon or text label ("over" / "left") alongside the color change
- Scorecard: already has text ("Under budget" / "Over budget") which is good, but the gradient background shift alone isn't sufficient for the diagnosis cards

**Effort:** Small (1-2 hours)

### 1.2 Contrast Failures

**Where:** Multiple locations
**Issue:** Several text elements fall below WCAG AA 4.5:1 ratio:
- `text-slate-400` on white background = ~3.1:1 (used for sublabels like "Personal Finance", salary shift note)
- `text-slate-500` on white = ~4.0:1 (used heavily for secondary text, helper descriptions)
- `text-[10px]` bottom nav labels and chart axis labels are both small and low contrast
- Budget table `th` headers use `text-slate-500` at `11px` uppercase

**Fix:**
- Promote `text-slate-400` to `text-slate-500` minimum
- Promote `text-slate-500` to `text-slate-600` for anything under 14px
- Bottom nav labels: bump to `text-[11px]` and `text-slate-600`

**Effort:** Small (1 hour)

### 1.3 Keyboard Navigation Gaps

**Where:** Transaction table, category dropdowns, dashboard controls
**Issue:**
- Category dropdown opens on click but has no keyboard support (no `Enter` to open, no arrow keys to navigate options, no `Escape` to close)
- Transaction action buttons (split, delete, restore, covered toggle) use `onclick` on `<span>` elements with no `role="button"` or `tabindex="0"`
- The "Accept suggestion" badges are clickable spans, not buttons
- Type selector `<select>` is fine natively, but the covered toggle and action icons are invisible to keyboard users

**Fix:**
- Convert all clickable `<span>` action elements to `<button>` elements (or add `role="button" tabindex="0"` with keydown handler)
- Add `Escape` to close category dropdown and modal overlays (via `keydown` listener on document)
- Add arrow key navigation within category dropdown options

**Effort:** Medium (3-4 hours)

### 1.4 Missing ARIA / Semantic Markup

**Where:** Throughout
**Issue:**
- Modals (`modal-new-cat`, `modal-split`) lack `role="dialog"` and `aria-modal="true"`
- Toast notification has no `role="status"` or `aria-live="polite"`
- Category dropdown has no `role="listbox"` / `role="option"`
- Navigation sections have no `aria-current="page"` on active items
- Tables lack `scope="col"` on `<th>` elements
- No skip-to-content link

**Fix:**
- Add `role="dialog" aria-modal="true" aria-labelledby="..."` to modal overlays
- Add `role="status" aria-live="polite"` to the toast element
- Add `aria-current="page"` to active nav items
- Add `scope="col"` to all `<th>` elements
- Add a visually-hidden skip link before the nav

**Effort:** Small-Medium (2-3 hours)

### 1.5 Touch Target Sizing (Mobile)

**Where:** Transaction table action buttons, budget table inputs
**Issue:**
- Delete/split/restore action icons render at ~32x32px (below 44x44pt minimum)
- Budget table `input[type="number"]` cells are 60px wide x ~28px tall (hard to tap accurately)
- Bottom nav items are adequate but tight at 10px font
- Category dropdown options have `min-height: 32px` (below 44px minimum)

**Fix:**
- Transaction action buttons: increase to `w-10 h-10` (40px) with `min-h-[44px]` hit area
- Budget table inputs: increase height to 36px+ on mobile
- Category dropdown options: increase `min-height` to 44px
- Consider a responsive approach: show action icons in a swipe-to-reveal pattern on mobile instead of cramming them into the last column

**Effort:** Medium (2-3 hours)

### 1.6 Transaction Table Mobile Overflow

**Where:** Transactions tab
**Issue:** The transaction table has 8 columns (Date, Merchant, Description, Amount, Category, Type, Covered, Actions). On mobile, this relies entirely on horizontal scroll within `overflow-x-auto`. Users see ~2 columns and must scroll to find the rest. No indication that more columns exist.
**Fix options (pick one):**
- **Card layout on mobile:** Below 768px, render each transaction as a card instead of a table row. Date + merchant as header, amount prominent, category/type/actions as inline controls
- **Progressive disclosure:** Show only Date, Merchant, Amount on mobile. Tap a row to expand details inline
- **Column priority:** Hide Description and Covered columns on mobile via responsive classes. They're the least actionable

**Effort:** Medium-Large (4-6 hours for card layout, 2-3 hours for column hiding)

---

## P2: High Impact (Layout, Data Viz, Interaction Polish)

### 2.1 Chart Color Palette

**Where:** `CHART_COLORS` in store.js, all bar/category charts
**Issue:** Current 12-color array is hand-picked hex values without perceptual uniformity or colorblind safety. Red (#e11d48) and pink (#db2777) are hard to distinguish. Multiple blues/purples overlap.
**Fix:**
- Replace with a colorblind-friendly qualitative palette (e.g., ColorBrewer Set2, Tableau 10, or Observable 10)
- Already flagged in roadmap as P3 but should be P2 given accessibility implications
- Test with a colorblind simulator (e.g., Coblis)

**Effort:** Small (30 min)

### 2.2 Chart Accessibility

**Where:** Category bars, trend bars, budget bars
**Issue:**
- CSS-only bar charts have no `aria-label` or screen reader alternative
- No data table fallback for any chart
- Trend chart bar labels use `text-[10px]` which is below minimum readable size
- Budget progress bars have no `role="progressbar"` or `aria-valuenow`

**Fix:**
- Add `role="img" aria-label="Spending by category: Groceries 3,200 kr, Eating out 450 kr, ..."` to chart containers
- Add `role="progressbar" aria-valuenow="..." aria-valuemax="..."` to budget progress bars
- Consider a "View as table" toggle for each chart (low effort, high a11y win)

**Effort:** Medium (3 hours)

### 2.3 Dashboard Information Density

**Where:** Monthly dashboard view
**Issue:** The dashboard currently shows: scorecard hero, diagnosis, savings progress, recurring obligations, category chart, budget vs actual, merchants, trend. That's 8 cards requiring significant scroll. On a 1080p screen, the drill-down section is below the fold.
**Fix:**
- Consider collapsible sections (the "Drill Down" label already implies this is secondary)
- Make the drill-down section collapsed by default with a "Show detail" toggle
- Or: use a tabbed interface within the dashboard (Overview | Breakdown | Trends)

**Effort:** Small (1-2 hours for collapsible, more for tabs)

### 2.4 Budget Table UX

**Where:** Budgets tab
**Issue:**
- Right-click to fill-right is discoverable only via the subtitle text. No tooltip, no visual hint
- No way to see actuals alongside budgets in the budget editor (you need to flip to the dashboard)
- No visual indication of which cells have been edited vs defaults

**Fix:**
- Add a small context menu icon or `...` button in each cell on hover/focus
- Consider showing a faint actual-vs-budget comparison row below each category
- Add subtle background tint for cells that differ from the default budget

**Effort:** Medium (3-4 hours)

### 2.5 Empty States

**Where:** Dashboard (no data), Transactions (empty), Categories (no custom categories)
**Issue:** When there's no data, several sections show bare text like "No merchant outflows to show" or render empty. First-time users see a mostly blank dashboard with no guidance.
**Fix:**
- Add illustrated empty states with clear CTAs: "Import your first CSV to see spending data" with a button linking to the Import tab
- For budget cards with no budget set: "Set a budget to track this category" with a link to the budget editor

**Effort:** Small-Medium (2-3 hours)

### 2.6 Loading & State Transitions

**Where:** App-wide
**Issue:** All renders happen synchronously via innerHTML replacement. Large transaction lists (500+) may cause visible flash. No loading indicators, no skeleton screens, no transition animations between states.
**Fix:**
- Add a brief fade transition when switching between sections (CSS `transition: opacity 0.15s`)
- For the transaction table: consider virtual scrolling if the list exceeds ~200 rows (currently renders all rows)
- Add skeleton shimmer to dashboard cards during initial render

**Effort:** Small for transitions (1 hour), Medium-Large for virtual scrolling (4+ hours)

### 2.7 Consistent Card Spacing

**Where:** Dashboard, Category manager
**Issue:** Card internal padding varies: some use `p-5`, others `p-4`, scorecard breakdown uses `p-3`. The gap between card groups switches between `gap-6`, `gap-4`, and `gap-3` without clear reasoning.
**Fix:**
- Standardize: `p-5` (20px) for all card padding, `gap-6` (24px) between cards, `gap-3` (12px) within card sub-elements
- Document the spacing scale in a comment block

**Effort:** Small (1 hour)

---

## P3: Medium Impact (Polish & Enhancement)

### 3.1 Dark Mode Support

**Where:** App-wide
**Issue:** No dark mode. The app uses hardcoded light-mode colors throughout (white backgrounds, slate borders, specific text colors). Given this is a personal finance tool often checked at night, dark mode would be a quality-of-life win.
**Fix:**
- Add `prefers-color-scheme: dark` media query support via Tailwind's `dark:` prefix
- Define semantic color tokens (surface, text-primary, text-secondary, border, accent) and map them to light/dark variants
- Note: this is a significant effort given the ~2,000 lines of inline styles

**Effort:** Large (8-12 hours for full implementation)

### 3.2 Filter State Persistence

**Where:** Transaction filters, dashboard month selector
**Issue:** All filter states reset when switching tabs. If you're reviewing uncategorized transactions, switch to Dashboard to check something, and switch back, your filter context is gone.
**Fix:**
- Persist filter state in `sessionStorage` or in the store object
- Restore filters when re-entering a tab

**Effort:** Small (1-2 hours)

### 3.3 Toast Improvements

**Where:** Toast notification element
**Issue:**
- Toast dismisses after 3s with no way to manually dismiss
- No visual distinction between success/error/info toasts (all use `bg-slate-900`)
- On mobile, the toast at `bottom-5 right-5` may overlap with the bottom nav bar

**Fix:**
- Add click-to-dismiss and a small close icon
- Add color variants: success (green accent), error (red accent), info (blue accent)
- On mobile, position toast above the bottom nav (`bottom-20`)

**Effort:** Small (1-2 hours)

### 3.4 Hover-Only Interactions

**Where:** Budget table inputs, transaction action icons
**Issue:**
- Budget table inputs only show border on hover (`border-color: transparent` by default). On touch devices, there's no hover state, so inputs look like plain text until tapped
- Transaction action icons are at `opacity-50` by default, relying on hover to become visible

**Fix:**
- Budget table inputs: show a subtle border by default (`border-slate-200`) and enhance on focus
- Action icons: increase default opacity to 0.6, or show them only on row hover/focus (but keep them visible on mobile)

**Effort:** Small (1 hour)

### 3.5 Confirmation Dialog Improvements

**Where:** Delete transaction, Clear all
**Issue:** Uses native `window.confirm()` which:
- Can't be styled
- Blocks the main thread
- Has no undo option

**Fix:**
- Replace with a custom modal confirmation dialog matching the app's design language
- For single deletes: add an undo toast ("Transaction deleted. Undo") instead of a confirmation dialog
- Keep the double-confirm for Clear All (destructive bulk action)

**Effort:** Medium (3-4 hours)

### 3.6 Animation & Transitions

**Where:** Section switching, modal open/close, dropdown
**Issue:**
- Sections appear/disappear instantly (`display: none` toggle)
- Modals appear via CSS class toggle with no entry animation
- Category dropdown appears without transition

**Fix:**
- Modals: add scale+fade entry (transform: scale(0.95) + opacity 0 to scale(1) + opacity 1, 200ms ease-out)
- Sections: add fade transition (150ms)
- Category dropdown: add slide-down + fade (150ms)

**Effort:** Small (1-2 hours)

### 3.7 Typography Refinements

**Where:** App-wide
**Issue:**
- Scorecard hero text uses `text-3xl sm:text-4xl lg:text-5xl` which is appropriate but the `text-wrap: balance` only works in Chrome
- Some label text uses `text-[10px]` and `text-[11px]` extensively, creating an inconsistent type scale
- The app uses 7+ font sizes: 10, 11, 12, 13, 14, 16, 18, 20, 24, 30, 36, 48px

**Fix:**
- Consolidate to a systematic type scale: 11, 13, 14, 16, 20, 24, 32, 48px (8 sizes)
- Replace `text-wrap: balance` with a max-width constraint for cross-browser support
- Ensure minimum 12px for any text that conveys information (10px labels are decorative at best)

**Effort:** Small-Medium (2-3 hours)

---

## Implementation Order (Recommended)

| Phase | Items | Time Estimate | Why First |
|-------|-------|---------------|-----------|
| **Phase 1** | 1.1, 1.2, 1.4 | ~4 hours | Quick accessibility wins, no UI restructuring |
| **Phase 2** | 1.3, 2.1, 2.2 | ~6 hours | Keyboard nav + chart accessibility |
| **Phase 3** | 1.5, 1.6 | ~6 hours | Mobile usability |
| **Phase 4** | 2.3, 2.5, 2.7, 3.3, 3.4 | ~6 hours | Polish batch |
| **Phase 5** | 2.4, 2.6, 3.2, 3.5, 3.6 | ~10 hours | Interaction quality |
| **Phase 6** | 3.1, 3.7 | ~12 hours | Dark mode + typography system |

**Total estimated effort:** ~44 hours across 6 phases

---

## Items NOT in Scope

These are functional improvements (already tracked in the roadmap) rather than UI/UX issues:
- SU loan debug
- Categorization certainty levels engine
- Sankey diagrams / advanced data viz
- Multi-account support
- Year-over-year comparison

---

## Design System Notes

The current design is clean and functional. It doesn't need a radical style change. The recommended direction:

- **Keep:** Inter font, slate color system, card-based layout, Material Symbols
- **Improve:** Color palette for data viz, spacing consistency, type scale discipline
- **Add:** Dark mode, keyboard accessibility, mobile-optimized transaction view
- **Consider for later:** If the app grows beyond 5 sections, evaluate switching to a more structured navigation pattern (e.g., top tabs replacing the bottom nav)
