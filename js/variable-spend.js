import {
  INCOME_GROUP,
  SAVINGS_GROUP,
  getEffectiveMonth
} from './store.js';
import { getBudgetForMonth } from './dashboard.js';

// Weekly tab is variable-only. Fixed/Subscriptions/Insurance are excluded.
const VARIABLE_GROUP = 'Variable';
const PACE_TOLERANCE = 0.05; // ±5% defines on/ahead/behind

// ---------- Date helpers (UTC for consistency with dashboard.js) ----------

function toUtcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function parseIsoDate(dateString) {
  const [year, month, day] = dateString.split('-').map(value => Number.parseInt(value, 10));
  return toUtcDate(year, month, day);
}

function formatIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Mon=0, Sun=6 (ISO-style indexing for Mon-Sun weeks)
function isoWeekday(date) {
  const day = date.getUTCDay(); // Sun=0..Sat=6
  return (day + 6) % 7;
}

export function getWeekRange(date) {
  const start = new Date(date.getTime());
  start.setUTCDate(start.getUTCDate() - isoWeekday(start));
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}

export function getMonthBounds(year, month) {
  return {
    first: toUtcDate(year, month, 1),
    last: toUtcDate(year, month, daysInMonth(year, month)),
    days: daysInMonth(year, month)
  };
}

// ---------- Category helpers ----------

export function getVariableCategories(store) {
  const cats = (store.categories && store.categories[VARIABLE_GROUP]) || [];
  const deleted = new Set(store.deletedCategories || []);
  return cats.filter(cat => !deleted.has(cat));
}

function isVariableCategory(category, variableSet) {
  return category && variableSet.has(category);
}

// ---------- Transaction filtering ----------

function filterVariableSpending(transactions, variableSet, excludeCovered) {
  return transactions.filter(tx => {
    if (tx.splitInto) return false;
    if (tx.type !== 'spending') return false;
    if (tx.amount >= 0) return false;
    if (excludeCovered && tx.covered) return false;
    return isVariableCategory(tx.category, variableSet);
  });
}

function filterInMonth(txs, year, month, shiftDay) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return txs.filter(tx => getEffectiveMonth(tx, shiftDay) === ym);
}

function filterInDateRange(txs, startDate, endDate) {
  const startIso = formatIsoDate(startDate);
  const endIso = formatIsoDate(endDate);
  return txs.filter(tx => tx.date >= startIso && tx.date <= endIso);
}

// ---------- Pacing math ----------

export function computePacing(spent, budget, dayOfMonth, totalDays) {
  const safeBudget = Number(budget) || 0;
  const safeSpent = Number(spent) || 0;
  const safeDay = Math.max(0, Math.min(dayOfMonth, totalDays));
  const idealSpent = safeBudget * (safeDay / totalDays);
  const delta = safeSpent - idealSpent; // positive = over pace
  let status = 'on';
  if (safeBudget > 0) {
    const ratio = delta / safeBudget;
    if (ratio > PACE_TOLERANCE) status = 'behind'; // overspending
    else if (ratio < -PACE_TOLERANCE) status = 'ahead';
  }
  return {
    spent: safeSpent,
    budget: safeBudget,
    idealSpent,
    delta,
    status
  };
}

export function computeRunway(remainingBudget, remainingDays) {
  const safeBudget = Number(remainingBudget) || 0;
  const safeDays = Math.max(0, Number(remainingDays) || 0);
  if (safeDays <= 0) return 0;
  return (safeBudget / safeDays) * 7;
}

export function computeForecast(spent, dayOfMonth, totalDays, budget) {
  const safeSpent = Number(spent) || 0;
  const safeBudget = Number(budget) || 0;
  const safeDay = Math.max(1, Math.min(dayOfMonth, totalDays));
  const projected = (safeSpent / safeDay) * totalDays;
  const variance = projected - safeBudget;
  return {
    projected,
    variance,
    overBudget: variance > 0
  };
}

// ---------- Daily cumulative spend (for burn-down chart) ----------

