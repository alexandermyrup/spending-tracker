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
  ensureYearBudget as ensureYearBudgetOnStore,
  normalizeMerchantName
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

  // --- Commit 3: noise / one-off / event annotations on cloned transactions ---
  annotateNoise(store.transactions);
  const cleanTxs = store.transactions.filter(tx => !tx.noise);
  const cleanStore = { ...store, transactions: cleanTxs };
  const cleanDashOptions = {
    store: cleanStore,
    excludeCovered,
    ensureYearBudget: year => ensureYearBudgetOnStore(cleanStore, year),
    currentDate
  };
  const cleanMonthlyData = trailing12.map(month => ({
    month,
    data: getMonthlyDashboardData(month, cleanDashOptions)
  }));

  const cashFlow = buildCashFlow(monthlyData, cleanMonthlyData);
  const categoryTrends = buildCategoryTrends(store, trailing12, monthlyData);
  const budgetAdherence = buildBudgetAdherence(store, currentMonth, trailing12, dashOptions);
  const recurringCommitments = buildRecurringCommitments(store, cashFlow, excludeCovered, asOf);
  const overspendPatterns = buildOverspendPatterns(currentMonth, dashOptions);
  const monthlyVariablePacing = getMonthlyVariableData(currentMonth, dashOptions);
  const weeklyReview = getWeeklyReviewData(currentMonth, dashOptions);

  // One-off classification. Reuses the already-computed recurring obligations.
  const recurringMerchantSet = new Set(
    recurringCommitments.obligations.map(o => normalizeMerchantName(o.merchant))
  );
  const categoryMedians = computeCategoryMedians(cleanTxs);
  store.transactions.forEach(tx => {
    tx.oneOff = tx.noise
      ? false
      : classifyOneOff(tx, store.transactions, categoryMedians, recurringMerchantSet);
  });

  // Event clustering on non-noise transactions.
  const events = clusterEvents(cleanTxs);
  const idToEventTag = {};
  events.forEach(evt => {
    evt.txIds.forEach(id => { idToEventTag[id] = evt.tag; });
  });
  store.transactions.forEach(tx => {
    tx.eventTag = idToEventTag[tx.id] || null;
  });

  // Top 20 one-offs in the last 12 months.
  const twelveMonthsAgo = new Date(currentDate.getTime() - 365 * 24 * 60 * 60 * 1000);
  const oneOffs = store.transactions
    .filter(tx => tx.oneOff && tx.type === 'spending' && tx.amount < 0)
    .filter(tx => parseIsoDateLocal(tx.date) >= twelveMonthsAgo)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 20)
    .map(tx => ({
      id: tx.id,
      date: tx.date,
      merchant: tx.merchant,
      category: tx.category,
      amount: round2(Math.abs(tx.amount))
    }));

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
    oneOffs,
    events,
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

