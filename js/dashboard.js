import {
  CHART_COLORS,
  INCOME_GROUP,
  MONTH_KEYS,
  MONTHS,
  SAVINGS_GROUP
} from './store.js';

export { CHART_COLORS };
export const MAX_VISIBLE_MONTHS = 12;
const FIXED_SCORECARD_GROUPS = new Set(['Fixed costs', 'Subscriptions', 'Insurance']);

export function getLastCompletedMonth(currentDate = new Date()) {
  const year = currentDate.getFullYear();
  const monthIndex = currentDate.getMonth();
  if (monthIndex === 0) return `${year - 1}-12`;
  return `${year}-${String(monthIndex).padStart(2, '0')}`;
}

export function getEffectiveMonth(tx, shiftDay) {
  const raw = tx.date.slice(0, 7);
  if (!shiftDay) return raw;
  const isIncome = tx.type === 'income' || (tx.amount > 0 && tx.type !== 'ignore' && tx.type !== 'loan');
  const shouldShift = isIncome || tx.type === 'saving';
  if (!shouldShift) return raw;
  const day = Number.parseInt(tx.date.slice(8, 10), 10);
  if (day <= shiftDay) return raw;
  const year = Number.parseInt(tx.date.slice(0, 4), 10);
  const month = Number.parseInt(tx.date.slice(5, 7), 10);
  if (month === 12) return `${year + 1}-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function getUniqueMonths(transactions, shiftDay) {
  const months = new Set();
  transactions.forEach(tx => {
    if (!tx.date || tx.date.length < 7) return;
    months.add(getEffectiveMonth(tx, shiftDay));
  });
  return [...months].sort();
}

export function getRecentMonths(transactions, shiftDay, limit = MAX_VISIBLE_MONTHS) {
  const months = getUniqueMonths(transactions, shiftDay);
  return months.slice(-limit);
}

export function getBudgetForMonth(store, cat, yearMonth, ensureYearBudget) {
  const [year, month] = yearMonth.split('-');
  ensureYearBudget(year);
  if (store.budgets[year] && store.budgets[year][cat]) return store.budgets[year][cat][month] || 0;
  return 0;
}

export function getMonthlyTrendData(store, excludeCovered) {
  const months = getRecentMonths(store.transactions, store.salaryShiftDay || 0);
  return months.map(month => {
    let txs = store.transactions.filter(tx => !tx.splitInto && getEffectiveMonth(tx, store.salaryShiftDay || 0) === month && tx.type === 'spending' && tx.amount < 0);
    if (excludeCovered) txs = txs.filter(tx => !tx.covered);
    return {
      month,
      total: Math.abs(txs.reduce((sum, tx) => sum + tx.amount, 0))
    };
  });
}

export function getMonthlyDashboardData(month, options) {
  const { store, excludeCovered, ensureYearBudget } = options;
  const shiftDay = store.salaryShiftDay || 0;
  let txs = store.transactions.filter(tx => !tx.splitInto && getEffectiveMonth(tx, shiftDay) === month);
  if (excludeCovered) txs = txs.filter(tx => !tx.covered);
  const spending = txs.filter(tx => tx.type === 'spending' && tx.amount < 0);
  const saving = txs.filter(tx => tx.type === 'saving' && tx.amount < 0);
  const income = txs.filter(tx => tx.type === 'income' || (tx.amount > 0 && tx.type !== 'ignore' && tx.type !== 'loan'));
  const loans = txs.filter(tx => tx.type === 'loan');
  const totalSpend = Math.abs(spending.reduce((sum, tx) => sum + tx.amount, 0));
  const totalSave = Math.abs(saving.reduce((sum, tx) => sum + tx.amount, 0));
  const totalIncome = income.reduce((sum, tx) => sum + tx.amount, 0);
  const totalLoan = loans.reduce((sum, tx) => sum + tx.amount, 0);
  const [year, mk] = month.split('-');
  ensureYearBudget(year);
  const yearBudget = store.budgets[year] || {};
  let floorBudget = 0;
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
    cats.forEach(cat => {
      floorBudget += (yearBudget[cat] && yearBudget[cat][mk]) || 0;
    });
  });
  const actualRemaining = totalIncome - totalSpend - totalSave;
  const budgetVariance = floorBudget - totalSpend;
  const uncatCount = txs.filter(tx => !tx.category && tx.type !== 'ignore' && !tx.splitInto).length;
  const catTotals = {};
  spending.forEach(tx => {
    const cat = tx.category || 'Uncategorized';
    catTotals[cat] = (catTotals[cat] || 0) + Math.abs(tx.amount);
  });
  const merchantTotals = {};
  spending.forEach(tx => {
    merchantTotals[tx.merchant] = (merchantTotals[tx.merchant] || 0) + Math.abs(tx.amount);
  });
  return {
    txs,
    spending,
    totalSpend,
    totalSave,
    totalIncome,
    totalLoan,
    floorBudget,
    actualRemaining,
    budgetVariance,
    uncatCount,
    catTotals,
    merchantTotals,
    trend: getMonthlyTrendData(store, excludeCovered)
  };
}

function getScorecardSpendingType(category, categories) {
  if (!category) return 'discretionary';
  for (const [group, cats] of Object.entries(categories)) {
    if (!cats.includes(category)) continue;
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return null;
    return FIXED_SCORECARD_GROUPS.has(group) ? 'fixed' : 'discretionary';
  }
  return 'discretionary';
}

function getSavingBucket(tx) {
  if (tx.type !== 'saving' || tx.amount >= 0) return null;
  return tx.category === 'Investments' ? 'invested' : 'cashSaved';
}

export function getMonthlyScorecardData(month, options) {
  const { store, ensureYearBudget } = options;
  const base = getMonthlyDashboardData(month, options);
  const [year, monthKey] = month.split('-');

  ensureYearBudget(year);

  const spendingBreakdown = {
    fixed: { actual: 0, budget: 0 },
    discretionary: { actual: 0, budget: 0 }
  };
  const savings = {
    cashSaved: 0,
    invested: 0
  };

  base.spending.forEach(tx => {
    const bucket = getScorecardSpendingType(tx.category, store.categories);
    if (!bucket) return;
    spendingBreakdown[bucket].actual += Math.abs(tx.amount);
  });

  base.txs.forEach(tx => {
    const bucket = getSavingBucket(tx);
    if (!bucket) return;
    savings[bucket] += Math.abs(tx.amount);
  });

  const overBudgetCategories = [];
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
    cats.forEach(cat => {
      const budget = getBudgetForMonth(store, cat, month, ensureYearBudget);
      const actual = base.catTotals[cat] || 0;
      const bucket = getScorecardSpendingType(cat, store.categories);
      if (bucket) spendingBreakdown[bucket].budget += budget;
      if (actual > budget) {
        overBudgetCategories.push({
          category: cat,
          actual,
          budget,
          variance: actual - budget
        });
      }
    });
  });
  overBudgetCategories.sort((a, b) => b.variance - a.variance);

  const budgetVariance = base.floorBudget - base.totalSpend;
  const remainingCash = base.totalIncome - base.totalSpend - savings.cashSaved - savings.invested;
  const verdictStatus = budgetVariance >= 0 ? 'positive' : 'negative';
  const verdictSummary = budgetVariance >= 0
    ? `Under budget and saved ${Math.max(remainingCash, 0)}`
    : `Over budget by ${Math.abs(budgetVariance)}`;

  return {
    month,
    monthLabel: `${MONTHS[Number.parseInt(monthKey, 10) - 1]} ${year}`,
    monthShortLabel: `${MONTHS[Number.parseInt(monthKey, 10) - 1]} ${year.slice(2)}`,
    totals: {
      income: base.totalIncome,
      loanInflow: base.totalLoan,
      spent: base.totalSpend,
      budget: base.floorBudget,
      cashSaved: savings.cashSaved,
      invested: savings.invested,
      remainingCash,
      uncategorizedCount: base.uncatCount
    },
    budget: {
      total: base.floorBudget,
      spent: base.totalSpend,
      variance: budgetVariance,
      success: budgetVariance >= 0,
      overBudgetCategories
    },
    spendingBreakdown,
    verdict: {
      status: verdictStatus,
      summary: verdictSummary
    },
    trend: base.trend,
    categoryTotals: base.catTotals,
    merchantTotals: base.merchantTotals
  };
}

function formatMonthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function getPreviousMonth(yearMonth, offset = 1) {
  const [year, month] = yearMonth.split('-').map(value => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, month - 1 - offset, 1));
  return formatMonthKey(date.getUTCFullYear(), date.getUTCMonth());
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function getMonthDate(yearMonth) {
  const [year, month] = yearMonth.split('-').map(value => Number.parseInt(value, 10));
  return new Date(Date.UTC(year, month - 1, 1));
}

function isMonthOnOrBefore(month, limitMonth) {
  return getMonthDate(month).getTime() <= getMonthDate(limitMonth).getTime();
}

function getSavingTransactions(month, options) {
  const { store, excludeCovered } = options;
  const shiftDay = store.salaryShiftDay || 0;
  let txs = store.transactions.filter(tx =>
    !tx.splitInto &&
    getEffectiveMonth(tx, shiftDay) === month &&
    tx.type === 'saving' &&
    tx.amount < 0
  );
  if (excludeCovered) txs = txs.filter(tx => !tx.covered);
  return txs;
}

function getCategoryTransactions(category, month, options) {
  const { store, excludeCovered } = options;
  const shiftDay = store.salaryShiftDay || 0;
  let txs = store.transactions.filter(tx =>
    !tx.splitInto &&
    getEffectiveMonth(tx, shiftDay) === month &&
    tx.type === 'spending' &&
    tx.amount < 0 &&
    tx.category === category
  );
  if (excludeCovered) txs = txs.filter(tx => !tx.covered);
  return txs;
}

export function getCategoryBudgetStatus(category, month, options) {
  const { store, ensureYearBudget } = options;
  const actual = Math.abs(getCategoryTransactions(category, month, options).reduce((sum, tx) => sum + tx.amount, 0));
  const budget = getBudgetForMonth(store, category, month, ensureYearBudget);
  const variance = actual - budget;
  return {
    category,
    month,
    actual,
    budget,
    variance,
    remaining: budget - actual,
    isOverBudget: variance > 0
  };
}

export function getOverspentCategories(month, options) {
  const { store } = options;
  const overspent = [];
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
    cats.forEach(category => {
      const status = getCategoryBudgetStatus(category, month, options);
      if (status.isOverBudget) overspent.push(status);
    });
  });
  return overspent.sort((a, b) => b.variance - a.variance || b.actual - a.actual);
}

export function getCategoryComparisons(category, month, options) {
  const current = getCategoryBudgetStatus(category, month, options);
  const previousMonth = getPreviousMonth(month, 1);
  const previous = getCategoryBudgetStatus(category, previousMonth, options);
  const trailingMonths = [1, 2, 3].map(offset => getPreviousMonth(month, offset));
  const trailingStatuses = trailingMonths.map(previousMonthKey => getCategoryBudgetStatus(category, previousMonthKey, options));
  const averageActual = trailingStatuses.reduce((sum, status) => sum + status.actual, 0) / trailingStatuses.length;

  return {
    category,
    month,
    current,
    budget: {
      amount: current.budget,
      variance: current.variance
    },
    previousMonth: {
      month: previousMonth,
      actual: previous.actual,
      varianceFromCurrent: current.actual - previous.actual
    },
    threeMonthAverage: {
      months: trailingMonths,
      actual: roundCurrency(averageActual),
      varianceFromCurrent: roundCurrency(current.actual - averageActual)
    }
  };
}

export function classifyOverspendPattern(category, month, options) {
  const comparisons = getCategoryComparisons(category, month, options);
  const currentTxs = getCategoryTransactions(category, month, options);
  const overBy = comparisons.current.variance;
  if (overBy <= 0) {
    return { code: 'within-budget', label: 'Within budget' };
  }

  const priorNonZeroMonths = comparisons.threeMonthAverage.months
    .map(previousMonth => getCategoryBudgetStatus(category, previousMonth, options))
    .filter(status => status.actual > 0);

  if (priorNonZeroMonths.length < 2) {
    return { code: 'no-history', label: 'No meaningful history' };
  }

  const largestTx = currentTxs.reduce((max, tx) => Math.max(max, Math.abs(tx.amount)), 0);
  const singleLargeShare = comparisons.current.actual > 0 ? largestTx / comparisons.current.actual : 0;
  if (currentTxs.length <= 2 && singleLargeShare >= 0.6 && comparisons.previousMonth.actual <= comparisons.current.budget) {
    return { code: 'one-off', label: 'One-off event' };
  }

  const recurringOverBudgetMonths = priorNonZeroMonths.filter(status => status.isOverBudget).length;
  if (recurringOverBudgetMonths >= 2 && currentTxs.length >= 2) {
    return { code: 'recurring-habit', label: 'Recurring habit' };
  }

  if (comparisons.current.actual <= comparisons.threeMonthAverage.actual) {
    return { code: 'budget-issue', label: 'Likely budget issue' };
  }

  return { code: 'one-off', label: 'One-off event' };
}

export function getSavingsProgressData(month, options) {
  const { store } = options;
  const savingTxs = getSavingTransactions(month, options);
  const cashSaved = savingTxs
    .filter(tx => tx.category !== 'Investments')
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const invested = savingTxs
    .filter(tx => tx.category === 'Investments')
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const loanInflow = store.transactions
    .filter(tx => !tx.splitInto && getEffectiveMonth(tx, store.salaryShiftDay || 0) === month && tx.type === 'loan')
    .reduce((sum, tx) => sum + tx.amount, 0);

  return {
    month,
    monthly: {
      cashSaved,
      invested,
      total: cashSaved + invested,
      loanInflow
    },
    transactions: savingTxs
  };
}

export function getYtdSavingsProgress(month, options) {
  const { store } = options;
  const targetYear = month.slice(0, 4);
  const months = getUniqueMonths(store.transactions, store.salaryShiftDay || 0)
    .filter(entry => entry.startsWith(`${targetYear}-`) && isMonthOnOrBefore(entry, month));
  const monthly = months.map(entry => getSavingsProgressData(entry, options));
  const ytd = monthly.reduce((acc, item) => {
    acc.cashSaved += item.monthly.cashSaved;
    acc.invested += item.monthly.invested;
    acc.total += item.monthly.total;
    acc.loanInflow += item.monthly.loanInflow;
    return acc;
  }, { cashSaved: 0, invested: 0, total: 0, loanInflow: 0 });

  return {
    month,
    ytd: {
      ...ytd,
      monthCount: months.length
    },
    monthly
  };
}

function averageAmount(transactions) {
  if (transactions.length === 0) return 0;
  return Math.round(transactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) / transactions.length);
}

function hasStableAmounts(transactions, toleranceRatio = 0.25) {
  if (transactions.length === 0) return false;
  const amounts = transactions.map(tx => Math.abs(tx.amount));
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min === 0) return max === 0;
  return (max - min) / min <= toleranceRatio;
}

function parseIsoDate(dateString) {
  const [year, month, day] = dateString.split('-').map(value => Number.parseInt(value, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function monthDiff(a, b) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function isFixedCategory(category, categories) {
  for (const [group, cats] of Object.entries(categories)) {
    if (!cats.includes(category)) continue;
    return FIXED_SCORECARD_GROUPS.has(group);
  }
  return false;
}

function detectCadence(dates) {
  if (dates.length >= 2) {
    const monthGaps = [];
    for (let i = 1; i < dates.length; i++) {
      monthGaps.push(monthDiff(dates[i - 1], dates[i]));
    }
    if (monthGaps.length >= 2 && monthGaps.every(gap => gap >= 1 && gap <= 2)) return 'monthly';
    if (monthGaps.length === 1 && monthGaps[0] >= 11 && monthGaps[0] <= 13) return 'annual';
  }
  return null;
}

function getNextExpectedDate(lastDate, cadence) {
  const next = new Date(lastDate.getTime());
  if (cadence === 'annual') {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return formatIsoDate(next);
}

function isStillActiveRecurring(lastDate, asOf, cadence) {
  const gapMonths = monthDiff(lastDate, asOf);
  if (cadence === 'annual') return gapMonths <= 13;
  return gapMonths <= 2;
}

export function detectRecurringObligations(options) {
  const { store, asOfDate, excludeCovered } = options;
  const shiftDay = store.salaryShiftDay || 0;
  const asOf = parseIsoDate(asOfDate || new Date().toISOString().slice(0, 10));
  const grouped = new Map();

  store.transactions.forEach(tx => {
    if (tx.splitInto || tx.type !== 'spending' || tx.amount >= 0) return;
    if (excludeCovered && tx.covered) return;
    const effectiveMonth = getEffectiveMonth(tx, shiftDay);
    if (getMonthDate(effectiveMonth).getTime() > Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1)) return;
    const key = `${tx.category}::${tx.merchant}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(tx);
  });

  const obligations = [];
  grouped.forEach((transactions, key) => {
    if (transactions.length < 2) return;
    const [category, merchant] = key.split('::');
    const sorted = transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
    const dates = sorted.map(tx => parseIsoDate(tx.date));
    const cadence = detectCadence(dates);
    if (!cadence) return;
    if (!hasStableAmounts(sorted, cadence === 'annual' ? 0.1 : 0.25)) return;
    if (cadence === 'monthly' && sorted.length < 3) return;
    const lastDate = dates[dates.length - 1];
    if (!isStillActiveRecurring(lastDate, asOf, cadence)) return;
    const typicalAmount = averageAmount(sorted);
    obligations.push({
      category,
      merchant,
      cadence,
      fixed: isFixedCategory(category, store.categories),
      typicalAmount,
      nextExpectedDate: getNextExpectedDate(lastDate, cadence),
      lastAmount: Math.abs(sorted[sorted.length - 1].amount),
      transactionCount: sorted.length
    });
  });

  return obligations.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate) || b.typicalAmount - a.typicalAmount);
}