export function getDailyCumulative(transactions, year, month, totalDays) {
  const buckets = new Array(totalDays + 1).fill(0); // 1-indexed by day
  const ymPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  transactions.forEach(tx => {
    if (!tx.date || !tx.date.startsWith(ymPrefix)) return;
    const day = Number.parseInt(tx.date.slice(8, 10), 10);
    if (!Number.isFinite(day) || day < 1 || day > totalDays) return;
    buckets[day] += Math.abs(tx.amount);
  });
  const cumulative = new Array(totalDays + 1).fill(0);
  let running = 0;
  for (let day = 1; day <= totalDays; day++) {
    running += buckets[day];
    cumulative[day] = running;
  }
  return cumulative;
}

// ---------- Weekly history slicing ----------

// Returns N consecutive Mon-Sun week buckets ending with the week containing currentDate.
export function getWeeklyHistorySlices(transactions, currentDate, count = 8, variableSet, excludeCovered) {
  const variableTxs = filterVariableSpending(transactions, variableSet, excludeCovered);
  const { start: currentStart } = getWeekRange(currentDate);
  const slices = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(currentStart.getTime());
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    const total = filterInDateRange(variableTxs, start, end)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    slices.push({
      start: formatIsoDate(start),
      end: formatIsoDate(end),
      total,
      isCurrent: i === 0
    });
  }
  return slices;
}

export function getCategoryWeeklyHistory(category, transactions, currentDate, count, excludeCovered) {
  const { start: currentStart } = getWeekRange(currentDate);
  const slices = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(currentStart.getTime());
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    const startIso = formatIsoDate(start);
    const endIso = formatIsoDate(end);
    const total = transactions
      .filter(tx => !tx.splitInto && tx.type === 'spending' && tx.amount < 0 && tx.category === category)
      .filter(tx => !excludeCovered || !tx.covered)
      .filter(tx => tx.date >= startIso && tx.date <= endIso)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    slices.push({ start: startIso, end: endIso, total, isCurrent: i === 0 });
  }
  return slices;
}

// ---------- This-week per-category breakdown ----------

function getCategoryThisWeekSpend(category, txs, weekStart, weekEnd) {
  const startIso = formatIsoDate(weekStart);
  const endIso = formatIsoDate(weekEnd);
  return txs
    .filter(tx => tx.category === category && tx.date >= startIso && tx.date <= endIso)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
}

// ---------- Per-category monthly history (month-over-month comparison) ----------

// Returns the last `count` months ending with `currentMonth` for a single
// category. Each entry = total spend in that month. Current month flagged.
// Used by the Monthly view's per-category column comparison.
export function getCategoryMonthlyHistory(category, transactions, currentMonth, count, excludeCovered) {
  const [yearStr, monthStr] = currentMonth.split('-');
  const year = Number.parseInt(yearStr, 10);
  const monthNum = Number.parseInt(monthStr, 10);
  const slices = [];
  for (let i = count - 1; i >= 0; i--) {
    const cursor = new Date(Date.UTC(year, monthNum - 1 - i, 1));
    const cy = cursor.getUTCFullYear();
    const cm = cursor.getUTCMonth() + 1;
    const ymPrefix = `${cy}-${String(cm).padStart(2, '0')}-`;
    const total = transactions
      .filter(tx => !tx.splitInto && tx.type === 'spending' && tx.amount < 0 && tx.category === category)
      .filter(tx => !excludeCovered || !tx.covered)
      .filter(tx => tx.date && tx.date.startsWith(ymPrefix))
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    slices.push({
      month: `${cy}-${String(cm).padStart(2, '0')}`,
      total,
      isCurrent: i === 0
    });
  }
  return slices;
}

// ---------- Main entry points ----------