function buildCashFlow(rawMonthlyData, cleanMonthlyData) {
  const monthly = rawMonthlyData.map(({ month, data }) => ({
    month,
    income: round2(data.totalIncome),
    spend: round2(data.totalSpend),
    saving: round2(data.totalSave),
    loan: round2(data.totalLoan),
    net: round2(data.totalIncome - data.totalSpend - data.totalSave)
  }));

  const cleanEntries = cleanMonthlyData.map(({ month, data }) => ({
    month,
    income: round2(data.totalIncome),
    spend: round2(data.totalSpend),
    saving: round2(data.totalSave),
    loan: round2(data.totalLoan),
    net: round2(data.totalIncome - data.totalSpend - data.totalSave)
  }));

  const windows = [1, 3, 6, 12].map(windowSize => {
    const slice = cleanEntries.slice(-windowSize);
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

function parseIsoDateLocal(dateString) {
  const [y, m, d] = String(dateString || '').split('-').map(v => Number.parseInt(v, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function formatMonYy(date) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(2)}`;
}

// ---------- Classifiers ----------

export function detectNoise(tx, allTxs) {
  if (!tx) return false;
  if (tx.noise === true) return true;
  if (/savings account/i.test(tx.merchant || '')) return true;
  const normalized = normalizeMerchantName(tx.merchant);
  if (!normalized) return false;
  const txDate = parseIsoDateLocal(tx.date);
  const txAmount = Math.abs(tx.amount || 0);
  if (txAmount === 0) return false;
  for (const other of allTxs) {
    if (!other || other.id === tx.id) continue;
    if (normalizeMerchantName(other.merchant) !== normalized) continue;
    if (Math.sign(other.amount) === Math.sign(tx.amount)) continue;
    const otherAmount = Math.abs(other.amount || 0);
    if (otherAmount === 0) continue;
    const diffDays = Math.abs((parseIsoDateLocal(other.date) - txDate) / (1000 * 60 * 60 * 24));
    if (diffDays > 7) continue;
    const tolerance = Math.abs(txAmount - otherAmount) / Math.max(txAmount, otherAmount);
    if (tolerance <= 0.02) return true;
  }
  return false;
}

function annotateNoise(txs) {
  txs.forEach(tx => { tx.noise = detectNoise(tx, txs); });
}

function computeCategoryMedians(txs) {
  const byCat = {};
  txs.forEach(tx => {
    if (tx.type !== 'spending' || tx.amount >= 0 || tx.splitInto) return;
    if (!tx.category) return;
    if (!byCat[tx.category]) byCat[tx.category] = [];
    byCat[tx.category].push(Math.abs(tx.amount));
  });
  const medians = {};
  Object.entries(byCat).forEach(([cat, amounts]) => {
    const sorted = amounts.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medians[cat] = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  });
  return medians;
}

export function classifyOneOff(tx, allTxs, categoryMedians, recurringMerchantSet) {
  if (!tx || tx.type !== 'spending' || tx.amount >= 0 || tx.splitInto) return false;
  if (tx.noise) return false;
  const median = categoryMedians && categoryMedians[tx.category];
  if (!median || median <= 0) return false;
  if (Math.abs(tx.amount) <= 3 * median) return false;
  const normalized = normalizeMerchantName(tx.merchant);
  if (recurringMerchantSet && recurringMerchantSet.has(normalized)) return false;
  const txDate = parseIsoDateLocal(tx.date);
  const cutoff = new Date(txDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  for (const other of allTxs) {
    if (!other || other.id === tx.id) continue;
    if (normalizeMerchantName(other.merchant) !== normalized) continue;
    const otherDate = parseIsoDateLocal(other.date);
    if (otherDate >= cutoff && otherDate < txDate) return false;
  }
  return true;
}

export function clusterEvents(txs) {
  const sorted = (txs || [])
    .filter(tx => tx && tx.type === 'spending' && tx.amount < 0 && !tx.splitInto)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const events = [];
  const used = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].id)) continue;
    const windowStart = parseIsoDateLocal(sorted[i].date);
    const windowEnd = new Date(windowStart.getTime() + 4 * 24 * 60 * 60 * 1000); // 5-day inclusive

    const windowTxs = [];
    for (let j = i; j < sorted.length; j++) {
      if (used.has(sorted[j].id)) continue;
      const d = parseIsoDateLocal(sorted[j].date);
      if (d.getTime() > windowEnd.getTime()) break;
      windowTxs.push(sorted[j]);
    }

    const travelCount = windowTxs.filter(tx => tx.category === 'Travel').length;
    const hasTravel = windowTxs.some(tx => tx.category === 'Travel');
    const hasEatingOut = windowTxs.some(tx => tx.category === 'Eating out');
    const hasTransport = windowTxs.some(tx => tx.category === 'Transport');
    const hasTriad = hasTravel && hasEatingOut && hasTransport;

    if (travelCount >= 2 || hasTriad) {
      const breakdown = {};
      const txIds = [];
      let total = 0;
      let lastDate = sorted[i].date;
      windowTxs.forEach(tx => {
        const key = tx.category || 'Uncategorized';
        breakdown[key] = round2((breakdown[key] || 0) + Math.abs(tx.amount));
        total += Math.abs(tx.amount);
        txIds.push(tx.id);
        used.add(tx.id);
        if (tx.date > lastDate) lastDate = tx.date;
      });

      const travelTx = windowTxs.find(tx => tx.category === 'Travel');
      const monYy = formatMonYy(windowStart);
      let tag;
      if (travelTx) {
        const token = String(travelTx.merchant || '').split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        tag = token ? `${token}-${monYy}` : `event-${monYy}-${events.length + 1}`;
      } else {
        tag = `event-${monYy}-${events.length + 1}`;
      }

      events.push({
        tag,
        dateRange: { start: sorted[i].date, end: lastDate },
        total: round2(total),
        breakdown,
        txIds
      });
    }
  }
  return events;
}