export function getYearlyDashboardData(year, options) {
  const excludeCovered = options.excludeCovered;
  const transactions = options.transactions;
  const budgets = options.budgets;
  const categories = options.categories;
  const loanBudgetMap = options.loanBudget;
  const currentDate = options.currentDate || new Date();
  const shiftDay = options.salaryShiftDay || 0;
  const yb = (budgets && budgets[year]) || {};
  const annualLoanBudget = (loanBudgetMap && loanBudgetMap[year]) || 0;
  const currentYear = currentDate.getFullYear();
  const currentMonthIdx = Number.parseInt(year, 10) === currentYear ? currentDate.getMonth() : 11;
  const catTotals = {};
  const monthData = MONTH_KEYS.map((mk, i) => {
    const ym = `${year}-${mk}`;
    let txs = transactions.filter(tx => !tx.splitInto && getEffectiveMonth(tx, shiftDay) === ym);
    if (excludeCovered) txs = txs.filter(tx => !tx.covered);
    const spend = Math.abs(txs.filter(tx => tx.type === 'spending' && tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));
    const save = Math.abs(txs.filter(tx => tx.type === 'saving' && tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));
    const inc = txs.filter(tx => tx.type === 'income' || (tx.amount > 0 && tx.type !== 'ignore' && tx.type !== 'loan')).reduce((sum, tx) => sum + tx.amount, 0);
    const loan = txs.filter(tx => tx.type === 'loan').reduce((sum, tx) => sum + tx.amount, 0);
    const hasActuals = txs.length > 0;
    if (hasActuals) {
      txs.filter(tx => tx.type === 'spending' && tx.amount < 0).forEach(tx => {
        const cat = tx.category || 'Uncategorized';
        catTotals[cat] = (catTotals[cat] || 0) + Math.abs(tx.amount);
      });
    }
    let budget = 0;
    Object.entries(categories).forEach(([group, cats]) => {
      if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
      cats.forEach(cat => { budget += (yb[cat] && yb[cat][mk]) || 0; });
    });
    const isPast = i <= currentMonthIdx || Number.parseInt(year, 10) < currentYear;
    return { mk, ym, month: MONTHS[i], spend, save, inc, loan, budget, hasActuals, isPast };
  });
  const ytdMonths = monthData.filter(m => m.hasActuals);
  const ytdSpend = ytdMonths.reduce((sum, m) => sum + m.spend, 0);
  const ytdSave = ytdMonths.reduce((sum, m) => sum + m.save, 0);
  const ytdIncome = ytdMonths.reduce((sum, m) => sum + m.inc, 0);
  const ytdLoan = ytdMonths.reduce((sum, m) => sum + m.loan, 0);
  const ytdRemaining = ytdIncome - ytdSpend - ytdSave;
  const annualBudget = monthData.reduce((sum, m) => sum + m.budget, 0);
  const ytdBudget = ytdMonths.reduce((sum, m) => sum + m.budget, 0);
  const futureMonths = monthData.filter(m => !m.hasActuals && m.isPast === false);
  const forecastSpend = ytdSpend + futureMonths.reduce((sum, m) => sum + m.budget, 0);
  const avgMonthlyIncome = ytdMonths.length > 0 ? ytdIncome / ytdMonths.length : 0;
  const forecastIncome = ytdIncome + (futureMonths.length * avgMonthlyIncome);
  const avgMonthlySave = ytdMonths.length > 0 ? ytdSave / ytdMonths.length : 0;
  const forecastSave = ytdSave + (futureMonths.length * avgMonthlySave);
  const monthlyLoanBudget = annualLoanBudget / 12;
  const forecastLoan = ytdLoan + (futureMonths.length * monthlyLoanBudget);
  const forecastRemaining = forecastIncome - forecastSpend - forecastSave;
  const catBudgets = {};
  Object.entries(categories).forEach(([group, cats]) => {
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
    cats.forEach(cat => {
      let total = 0;
      MONTH_KEYS.forEach(mk => { total += (yb[cat] && yb[cat][mk]) || 0; });
      if (total > 0) catBudgets[cat] = total;
    });
  });
  return {
    monthData,
    ytd: { spend: ytdSpend, save: ytdSave, income: ytdIncome, loan: ytdLoan, remaining: ytdRemaining, budget: ytdBudget, monthCount: ytdMonths.length },
    annual: { budget: annualBudget, avgSpend: ytdMonths.length > 0 ? ytdSpend / ytdMonths.length : 0, avgIncome: avgMonthlyIncome },
    forecast: { spend: forecastSpend, income: forecastIncome, save: forecastSave, loan: forecastLoan, remaining: forecastRemaining, futureMonthCount: futureMonths.length },
    catTotals,
    catBudgets,
    annualLoanBudget,
    ytdLoanBudget: monthlyLoanBudget * ytdMonths.length
  };
}
