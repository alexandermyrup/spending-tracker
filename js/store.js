import { buildSpendingInsights } from './export-insights.js';

export const STORAGE_KEY = 'spending-tracker-v2';
export const STORE_VERSION = 5;
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
export const CHART_COLORS = ['#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#4f46e5','#c026d3','#d97706','#059669','#6366f1','#e11d48'];

export const DEFAULT_CATEGORIES = {
  'Fixed costs': ['Rent','Utilities','Transport','Phone','Internet','Gym'],
  'Subscriptions': ['Streaming','Music','Cloud storage','Software'],
  'Insurance': ['Health insurance','Home insurance','Car insurance'],
  'Variable': ['Groceries','Eating out','Nightlife','Travel','Clothing','Haircut','Healthcare','Gifts','Home','Entertainment','Other'],
  'Savings': ['Savings','Investments'],
  'Income': ['Salary','Side income','Reimbursement','Interest','Other income']
};

export const SPENDING_GROUPS = ['Fixed costs','Subscriptions','Insurance','Variable'];
export const INCOME_GROUP = 'Income';
export const SAVINGS_GROUP = 'Savings';

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getDefaultYearBudget() {
  const b = {};
  const allCats = [];
  Object.values(DEFAULT_CATEGORIES).forEach(cats => allCats.push(...cats));
  allCats.forEach(cat => {
    b[cat] = {};
    MONTH_KEYS.forEach(m => { b[cat][m] = 0; });
  });
  return b;
}

