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
