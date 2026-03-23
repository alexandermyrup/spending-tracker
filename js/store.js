export const STORAGE_KEY = 'spending-tracker-v2';
export const STORE_VERSION = 3;
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONTH_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
export const CHART_COLORS = ['#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#4f46e5','#c026d3','#d97706','#059669','#6366f1','#e11d48'];

export const DEFAULT_CATEGORIES = {
  'Fixed costs': ['Rent + utilities','Transport','Mobile','Internet','Contacts','Macbook payment','Gym','KAB venteliste'],
  'Subscriptions': ['OpenAI','iCloud','F1TV','EA Play Pro','M365','Google','WHOOP'],
  'Insurance': ['Hövding forsikring','Accident insurance','Sygesikring Danmark'],
  'Variable': ['Groceries','Eating out','Nightlife','Travel','Skincare','Vitamins','Pharmacy','Toiletries','Clothes','Laundry','Haircut','Tandlæge','Gift cost','Transfer out','Home','Fun','Other'],
  'Savings': ['Pension','Investments'],
  'Income': ['SU','Part-time job','Feriepenge','Reimbursement','Interest','Other income']
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
    nextId: 1,
    salaryShiftDay: 0
  };
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

export function exportPayload(store) {
  return normalizeStore(store);
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