export function normalizeMerchantName(name) {
  return String(name || '')
    .replace(/[*\-_.,;:/\\|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function createEmptyStore() {
  return {
    version: STORE_VERSION,
    transactions: [],
    categories: deepClone(DEFAULT_CATEGORIES),
    budgets: { [String(new Date().getFullYear())]: getDefaultYearBudget() },
    merchantMap: {},
    loanBudget: {},
    deletedCategories: [],
    categoryAliases: {},
    nextId: 1,
    salaryShiftDay: 0
  };
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

export function resolveCategory(name, store) {
  if (!name) return '';
  if (store.categoryAliases && store.categoryAliases[name]) {
    const resolved = store.categoryAliases[name];
    if (store.deletedCategories && store.deletedCategories.includes(resolved)) return '';
    return resolved;
  }
  if (store.deletedCategories && store.deletedCategories.includes(name)) return '';
  return name;
}

export function registerCategory(name, type, store) {
  if (!name) return;
  for (const cats of Object.values(store.categories)) {
    if (cats.includes(name)) return;
  }
  const group = type === 'income' ? INCOME_GROUP : type === 'saving' ? SAVINGS_GROUP : 'Variable';
  if (!store.categories[group]) store.categories[group] = [];
  store.categories[group].push(name);
  ensureCategoryBudgetEntry(store.budgets, name);
}

export function applyBudgetSideEffect(budgets, year, cat, month, value) {
  if (cat === 'Part-time job') {
    if (!budgets[year]['Feriepenge']) {
      budgets[year]['Feriepenge'] = {};
      MONTH_KEYS.forEach(m => { budgets[year]['Feriepenge'][m] = 0; });
    }
    budgets[year]['Feriepenge'][month] = Math.round((Number.parseFloat(value) || 0) * 0.125);
  }
}

export function ensureCategoryBudgetEntry(budgets, cat) {
  Object.keys(budgets || {}).forEach(year => {
    if (!budgets[year][cat]) {
      budgets[year][cat] = {};
      MONTH_KEYS.forEach(m => { budgets[year][cat][m] = 0; });
    }
  });
}

export function normalizeStore(rawStore) {
  const base = createEmptyStore();
  const normalized = {
    ...base,
    ...(rawStore || {})
  };

  normalized.version = STORE_VERSION;
  normalized.transactions = Array.isArray(normalized.transactions) ? normalized.transactions.map(tx => ({ ...tx })) : [];
  normalized.categories = normalized.categories && typeof normalized.categories === 'object'
    ? normalized.categories
    : deepClone(DEFAULT_CATEGORIES);
  normalized.budgets = normalized.budgets && typeof normalized.budgets === 'object'
    ? normalized.budgets
    : {};
  normalized.merchantMap = normalized.merchantMap && typeof normalized.merchantMap === 'object'
    ? normalized.merchantMap
    : {};
  normalized.loanBudget = normalized.loanBudget && typeof normalized.loanBudget === 'object'
    ? normalized.loanBudget
    : {};
  normalized.salaryShiftDay = Number.parseInt(normalized.salaryShiftDay, 10) || 0;

  normalized.deletedCategories = Array.isArray(normalized.deletedCategories) ? normalized.deletedCategories : [];
  normalized.categoryAliases = normalized.categoryAliases && typeof normalized.categoryAliases === 'object'
    ? normalized.categoryAliases
    : {};
  Object.entries(DEFAULT_CATEGORIES).forEach(([group, cats]) => {
    if (!Array.isArray(normalized.categories[group])) normalized.categories[group] = [];
    cats.forEach(cat => {
      if (!normalized.categories[group].includes(cat) && !normalized.deletedCategories.includes(cat)) {
        normalized.categories[group].push(cat);
      }
    });
  });

  const yearKeys = new Set(Object.keys(normalized.budgets));
  if (yearKeys.size === 0) yearKeys.add(String(new Date().getFullYear()));
  yearKeys.forEach(year => {
    if (!normalized.budgets[year]) normalized.budgets[year] = {};
  });

  Object.values(normalized.categories).forEach(cats => {
    cats.forEach(cat => ensureCategoryBudgetEntry(normalized.budgets, cat));
  });

  // Sanitize budget values: coerce strings to numbers and strip invalid month keys
  const validMonths = new Set(MONTH_KEYS);
  Object.values(normalized.budgets).forEach(yearBudget => {
    Object.keys(yearBudget).forEach(cat => {
      if (typeof yearBudget[cat] === 'object' && yearBudget[cat] !== null) {
        const cleaned = {};
        MONTH_KEYS.forEach(m => {
          cleaned[m] = Number(yearBudget[cat][m]) || 0;
        });
        yearBudget[cat] = cleaned;
      }
    });
  });

  const normalizedMap = {};
  Object.entries(normalized.merchantMap).forEach(([key, value]) => {
    normalizedMap[normalizeMerchantName(key)] = value;
  });
  normalized.merchantMap = normalizedMap;

  let maxId = 0;
  normalized.transactions.forEach(tx => {
    tx.id = Number.parseInt(tx.id, 10) || 0;
    maxId = Math.max(maxId, tx.id);
    if (tx.covered === undefined) tx.covered = false;
    if (!tx.type) tx.type = tx.amount > 0 ? 'income' : 'spending';
    if (!tx.category) tx.category = '';
  });
  normalized.nextId = maxId + 1 || 1;

  if (Object.keys(normalized.budgets).length === 0) {
    normalized.budgets[String(new Date().getFullYear())] = getDefaultYearBudget();
  }

  return normalized;
}

export function loadStore(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return normalizeStore(raw ? JSON.parse(raw) : null);
  } catch (error) {
    console.error('Load error', error);
    return normalizeStore(null);
  }
}

export function saveStore(store, storage = window.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeStore(store)));
  } catch (error) {
    console.error('Save error', error);
  }
}

export function exportPayload(store, options = {}) {
  const normalized = normalizeStore(store);
  return {
    ...normalized,
    spendingInsights: buildSpendingInsights(normalized, options)
  };
}

export function ensureYearBudget(store, year) {
  if (!store.budgets[year]) {
    const prevYear = String(Number.parseInt(year, 10) - 1);
    store.budgets[year] = store.budgets[prevYear]
      ? deepClone(store.budgets[prevYear])
      : getDefaultYearBudget();
  }
  Object.values(store.categories).forEach(cats => {
    cats.forEach(cat => ensureCategoryBudgetEntry(store.budgets, cat));
  });
}
