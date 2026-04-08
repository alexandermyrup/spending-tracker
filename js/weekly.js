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

// ---------- Main entry point ----------

export function getWeeklyDashboardData(month, options) {
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
    const status = computeCategoryStatus(weekSpent, weekTarget);
    const history = getCategoryWeeklyHistory(cat, store.transactions, effectiveToday, 8, excludeCovered);
    const monthDailyCumulative = getDailyCumulative(
      monthTxs.filter(tx => tx.category === cat),
      year,
      monthNum,
      totalDays
    );
    return {
      category: cat,
      weekSpent,
      weekTarget,
      monthSpent,
      monthBudget,
      status,
      history,
      monthDailyCumulative
    };
  });

  // Sort: over-target first (worst variance), then alphabetical
  categoryRows.sort((a, b) => {
    const overA = a.weekSpent - a.weekTarget;
    const overB = b.weekSpent - b.weekTarget;
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