// Renamed from getWeeklyDashboardData. This now feeds the Monthly view's
// variable-spend section (MTD pacing, burn-down, forecast, per-category comparison).
export function getMonthlyVariableData(month, options) {
  const { store, excludeCovered, ensureYearBudget, currentDate = new Date() } = options;
  const [yearStr, monthStr] = month.split('-');
  const year = Number.parseInt(yearStr, 10);
  const monthNum = Number.parseInt(monthStr, 10);
  const shiftDay = store.salaryShiftDay || 0;

  ensureYearBudget(yearStr);

  const variableCategories = getVariableCategories(store);
  const variableSet = new Set(variableCategories);

  const { days: totalDays, first: firstDay, last: lastDay } = getMonthBounds(year, monthNum);

  // Determine "today" relative to the displayed month
  // - current month: today = currentDate
  // - past month: today = last day of month (final state)
  // - future month: today = first day (zero spend)
  const todayUtc = toUtcDate(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, currentDate.getUTCDate());
  let isPast = false;
  let isFuture = false;
  let effectiveToday = todayUtc;
  if (todayUtc.getTime() > lastDay.getTime()) {
    isPast = true;
    effectiveToday = lastDay;
  } else if (todayUtc.getTime() < firstDay.getTime()) {
    isFuture = true;
    effectiveToday = firstDay;
  }
  const dayOfMonth = isFuture ? 0 : (isPast ? totalDays : effectiveToday.getUTCDate());
  const remainingDays = Math.max(0, totalDays - dayOfMonth);

  // Variable spending in this month
  const allVariableTxs = filterVariableSpending(store.transactions, variableSet, excludeCovered);
  const monthTxs = filterInMonth(allVariableTxs, year, monthNum, shiftDay);

  // Total budget = sum of variable category budgets for the month
  let totalBudget = 0;
  const categoryBudgets = {};
  variableCategories.forEach(cat => {
    const b = getBudgetForMonth(store, cat, month, ensureYearBudget) || 0;
    categoryBudgets[cat] = b;
    totalBudget += b;
  });

  // Total spent month-to-date
  const totalSpent = monthTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  // Pacing
  const pacing = computePacing(totalSpent, totalBudget, dayOfMonth, totalDays);

  // Runway
  const remainingBudget = Math.max(0, totalBudget - totalSpent);
  const runway = computeRunway(remainingBudget, remainingDays);

  // Forecast
  const forecast = computeForecast(totalSpent, dayOfMonth, totalDays, totalBudget);

  // Daily cumulative for burn-down chart
  const dailyCumulative = getDailyCumulative(monthTxs, year, monthNum, totalDays);

  // Current week range
  const weekRange = getWeekRange(effectiveToday);
  const weekLabel = formatWeekLabel(weekRange.start, weekRange.end);

  // This-week per-category breakdown
  const weeklyTargetMultiplier = 7 / totalDays;
  const categoryRows = variableCategories.map(cat => {
    const monthBudget = categoryBudgets[cat] || 0;
    const weekTarget = monthBudget * weeklyTargetMultiplier;
    const weekSpent = getCategoryThisWeekSpend(cat, monthTxs, weekRange.start, weekRange.end);
    const monthSpent = monthTxs
      .filter(tx => tx.category === cat)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    // Status: month-spend vs month-budget (the relevant signal in Monthly view)
    const status = computeCategoryStatus(monthSpent, monthBudget);
    const monthlyHistory = getCategoryMonthlyHistory(cat, store.transactions, month, 6, excludeCovered);
    return {
      category: cat,
      weekSpent,
      weekTarget,
      monthSpent,
      monthBudget,
      status,
      monthlyHistory
    };
  });

  // Sort: over-budget first (worst variance), then alphabetical
  categoryRows.sort((a, b) => {
    const overA = a.monthSpent - a.monthBudget;
    const overB = b.monthSpent - b.monthBudget;
    if (overA > 0 && overB <= 0) return -1;
    if (overB > 0 && overA <= 0) return 1;
    if (overA !== overB) return overB - overA;
    return a.category.localeCompare(b.category);
  });

  // Aggregate this-week numbers
  const weekSpent = categoryRows.reduce((sum, row) => sum + row.weekSpent, 0);
  const weekTarget = totalBudget * weeklyTargetMultiplier;
  const weekStatus = computeCategoryStatus(weekSpent, weekTarget);

  // 8-week aggregate history
  const weeklyHistory = getWeeklyHistorySlices(store.transactions, effectiveToday, 8, variableSet, excludeCovered);
  const trend = computeTrend(weeklyHistory);

  return {
    month,
    year,
    monthNum,
    totalDays,
    dayOfMonth,
    remainingDays,
    isPast,
    isFuture,
    weekLabel,
    weekStart: formatIsoDate(weekRange.start),
    weekEnd: formatIsoDate(weekRange.end),
    pacing,
    totalSpent,
    totalBudget,
    runway,
    forecast,
    dailyCumulative,
    week: {
      spent: weekSpent,
      target: weekTarget,
      status: weekStatus
    },
    categoryRows,
    weeklyHistory,
    trend,
    variableCategoryCount: variableCategories.length
  };
}

