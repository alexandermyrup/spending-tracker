// Builds the advisor-ready `spendingInsights` block for exported payloads.
// Pure and idempotent: given the same (normalized) store + currentDate, returns
// the same structure. Computed at export time, not persisted to localStorage.

import {
  classifyOverspendPattern,
  detectRecurringObligations,
  getCategoryBudgetStatus,
  getLastCompletedMonth,
  getMonthlyDashboardData,
  getOverspentCategories
} from './dashboard.js';
import {
  getMonthlyVariableData,
  getWeeklyReviewData
} from './variable-spend.js';
import {
  INCOME_GROUP,
  SAVINGS_GROUP,
  ensureYearBudget as ensureYearBudgetOnStore
} from './store.js';

const SPENDING_GROUPS_FOR_TRENDS = ['Variable', 'Fixed costs', 'Subscriptions', 'Insurance'];

export function buildSpendingInsights(rawStore, options = {}) {
  const currentDate = options.currentDate || new Date();
  const asOf = toIsoDate(currentDate);

  // Deep clone so ensureYearBudget / getCategoryBudgetStatus mutations stay
  // local and buildSpendingInsights remains idempotent for the caller.
  const store = JSON.parse(JSON.stringify(rawStore || {}));
  const excludeCovered = options.excludeCovered !== false;
  const ensureYearBudgetFn = year => ensureYearBudgetOnStore(store, year);

  const currentMonth = toYearMonth(currentDate);
  const lastCompletedMonth = getLastCompletedMonth(currentDate);
  const trailing12 = getTrailingMonthKeys(lastCompletedMonth, 12);
  const dashOptions = {
    store,
    excludeCovered,
    ensureYearBudget: ensureYearBudgetFn,
    currentDate
  };

  const monthlyData = trailing12.map(month => ({
    month,
    data: getMonthlyDashboardData(month, dashOptions)
  }));

  const cashFlow = buildCashFlow(monthlyData);
  const categoryTrends = buildCategoryTrends(store, trailing12, monthlyData);
  const budgetAdherence = buildBudgetAdherence(store, currentMonth, trailing12, dashOptions);
  const recurringCommitments = buildRecurringCommitments(store, cashFlow, excludeCovered, asOf);
  const overspendPatterns = buildOverspendPatterns(currentMonth, dashOptions);
  const monthlyVariablePacing = getMonthlyVariableData(currentMonth, dashOptions);
  const weeklyReview = getWeeklyReviewData(currentMonth, dashOptions);

  return {
    asOf,
    windowMonths: 12,
    currentMonth,
    lastCompletedMonth,
    cashFlow,
    categoryTrends,
    budgetAdherence,
    recurringCommitments,
    overspendPatterns,
    monthlyVariablePacing,
    weeklyReview
  };
}

// ---------- Date + window helpers ----------

function toIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function toYearMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getTrailingMonthKeys(endMonth, count) {
  const [yStr, mStr] = endMonth.split('-');
  const year = Number.parseInt(yStr, 10);
  const monthNum = Number.parseInt(mStr, 10);
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const cursor = new Date(Date.UTC(year, monthNum - 1 - i, 1));
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// ---------- Cash flow ----------

function buildCashFlow(monthlyData) {
  const monthly = monthlyData.map(({ month, data }) => ({
    month,
    income: round2(data.totalIncome),
    spend: round2(data.totalSpend),
    saving: round2(data.totalSave),
    loan: round2(data.totalLoan),
    net: round2(data.totalIncome - data.totalSpend - data.totalSave)
  }));

  const windows = [1, 3, 6, 12].map(windowSize => {
    const slice = monthly.slice(-windowSize);
    const income = sumBy(slice, entry => entry.income);
    const spend = sumBy(slice, entry => entry.spend);
    const saving = sumBy(slice, entry => entry.saving);
    const loan = sumBy(slice, entry => entry.loan);
    const net = income - spend - saving;
    return {
      window: `${windowSize}m`,
      months: slice.map(entry => entry.month),
      income: round2(income),
      spend: round2(spend),
      saving: round2(saving),
      loan: round2(loan),
      net: round2(net),
      avgPerMonth: {
        income: round2(income / windowSize),
        spend: round2(spend / windowSize),
        saving: round2(saving / windowSize),
        net: round2(net / windowSize)
      }
    };
  });

  return { monthly, clean: windows };
}

// ---------- Category trends ----------

function buildCategoryTrends(store, trailing12, monthlyData) {
  const trends = [];
  SPENDING_GROUPS_FOR_TRENDS.forEach(group => {
    const cats = (store.categories && store.categories[group]) || [];
    cats.forEach(category => {
      const monthSeries = trailing12.map((month, idx) => ({
        month,
        total: round2(monthlyData[idx].data.catTotals[category] || 0)
      }));
      const values = monthSeries.map(entry => entry.total);
      const avg3mo = average(values.slice(-3));
      const avg12mo = average(values);
      const volatilityPct = avg12mo > 0 ? stddev(values) / avg12mo : 0;
      let direction = 'flat';
      if (avg12mo > 0) {
        const delta = (avg3mo - avg12mo) / avg12mo;
        if (delta > 0.10) direction = 'growing';
        else if (delta < -0.10) direction = 'shrinking';
      }
      trends.push({
        group,
        category,
        avg3mo: round2(avg3mo),
        avg12mo: round2(avg12mo),
        monthSeries,
        volatilityPct: round3(volatilityPct),
        direction
      });
    });
  });
  return trends;
}

// ---------- Budget adherence ----------

function buildBudgetAdherence(store, currentMonth, trailing12, dashOptions) {
  const byCategory = [];
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === INCOME_GROUP || group === SAVINGS_GROUP) return;
    cats.forEach(category => {
      const status = getCategoryBudgetStatus(category, currentMonth, dashOptions);
      if (status.budget > 0 || status.actual > 0) {
        byCategory.push({
          category,
          group,
          budget: round2(status.budget),
          actual: round2(status.actual),
          variance: round2(status.variance),
          overBudget: status.isOverBudget
        });
      }
    });
  });

  // Streak detection on the last 3 completed months (tail of trailing12).
  const last3 = trailing12.slice(-3);
  const chronicOver = [];
  const chronicUnder = [];
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === INCOME_GROUP || group === SAVINGS_GROUP) return;
    cats.forEach(category => {
      const statuses = last3.map(month => getCategoryBudgetStatus(category, month, dashOptions));
      const allHaveBudget = statuses.every(s => s.budget > 0);
      if (!allHaveBudget) return;
      if (statuses.every(s => s.isOverBudget)) {
        chronicOver.push({
          category,
          group,
          monthsOver: statuses.length,
          avgVariance: round2(average(statuses.map(s => s.variance)))
        });
      } else if (statuses.every(s => !s.isOverBudget && s.actual < s.budget * 0.75)) {
        chronicUnder.push({
          category,
          group,
          monthsUnder: statuses.length,
          avgActual: round2(average(statuses.map(s => s.actual))),
          avgBudget: round2(average(statuses.map(s => s.budget)))
        });
      }
    });
  });

  return { currentMonth, byCategory, chronicOver, chronicUnder };
}

// ---------- Recurring commitments ----------

function buildRecurringCommitments(store, cashFlow, excludeCovered, asOfDate) {
  const obligations = detectRecurringObligations({ store, asOfDate, excludeCovered });
  const totalMonthly = obligations.reduce((acc, o) => {
    if (o.cadence === 'monthly') return acc + o.typicalAmount;
    if (o.cadence === 'annual') return acc + o.typicalAmount / 12;
    return acc;
  }, 0);
  const threeMonthWindow = cashFlow.clean.find(w => w.window === '3m');
  const avgIncome = threeMonthWindow ? threeMonthWindow.avgPerMonth.income : 0;
  const fixedAndSubsPct = avgIncome > 0 ? totalMonthly / avgIncome : 0;
  return {
    obligations,
    totalMonthly: round2(totalMonthly),
    avgMonthlyIncome: round2(avgIncome),
    fixedAndSubsPct: round3(fixedAndSubsPct)
  };
}

// ---------- Overspend patterns ----------

function buildOverspendPatterns(currentMonth, dashOptions) {
  const overspent = getOverspentCategories(currentMonth, dashOptions);
  return overspent.map(entry => {
    const classification = classifyOverspendPattern(entry.category, currentMonth, dashOptions);
    return {
      category: entry.category,
      actual: round2(entry.actual),
      budget: round2(entry.budget),
      variance: round2(entry.variance),
      code: classification.code,
      label: classification.label
    };
  });
}

// ---------- Math helpers ----------

function sumBy(arr, fn) {
  return arr.reduce((acc, item) => acc + fn(item), 0);
}

function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + v, 0) / arr.length;
}

function stddev(arr) {
  if (!arr || arr.length === 0) return 0;
  const mean = average(arr);
  const variance = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