function computeCategoryStatus(spent, target) {
  if (target <= 0) {
    return spent > 0 ? 'behind' : 'on';
  }
  const ratio = (spent - target) / target;
  if (ratio > PACE_TOLERANCE) return 'behind';
  if (ratio < -PACE_TOLERANCE) return 'ahead';
  return 'on';
}

function computeTrend(slices) {
  if (slices.length < 2) return { direction: 'flat', delta: 0, average: 0 };
  const totals = slices.map(s => s.total);
  const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const half = Math.floor(slices.length / 2);
  const earlierAvg = totals.slice(0, half).reduce((sum, v) => sum + v, 0) / Math.max(half, 1);
  const recentAvg = totals.slice(-half).reduce((sum, v) => sum + v, 0) / Math.max(half, 1);
  if (earlierAvg <= 0 && recentAvg <= 0) return { direction: 'flat', delta: 0, average };
  const delta = earlierAvg > 0 ? (recentAvg - earlierAvg) / earlierAvg : 0;
  let direction = 'flat';
  if (delta > 0.05) direction = 'up';
  else if (delta < -0.05) direction = 'down';
  return { direction, delta, average };
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWeekLabel(start, end) {
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startLabel = `${MONTH_NAMES_SHORT[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const endLabel = sameMonth
    ? String(end.getUTCDate())
    : `${MONTH_NAMES_SHORT[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${startLabel} – ${endLabel}`;
}

// ====================================================================
// Weekly Review (last full week + comparison)
// ====================================================================

// Returns the most recent fully completed Mon-Sun week before currentDate.
// "Fully completed" means the week's Sunday is strictly before today.
export function getLastFullWeek(currentDate) {
  const today = toUtcDate(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, currentDate.getUTCDate());
  // Go back to the most recent Sunday that is < today
  const day = today.getUTCDay(); // Sun=0..Sat=6
  // Days to subtract to get to "last Sunday strictly before today":
  //   if today is Mon (1) → 1 day back (yesterday's Sunday)
  //   if today is Sun (0) → 7 days back (last Sunday, not today)
  //   if today is Wed (3) → 3 days back
  const daysSinceLastSunday = day === 0 ? 7 : day;
  const lastSunday = new Date(today.getTime());
  lastSunday.setUTCDate(lastSunday.getUTCDate() - daysSinceLastSunday);
  const lastMonday = new Date(lastSunday.getTime());
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 6);
  return { start: lastMonday, end: lastSunday };
}

// Returns the N weeks immediately BEFORE the given week (used as the
// independent baseline for comparison). Going back from `weekStart`.
function getPriorWeeks(weekStart, count) {
  const weeks = [];
  for (let i = 1; i <= count; i++) {
    const start = new Date(weekStart.getTime());
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    weeks.push({ start, end });
  }
  return weeks; // Most recent prior week first
}

// Sums variable spend in [start, end] (inclusive).
function sumVariableInRange(transactions, variableSet, excludeCovered, start, end) {
  return filterVariableSpending(transactions, variableSet, excludeCovered)
    .filter(tx => {
      const startIso = formatIsoDate(start);
      const endIso = formatIsoDate(end);
      return tx.date >= startIso && tx.date <= endIso;
    })
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
}

// Sums spend for a specific category in [start, end].
function sumCategoryInRange(transactions, category, excludeCovered, start, end) {
  const startIso = formatIsoDate(start);
  const endIso = formatIsoDate(end);
  return transactions
    .filter(tx => !tx.splitInto && tx.type === 'spending' && tx.amount < 0 && tx.category === category)
    .filter(tx => !excludeCovered || !tx.covered)
    .filter(tx => tx.date >= startIso && tx.date <= endIso)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
}

// Returns the weekly history (8 weeks ending with `referenceWeekStart`'s week).
// The reference week is included as the LAST entry (so the most recent of the 8).
function getWeekHistoryEndingAt(transactions, variableSet, excludeCovered, referenceWeekStart, count = 8) {
  const slices = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(referenceWeekStart.getTime());
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    const total = sumVariableInRange(transactions, variableSet, excludeCovered, start, end);
    slices.push({
      start: formatIsoDate(start),
      end: formatIsoDate(end),
      total,
      isReference: i === 0
    });
  }
  return slices;
}

// Returns the same shape but for a single category.
function getCategoryHistoryEndingAt(transactions, category, excludeCovered, referenceWeekStart, count = 8) {
  const slices = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(referenceWeekStart.getTime());
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    const total = sumCategoryInRange(transactions, category, excludeCovered, start, end);
    slices.push({
      start: formatIsoDate(start),
      end: formatIsoDate(end),
      total,
      isReference: i === 0
    });
  }
  return slices;
}

// Computes the rank of `target` within `values` (1-indexed, 1 = highest).
// Ties: more recent wins. `values` is assumed to be in chronological order
// (oldest first, target last). Returns { rank, total, label } where label
// is human-readable like "3rd highest of last 8".
export function getRanking(values) {
  if (!values || values.length === 0) return { rank: 0, total: 0, label: '' };
  const target = values[values.length - 1];
  const targetIndex = values.length - 1;
  // Count how many values are strictly greater than target
  let strictlyGreater = 0;
  // For ties, count those that come later (none, since target is last)
  for (let i = 0; i < targetIndex; i++) {
    if (values[i] > target) strictlyGreater++;
  }
  const rank = strictlyGreater + 1;
  return {
    rank,
    total: values.length,
    label: `${ordinal(rank)} highest of last ${values.length}`
  };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Computes baseline statistics from a list of weekly totals (the 4 weeks
// BEFORE the reference week, i.e. independent baseline).
function computeBaseline(priorWeekTotals) {
  if (!priorWeekTotals || priorWeekTotals.length === 0) {
    return { average: 0, count: 0 };
  }
  const sum = priorWeekTotals.reduce((s, v) => s + v, 0);
  return {
    average: sum / priorWeekTotals.length,
    count: priorWeekTotals.length
  };
}

// Compute week-pace projection: if every week of the displayed month looked
// like the reference week, where would the month end up?
function computeWeekPaceProjection(weekTotal, year, month, monthlyBudget) {
  const totalDays = daysInMonth(year, month);
  const weeksInMonth = totalDays / 7;
  const projected = weekTotal * weeksInMonth;
  const variance = projected - monthlyBudget;
  return {
    projected,
    variance,
    overBudget: variance > 0,
    weeksInMonth
  };
}

// Main entry point for the new Weekly tab.
// If options.weekOverride is provided ({ start: Date, end: Date }), uses that week
// instead of the last full week. This enables the week selector (prev/next arrows).
export function getWeeklyReviewData(month, options) {
  const { store, excludeCovered, ensureYearBudget, currentDate = new Date(), weekOverride } = options;
  const [yearStr, monthStr] = month.split('-');
  const year = Number.parseInt(yearStr, 10);
  const monthNum = Number.parseInt(monthStr, 10);

  ensureYearBudget(yearStr);

  const variableCategories = getVariableCategories(store);
  const variableSet = new Set(variableCategories);

  // Use override week if provided, otherwise default to last full week
  const { start: weekStart, end: weekEnd } = weekOverride || getLastFullWeek(currentDate);
  const isCurrentWeek = !weekOverride ? false : (() => {
    const { start: cwStart } = getWeekRange(currentDate);
    return weekOverride.start.getTime() === cwStart.getTime();
  })();

  // Total monthly variable budget for the displayed month
  let monthlyBudget = 0;
  const categoryMonthlyBudgets = {};
  variableCategories.forEach(cat => {
    const b = getBudgetForMonth(store, cat, month, ensureYearBudget) || 0;
    categoryMonthlyBudgets[cat] = b;
    monthlyBudget += b;
  });

  // Weekly target = monthly budget × 7 / days in displayed month
  const totalDays = daysInMonth(year, monthNum);
  const weeklyTargetMultiplier = 7 / totalDays;
  const weekTarget = monthlyBudget * weeklyTargetMultiplier;

  // Sum spend for last full week (across all variable categories)
  const weekSpent = sumVariableInRange(store.transactions, variableSet, excludeCovered, weekStart, weekEnd);

  // Status pill: vs target with ±5% tolerance (same as monthly)
  const status = computeCategoryStatus(weekSpent, weekTarget);

  // 8-week history ending with the last full week (for ranking + trend chart)
  const weekHistory = getWeekHistoryEndingAt(store.transactions, variableSet, excludeCovered, weekStart, 8);
  const ranking = getRanking(weekHistory.map(w => w.total));

  // Baseline = the 4 weeks BEFORE the last full week (independent baseline)
  const priorFour = getPriorWeeks(weekStart, 4).map(({ start, end }) =>
    sumVariableInRange(store.transactions, variableSet, excludeCovered, start, end)
  );
  const baseline = computeBaseline(priorFour);
  const baselineDelta = baseline.average > 0 ? (weekSpent - baseline.average) / baseline.average : 0;

  // Week-pace projection: if every week looked like this one, where does the month end?
  const projection = computeWeekPaceProjection(weekSpent, year, monthNum, monthlyBudget);

  // Per-category breakdown for last full week
  const categoryRows = variableCategories.map(cat => {
    const monthBudget = categoryMonthlyBudgets[cat] || 0;
    const catWeekTarget = monthBudget * weeklyTargetMultiplier;
    const catWeekSpent = sumCategoryInRange(store.transactions, cat, excludeCovered, weekStart, weekEnd);
    const catStatus = computeCategoryStatus(catWeekSpent, catWeekTarget);
    const history = getCategoryHistoryEndingAt(store.transactions, cat, excludeCovered, weekStart, 8);
    return {
      category: cat,
      weekSpent: catWeekSpent,
      weekTarget: catWeekTarget,
      monthBudget,
      status: catStatus,
      history
    };
  });

  // Sort tiers: (1) over-budget by overshoot desc, (2) non-zero spend by spend desc, (3) zero spend alphabetical
  const tier = row => {
    if (row.weekTarget > 0 && row.weekSpent > row.weekTarget) return 0;
    if (row.weekSpent > 0) return 1;
    return 2;
  };
  categoryRows.sort((a, b) => {
    const tA = tier(a);
    const tB = tier(b);
    if (tA !== tB) return tA - tB;
    if (tA === 0) return (b.weekSpent - b.weekTarget) - (a.weekSpent - a.weekTarget);
    if (tA === 1) return b.weekSpent - a.weekSpent;
    return a.category.localeCompare(b.category);
  });

  return {
    month,
    year,
    monthNum,
    weekStart: formatIsoDate(weekStart),
    weekEnd: formatIsoDate(weekEnd),
    weekLabel: formatWeekLabel(weekStart, weekEnd),
    weekSpent,
    weekTarget,
    monthlyBudget,
    status,
    ranking,
    baseline: {
      average: baseline.average,
      count: baseline.count,
      delta: baselineDelta // signed fraction; positive = above baseline
    },
    projection,
    categoryRows,
    weekHistory,
    variableCategoryCount: variableCategories.length,
    isCurrentWeek: weekOverride ? isCurrentWeek : false,
    hasData: weekHistory.some(w => w.total > 0) || weekSpent > 0
  };
}
