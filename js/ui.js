import {
  CHART_COLORS,
  DEFAULT_CATEGORIES,
  INCOME_GROUP,
  MONTH_KEYS,
  MONTHS,
  SAVINGS_GROUP,
  ensureYearBudget,
  exportPayload,
  loadStore,
  normalizeMerchantName,
  normalizeStore,
  saveStore
} from './store.js';
import {
  MERCHANT_PATTERNS,
  autoMatchMerchant,
  certaintyBand,
  computeCategoryCertainty,
  computeMerchantStats,
  detectConflicts,
  detectRecurringMerchants,
  getFilteredTransactions,
  parseNordeaCSV,
  resolveMerchant,
  sanitizeTransactions,
  txFingerprint
} from './transactions.js';
import {
  classifyOverspendPattern,
  detectRecurringObligations,
  getEarliestMonthForDashboard,
  getCategoryComparisons,
  getBudgetForMonth,
  getEffectiveMonth,
  getLastCompletedMonth,
  getMonthRange,
  getMonthlyScorecardData,
  getSavingsProgressData,
  getOverspentCategories,
  getRecentMonths,
  getUniqueMonths,
  getYtdSavingsProgress,
  getYearlyDashboardData
} from './dashboard.js';

const APP_VERSION = 'v0.2';
const APP_VERSION_METADATA_URL = './version.json';

const SECTION_TITLES = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  import: 'Import CSV',
  budgets: 'Budgets',
  categories: 'Categories'
};

let store = loadStore();
let pendingImport = [];
let lastImportedIds = [];
let splitTxId = null;
let budgetEventsBound = false;
let modalTriggerEl = null;

function getStore() {
  return store;
}

function setStore(nextStore) {
  store = normalizeStore(nextStore);
}

function persistStore() {
  saveStore(store);
}

function fmt(n) {
  return new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: 'DKK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(n);
}

function fmtShort(n) {
  return new Intl.NumberFormat('da-DK').format(n);
}

function getNextMonthDateString(yearMonth) {
  const [year, month] = yearMonth.split('-').map(value => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 3000);
}

async function renderAppVersion() {
  const badge = document.getElementById('app-version-badge');
  if (!badge) return;
  badge.textContent = APP_VERSION;
  try {
    const response = await fetch(APP_VERSION_METADATA_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const metadata = await response.json();
    const version = metadata?.version || APP_VERSION;
    const build = String(metadata?.build || '').slice(0, 7);
    badge.textContent = build ? `${version}.${build}` : version;
  } catch {
    // Keep the base version if the network request fails.
  }
}

function rerenderAll() {
  populateFilters();
  renderDashboard();
  renderTransactions();
  renderBudgetEditor();
  renderCategoryManager();
}

function commit(message, renderMode = 'all') {
  derivedCacheVersion++;
  persistStore();
  if (renderMode === 'all') rerenderAll();
  else if (renderMode === 'transactions') renderTransactions();
  else if (renderMode === 'dashboard') {
    renderDashboard();
    renderBudgetEditor();
  } else if (renderMode === 'budget') {
    renderDashboard();
    const focused = document.activeElement;
    const focusCat = focused?.getAttribute('data-cat');
    const focusMonth = focused?.getAttribute('data-month');
    renderBudgetEditor();
    if (focusCat && focusMonth) {
      const next = document.querySelector(`input[data-cat="${focusCat}"][data-month="${focusMonth}"]`);
      if (next) { next.focus(); next.select(); }
    }
  }
  if (message) toast(message);
}

let derivedCache = null;
let derivedCacheVersion = 0;
let derivedCacheComputedAt = -1;

function getDerivedClassification() {
  if (derivedCache && derivedCacheComputedAt === derivedCacheVersion) return derivedCache;
  const merchantStats = computeMerchantStats(store.transactions);
  const recurring = detectRecurringMerchants(merchantStats);
  const conflicts = detectConflicts(merchantStats);
  derivedCache = { merchantStats, recurring, conflicts };
  derivedCacheComputedAt = derivedCacheVersion;
  return derivedCache;
}

function getImportPreviewMeta(rows) {
  const existing = new Set(store.transactions.map(txFingerprint));
  const duplicates = rows.filter(row => existing.has(txFingerprint(row)));
  const fresh = rows.filter(row => !existing.has(txFingerprint(row)));
  const ignored = fresh.filter(row => {
    const suggestion = autoMatchMerchant(row.merchant, row.amount, store);
    return suggestion && suggestion.type === 'ignore';
  });
  const suggested = fresh.filter(row => {
    const suggestion = autoMatchMerchant(row.merchant, row.amount, store);
    return suggestion && suggestion.category;
  });
  const uncategorized = fresh.length - suggested.length - ignored.length;
  return { fresh, duplicates, ignored, suggested, uncategorized };
}

function getReviewMode() {
  return document.getElementById('tx-review-mode')?.value || 'all';
}

function getVisibleTransactions(baseFiltered, derived) {
  const reviewMode = getReviewMode();
  let displayTxs = baseFiltered;
  if (reviewMode === 'uncategorized') {
    displayTxs = displayTxs.filter(tx => !tx.category && tx.type !== 'ignore');
  } else if (reviewMode === 'low-certainty') {
    displayTxs = displayTxs.filter(tx => {
      if (tx.type === 'ignore' || !tx.category) return false;
      const suggestion = autoMatchMerchant(tx.merchant, tx.amount, store);
      if (!suggestion || !suggestion.category) return false;
      const certainty = computeCategoryCertainty(tx, suggestion, derived.merchantStats, derived.recurring, store);
      return certainty < 0.4;
    });
  } else if (reviewMode === 'conflicts') {
    displayTxs = displayTxs.filter(tx => !!derived.conflicts[normalizeMerchantName(tx.merchant)]);
  } else if (reviewMode === 'recent-imports') {
    const recent = new Set(lastImportedIds);
    displayTxs = displayTxs.filter(tx => recent.has(tx.id));
  }

  if (reviewMode === 'uncategorized') {
    displayTxs = displayTxs.slice().sort((a, b) => {
      const aSuggestion = autoMatchMerchant(a.merchant, a.amount, store);
      const bSuggestion = autoMatchMerchant(b.merchant, b.amount, store);
      const aCert = aSuggestion && aSuggestion.category ? computeCategoryCertainty(a, aSuggestion, derived.merchantStats, derived.recurring, store) : -1;
      const bCert = bSuggestion && bSuggestion.category ? computeCategoryCertainty(b, bSuggestion, derived.merchantStats, derived.recurring, store) : -1;
      if (aCert !== bCert) return bCert - aCert;
      return b.date.localeCompare(a.date) || b.id - a.id;
    });
  }
  return displayTxs;
}

function renderImportPreview() {
  const preview = document.getElementById('import-preview');
  const countEl = document.getElementById('import-count');
  const metaEl = document.getElementById('import-meta');
  const tbody = document.getElementById('import-body');
  if (!preview || !countEl || !metaEl || !tbody) return;
  if (pendingImport.length === 0) {
    preview.classList.add('hidden');
    toast('No new transactions found.');
    return;
  }
  preview.classList.remove('hidden');
  const stats = getImportPreviewMeta(pendingImport);
  countEl.textContent = `${stats.fresh.length} new transaction${stats.fresh.length !== 1 ? 's' : ''}`;
  metaEl.innerHTML = `
    <span>${stats.duplicates.length} duplicates skipped</span>
    <span>${stats.ignored.length} auto-ignored</span>
    <span>${stats.suggested.length} suggested</span>
    <span>${stats.uncategorized} uncategorized</span>
  `;
  tbody.innerHTML = stats.fresh.map(tx => {
    const autocat = autoMatchMerchant(tx.merchant, tx.amount, store);
    return `<tr class="hover:bg-slate-50/50">
      <td class="py-2.5 px-3 tabular-nums">${tx.pending ? '<em class="text-slate-500">Pending</em>' : tx.date}</td>
      <td class="py-2.5 px-3 font-medium">${esc(tx.merchant)}</td>
      <td class="py-2.5 px-3 text-slate-500">${esc(tx.description)}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-medium ${tx.amount < 0 ? 'text-red-500' : 'text-emerald-600'}">${fmt(tx.amount)}</td>
      <td class="py-2.5 px-3">${autocat && autocat.category
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-600">${esc(autocat.category)} ?</span>`
        : autocat && autocat.type === 'ignore'
          ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-600">Ignore</span>'
          : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-600">?</span>'}</td>
    </tr>`;
  }).join('');
}

function handleCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    pendingImport = parseNordeaCSV(ev.target.result);
    renderImportPreview();
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

function confirmImport() {
  const freshRows = getImportPreviewMeta(pendingImport).fresh;
  const merchantStats = computeMerchantStats(store.transactions);
  const recurring = detectRecurringMerchants(merchantStats);
  let autoCount = 0;
  const importedIds = [];
  freshRows.forEach(tx => {
    const autocat = autoMatchMerchant(tx.merchant, tx.amount, store);
    let assignedCategory = '';
    let wasAutoAssigned = false;
    if (autocat && autocat.category) {
      const key = normalizeMerchantName(tx.merchant);
      const stats = merchantStats[key];
      if (recurring[key] && stats && stats.primaryCategoryCount >= 3 && stats.primaryCategory === autocat.category) {
        assignedCategory = autocat.category;
        wasAutoAssigned = true;
        autoCount++;
      }
    }
    const id = store.nextId++;
    importedIds.push(id);
    store.transactions.push({
      id,
      date: tx.date,
      amount: tx.amount,
      merchant: tx.merchant,
      description: tx.description,
      balance: tx.balance,
      pending: tx.pending,
      category: assignedCategory,
      manualCategory: wasAutoAssigned,
      type: autocat ? autocat.type : (tx.amount > 0 ? 'income' : 'spending'),
      covered: false
    });
  });
  store.transactions.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  pendingImport = [];
  lastImportedIds = importedIds;
  document.getElementById('import-preview')?.classList.add('hidden');
  commit(`Imported ${freshRows.length} transaction${freshRows.length !== 1 ? 's' : ''}.${autoCount > 0 ? ` ${autoCount} auto-categorized.` : ''}`);
}

function cancelImport() {
  pendingImport = [];
  document.getElementById('import-preview')?.classList.add('hidden');
}

function setTxType(id, type) {
  const tx = store.transactions.find(t => t.id === id);
  if (!tx) return;
  tx.type = type;
  if (tx.category && store.merchantMap[normalizeMerchantName(tx.merchant)]) {
    store.merchantMap[normalizeMerchantName(tx.merchant)].type = type;
  }
  commit(null);
}

function toggleCovered(id) {
  const tx = store.transactions.find(t => t.id === id);
  if (!tx) return;
  tx.covered = !tx.covered;
  commit(null);
}

function restoreSplit(parentId) {
  const parent = store.transactions.find(tx => tx.id === parentId);
  if (!parent || !parent.splitInto) return;
  store.transactions = store.transactions.filter(tx => tx.id === parentId || tx.splitFrom !== parentId);
  delete parent.splitInto;
  parent.type = parent.amount > 0 ? 'income' : 'spending';
  parent.category = '';
  parent.manualCategory = false;
  commit('Split transaction restored.');
}

function deleteTx(id) {
  const tx = store.transactions.find(t => t.id === id);
  if (!tx) return;
  if (!window.confirm(`Delete "${tx.merchant}" (${fmt(tx.amount)}) on ${tx.date}?`)) return;
  if (tx.splitInto) {
    tx.splitInto.forEach(cid => {
      store.transactions = store.transactions.filter(t => t.id !== cid);
    });
  }
  if (tx.splitFrom) {
    const parent = store.transactions.find(t => t.id === tx.splitFrom);
    if (parent && parent.splitInto) {
      parent.splitInto = parent.splitInto.filter(cid => cid !== id);
      if (parent.splitInto.length === 0) {
        delete parent.splitInto;
        parent.type = parent.amount > 0 ? 'income' : 'spending';
        parent.category = '';
      } else if (parent.splitInto.length === 1) {
        const remaining = store.transactions.find(t => parent.splitInto.includes(t.id));
        if (remaining) {
          parent.category = remaining.category || '';
          parent.type = remaining.type || (parent.amount > 0 ? 'income' : 'spending');
          parent.manualCategory = remaining.manualCategory || false;
          store.transactions = store.transactions.filter(t => t.id !== remaining.id);
        }
        delete parent.splitInto;
      }
    }
  }
  store.transactions = store.transactions.filter(t => t.id !== id);
  commit('Transaction deleted.');
}

function clearAllTransactions() {
  if (!window.confirm(`Delete ALL ${store.transactions.length} transactions? This cannot be undone.`)) return;
  if (!window.confirm('Are you really sure? Export a JSON backup first if needed.')) return;
  store.transactions = [];
  store.merchantMap = {};
  store.nextId = 1;
  lastImportedIds = [];
  commit('All transactions cleared.');
}

function closeCatDropdowns() {
  document.querySelectorAll('.cat-dropdown').forEach(el => el.remove());
}

function createAndSelectInGroup(txId, name, group) {
  if (!name || !group) return;
  if (!store.categories[group]) store.categories[group] = [];
  if (!store.categories[group].includes(name)) {
    store.categories[group].push(name);
    Object.keys(store.budgets).forEach(year => {
      if (!store.budgets[year][name]) {
        store.budgets[year][name] = {};
        MONTH_KEYS.forEach(m => { store.budgets[year][name][m] = 0; });
      }
    });
  }
  selectCategory(txId, name);
}

function filterCatOptions(input) {
  const val = input.value.toLowerCase();
  const dd = input.closest('.cat-dropdown');
  dd.querySelectorAll('.cat-option.kb-focus').forEach(el => el.classList.remove('kb-focus'));
  let exactMatch = false;
  dd.querySelectorAll('.cat-option').forEach(el => {
    const catText = el.textContent.toLowerCase().replace('remove category', '').trim();
    const match = catText.includes(val);
    el.style.display = match ? '' : 'none';
    if (catText === val) exactMatch = true;
  });
  dd.querySelectorAll('.cat-group-header').forEach(el => {
    let next = el.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('cat-group-header') && !next.classList.contains('cat-new')) {
      if (next.style.display !== 'none') hasVisible = true;
      next = next.nextElementSibling;
    }
    el.style.display = hasVisible ? '' : 'none';
  });
  const newOpt = dd.querySelector('#cat-new-option');
  if (val && !exactMatch) {
    newOpt.style.display = '';
    newOpt.querySelector('span').textContent = input.value;
  } else {
    newOpt.style.display = 'none';
  }
  const picker = dd.querySelector('.cat-new-group-picker');
  if (picker) picker.style.display = 'none';
}

function selectCategory(txId, category) {
  const tx = store.transactions.find(t => t.id === txId);
  if (!tx) return;
  tx.category = category;
  tx.manualCategory = !!category;
  if (category) {
    store.merchantMap[normalizeMerchantName(tx.merchant)] = { category, type: tx.type };
  } else {
    delete store.merchantMap[normalizeMerchantName(tx.merchant)];
    tx.manualCategory = false;
  }
  closeCatDropdowns();
  commit(null);
}

function openCatDropdown(event, txId) {
  event.stopPropagation();
  closeCatDropdowns();
  const tx = store.transactions.find(t => t.id === txId);
  if (!tx) return;
  const isIncome = tx.amount > 0;
  const wrap = event.target.closest('.cat-select-wrap');
  const dd = document.createElement('div');
  dd.className = 'cat-dropdown open';
  let html = '<input type="text" placeholder="Search or create..." autofocus>';
  if (tx.category) {
    html += '<div class="cat-option" data-cat="" style="color:rgb(239 68 68);font-weight:500;border-bottom:1px solid rgb(226 232 240)">Remove category</div>';
  }
  if (isIncome) {
    html += '<div class="cat-group-header">Income</div>';
    (store.categories[INCOME_GROUP] || []).forEach(c => {
      html += `<div class="cat-option" data-cat="${esc(c)}">${esc(c)}</div>`;
    });
  } else {
    Object.entries(store.categories).forEach(([group, cats]) => {
      if (group === INCOME_GROUP) return;
      html += `<div class="cat-group-header">${esc(group)}</div>`;
      cats.forEach(c => { html += `<div class="cat-option" data-cat="${esc(c)}">${esc(c)}</div>`; });
    });
  }
  const validGroups = isIncome ? [INCOME_GROUP] : Object.keys(store.categories).filter(g => g !== INCOME_GROUP);
  html += `<div class="cat-new" id="cat-new-option" style="display:none" data-default-group="${esc(validGroups.length === 1 ? validGroups[0] : '')}">+ Create "<span></span>"</div>`;
  html += `<div class="cat-new-group-picker" style="display:none;padding:6px 8px;border-top:1px solid rgb(226 232 240)">
    <div style="font-size:11px;color:rgb(100 116 139);margin-bottom:4px;font-weight:500">Add to group:</div>
    ${validGroups.map(g => `<div class="cat-group-pick" data-group="${esc(g)}" style="padding:3px 8px;border-radius:6px;font-size:12px;cursor:pointer;margin-bottom:2px">${esc(g)}</div>`).join('')}
  </div>`;
  dd.innerHTML = html;
  dd.setAttribute('role', 'listbox');
  dd.querySelectorAll('.cat-option').forEach(el => el.setAttribute('role', 'option'));
  const input = dd.querySelector('input');
  input.addEventListener('input', () => filterCatOptions(input));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      closeCatDropdowns();
      return;
    }
    const visibleOptions = [...dd.querySelectorAll('.cat-option')].filter(el => el.style.display !== 'none');
    if (visibleOptions.length === 0) return;
    const focused = dd.querySelector('.cat-option.kb-focus');
    let idx = focused ? visibleOptions.indexOf(focused) : -1;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (focused) focused.classList.remove('kb-focus');
      idx = idx < visibleOptions.length - 1 ? idx + 1 : 0;
      visibleOptions[idx].classList.add('kb-focus');
      visibleOptions[idx].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (focused) focused.classList.remove('kb-focus');
      idx = idx > 0 ? idx - 1 : visibleOptions.length - 1;
      visibleOptions[idx].classList.add('kb-focus');
      visibleOptions[idx].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && focused) {
      ev.preventDefault();
      focused.click();
    }
  });
  dd.addEventListener('click', ev => {
    ev.stopPropagation();
    const opt = ev.target.closest('.cat-option');
    if (opt) {
      selectCategory(txId, opt.getAttribute('data-cat'));
      return;
    }
    const newOpt = ev.target.closest('.cat-new');
    if (newOpt && newOpt.style.display !== 'none') {
      const defaultGroup = newOpt.getAttribute('data-default-group');
      const name = newOpt.querySelector('span').textContent.trim();
      if (defaultGroup && name) {
        createAndSelectInGroup(txId, name, defaultGroup);
        return;
      }
      const picker = dd.querySelector('.cat-new-group-picker');
      if (picker) {
        picker.style.display = '';
        newOpt.style.display = 'none';
      }
      return;
    }
    const groupPick = ev.target.closest('.cat-group-pick');
    if (groupPick) {
      const group = groupPick.getAttribute('data-group');
      const name = dd.querySelector('#cat-new-option span')?.textContent.trim();
      if (name) createAndSelectInGroup(txId, name, group);
    }
  });
  wrap.appendChild(dd);
  input.focus();
}

function openSplitModal(txId) {
  const tx = store.transactions.find(t => t.id === txId);
  if (!tx) return;
  modalTriggerEl = document.activeElement;
  splitTxId = txId;
  document.getElementById('split-original').innerHTML = `<strong>${esc(tx.merchant)}</strong> on ${tx.date} for <strong>${fmt(tx.amount)}</strong>`;
  const partsEl = document.getElementById('split-parts');
  partsEl.innerHTML = '';
  addSplitPartRow(partsEl, tx.amount, tx.category || '', tx.type);
  addSplitPartRow(partsEl, 0, '', tx.amount > 0 ? 'income' : 'spending');
  updateSplitRemainder();
  document.getElementById('modal-split').classList.add('open');
}

function addSplitPart() {
  const tx = store.transactions.find(t => t.id === splitTxId);
  if (!tx) return;
  addSplitPartRow(document.getElementById('split-parts'), 0, '', tx.amount > 0 ? 'income' : 'spending');
}

function addSplitPartRow(container, amount, category, type) {
  const tx = store.transactions.find(t => t.id === splitTxId);
  const isPositive = tx && tx.amount > 0;
  const row = document.createElement('div');
  row.className = 'grid grid-cols-[1fr_100px_120px_auto] gap-2 items-end p-3 border border-slate-200/80 rounded-lg';
  row.innerHTML = `
    <div>
      <label class="block text-xs font-medium text-slate-500 mb-1">Label / Category</label>
      <input type="text" class="split-cat w-full px-2.5 py-2 rounded-md border border-slate-200/80 text-sm focus:outline-none focus:border-blue-500" value="${esc(category)}" placeholder="e.g. SU (grant)">
    </div>
    <div>
      <label class="block text-xs font-medium text-slate-500 mb-1">Amount</label>
      <input type="number" class="split-amt w-full px-2.5 py-2 rounded-md border border-slate-200/80 text-sm tabular-nums focus:outline-none focus:border-blue-500" value="${Math.abs(amount)}" step="0.01" min="0">
    </div>
    <div>
      <label class="block text-xs font-medium text-slate-500 mb-1">Type</label>
      <select class="split-type w-full px-2.5 py-2 rounded-md border border-slate-200/80 text-sm focus:outline-none focus:border-blue-500">
        ${isPositive ? `
          <option value="income" ${type === 'income' ? 'selected' : ''}>Income</option>
          <option value="loan" ${type === 'loan' ? 'selected' : ''}>Loan inflow</option>
        ` : `
          <option value="spending" ${type === 'spending' ? 'selected' : ''}>Spending</option>
          <option value="saving" ${type === 'saving' ? 'selected' : ''}>Saving</option>
        `}
        <option value="ignore" ${type === 'ignore' ? 'selected' : ''}>Ignore</option>
      </select>
    </div>
    <button class="remove-part self-end p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors text-lg leading-none" type="button">&times;</button>
  `;
  row.querySelector('.split-amt').addEventListener('input', updateSplitRemainder);
  row.querySelector('.remove-part').addEventListener('click', () => {
    row.remove();
    updateSplitRemainder();
  });
  container.appendChild(row);
}

function updateSplitRemainder() {
  const tx = store.transactions.find(t => t.id === splitTxId);
  if (!tx) return;
  const total = Math.abs(tx.amount);
  let allocated = 0;
  document.querySelectorAll('#split-parts .split-amt').forEach(inp => {
    allocated += Number.parseFloat(inp.value) || 0;
  });
  const remainder = total - allocated;
  const el = document.getElementById('split-remainder');
  const btn = document.getElementById('split-confirm-btn');
  if (Math.abs(remainder) < 0.01) {
    el.innerHTML = '<span class="text-emerald-600">Fully allocated</span>';
    btn.disabled = false;
  } else {
    el.innerHTML = `<span class="text-amber-600">Remainder: ${fmt(tx.amount > 0 ? remainder : -remainder)}</span>`;
    btn.disabled = Math.abs(remainder) > 0.01;
  }
}

function confirmSplit() {
  const tx = store.transactions.find(t => t.id === splitTxId);
  if (!tx) return;
  const parts = document.querySelectorAll('#split-parts > div');
  if (parts.length < 2) {
    toast('Need at least 2 parts.');
    return;
  }
  let allocated = 0;
  parts.forEach(part => {
    allocated += Number.parseFloat(part.querySelector('.split-amt').value) || 0;
  });
  if (Math.abs(Math.abs(tx.amount) - allocated) > 0.01) {
    toast('Amounts must add up to original.');
    return;
  }
  const sign = tx.amount > 0 ? 1 : -1;
  const childIds = [];
  parts.forEach(part => {
    const cat = part.querySelector('.split-cat').value.trim();
    const amt = (Number.parseFloat(part.querySelector('.split-amt').value) || 0) * sign;
    const type = part.querySelector('.split-type').value;
    const childId = store.nextId++;
    childIds.push(childId);
    store.transactions.push({
      id: childId,
      date: tx.date,
      amount: amt,
      merchant: tx.merchant,
      description: tx.description,
      balance: tx.balance,
      pending: tx.pending,
      category: cat,
      type,
      covered: tx.covered,
      splitFrom: tx.id
    });
  });
  tx.splitInto = childIds;
  tx.type = 'ignore';
  store.transactions.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  closeModal('modal-split');
  splitTxId = null;
  commit(`Split into ${childIds.length} parts.`);
}

function getConflictBannerHtml(conflicts) {
  const entries = Object.entries(conflicts);
  if (entries.length === 0) return '';
  return `<details class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm mb-4">
    <summary class="cursor-pointer font-medium text-red-600">${entries.length} merchant${entries.length !== 1 ? 's' : ''} with conflicting categories</summary>
    <div class="mt-2 space-y-1">${entries.map(([name, c]) =>
      `<div class="py-1 border-b border-red-100 last:border-0 text-xs"><strong>${esc(name)}</strong>: ${Object.entries(c.categories).map(([cat, cnt]) => `${esc(cat)} (${cnt})`).join(', ')}</div>`
    ).join('')}</div>
  </details>`;
}

function applyVisibleSuggestions() {
  const derived = getDerivedClassification();
  const filters = {
    month: document.getElementById('tx-month-filter').value,
    category: document.getElementById('tx-cat-filter').value,
    type: document.getElementById('tx-type-filter').value,
    search: document.getElementById('tx-search').value
  };
  const base = getFilteredTransactions(filters, store.transactions, store);
  const display = getVisibleTransactions(base.filtered, derived);
  let changed = 0;
  display.forEach(tx => {
    if (tx.category) return;
    const suggestion = autoMatchMerchant(tx.merchant, tx.amount, store);
    if (!suggestion || !suggestion.category) return;
    tx.category = suggestion.category;
    tx.manualCategory = true;
    store.merchantMap[normalizeMerchantName(tx.merchant)] = { category: suggestion.category, type: tx.type };
    changed++;
  });
  if (changed === 0) {
    toast('No visible suggestions to apply.');
    return;
  }
  commit(`Applied ${changed} suggestion${changed !== 1 ? 's' : ''}.`);
}

function renderTransactions() {
  const filters = {
    month: document.getElementById('tx-month-filter').value,
    category: document.getElementById('tx-cat-filter').value,
    type: document.getElementById('tx-type-filter').value,
    search: document.getElementById('tx-search').value
  };
  const result = getFilteredTransactions(filters, store.transactions, store);
  const derived = getDerivedClassification();
  const displayTxs = getVisibleTransactions(result.filtered, derived);
  document.getElementById('conflict-banner').innerHTML = getConflictBannerHtml(derived.conflicts);
  const summaryEl = document.getElementById('tx-summary');
  const visibleSuggestions = displayTxs.filter(tx => !tx.category && autoMatchMerchant(tx.merchant, tx.amount, store)?.category).length;
  summaryEl.innerHTML = `<span class="tabular-nums">${displayTxs.length} transactions | Spending: ${fmt(-result.totalSpending)} | Income: ${fmt(result.totalIncome)}</span>${visibleSuggestions > 0 ? ` <button class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors ml-2" onclick="applyVisibleSuggestions()">Apply ${visibleSuggestions} visible suggestion${visibleSuggestions !== 1 ? 's' : ''}</button>` : ''}`;
  const tbody = document.getElementById('tx-body');
  tbody.innerHTML = displayTxs.map(tx => {
    const isSplitChild = !!tx.splitFrom;
    const isDupe = !isSplitChild && result.duplicateFingerprints[txFingerprint(tx)] > 1;
    const isRecurring = !!derived.recurring[normalizeMerchantName(tx.merchant)];
    const suggestion = !tx.category ? autoMatchMerchant(tx.merchant, tx.amount, store) : null;
    const certainty = suggestion && suggestion.category ? computeCategoryCertainty(tx, suggestion, derived.merchantStats, derived.recurring, store) : 0;
    const band = certaintyBand(certainty);
    const suggestBase = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-colors';
    const bandClass = band === 'high'
      ? `${suggestBase} bg-emerald-50 text-emerald-600 border border-emerald-400 hover:bg-emerald-100`
      : band === 'medium'
        ? `${suggestBase} bg-amber-50 text-amber-600 border border-amber-400 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-400`
        : `${suggestBase} bg-amber-50 text-amber-600 border border-dashed border-amber-400 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-400`;
    const restoreAction = isSplitChild ? `<button type="button" class="cursor-pointer text-sm text-slate-500 opacity-60 hover:opacity-100 hover:text-blue-600 transition-all inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-slate-100" onclick="restoreSplit(${tx.splitFrom})" title="Restore original transaction" aria-label="Restore split">&#8634;</button>` : '';
    const amountColor = tx.amount < 0 ? (tx.type === 'saving' ? 'text-violet-600' : 'text-red-500') : 'text-emerald-600';
    const rowBg = isSplitChild ? 'bg-blue-50/30' : isDupe ? 'bg-red-50/30' : 'hover:bg-slate-50/50';
    return `<tr class="${rowBg}">
      <td class="py-3 px-3 tabular-nums">${tx.pending ? '<em class="text-slate-500">Pending</em>' : tx.date}${isSplitChild ? '<span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">split</span>' : ''}${isDupe ? '<span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-500 border border-dashed border-red-300" title="Possible duplicate">dup?</span>' : ''}</td>
      <td class="py-3 px-3 font-medium">${esc(tx.merchant)}${isRecurring ? '<span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-blue-600 bg-blue-50" title="Recurring subscription">&#8635;</span>' : ''}</td>
      <td class="py-3 px-3 text-slate-500 max-w-[260px] truncate tx-col-desc">${esc(tx.description)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-medium ${amountColor}">${fmt(tx.amount)}</td>
      <td class="py-3 px-3"><div class="cat-select-wrap relative inline-block">${tx.category
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer border border-dashed border-slate-300 bg-slate-50 hover:border-blue-500 hover:bg-blue-50 transition-colors" onclick="openCatDropdown(event, ${tx.id})">${esc(tx.category)}</span>`
        : suggestion && suggestion.category
          ? `<span class="${bandClass}" data-txid="${tx.id}" data-cat="${esc(suggestion.category)}" onclick="acceptSuggestion(this)" title="${Math.round(certainty * 100)}% certainty">${esc(suggestion.category)} &#x2713;</span><span class="ml-0.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium cursor-pointer bg-amber-50 text-amber-600 border border-dashed border-amber-400 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-400 transition-colors" onclick="openCatDropdown(event, ${tx.id})">&#x25BE;</span>`
          : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer bg-amber-50 text-amber-600 border border-dashed border-amber-400 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600 transition-colors" onclick="openCatDropdown(event, ${tx.id})">+ Category</span>`}</div></td>
      <td class="py-3 px-3"><select class="px-1.5 py-0.5 rounded border border-slate-200 text-[11px] bg-white cursor-pointer" onchange="setTxType(${tx.id}, this.value)">
        ${tx.amount < 0 ? `
          <option value="spending" ${tx.type === 'spending' ? 'selected' : ''}>Spending</option>
          <option value="saving" ${tx.type === 'saving' ? 'selected' : ''}>Saving</option>
        ` : `
          <option value="income" ${tx.type === 'income' ? 'selected' : ''}>Income</option>
          <option value="loan" ${tx.type === 'loan' ? 'selected' : ''}>Loan inflow</option>
        `}
        <option value="ignore" ${tx.type === 'ignore' ? 'selected' : ''}>Ignore</option>
      </select></td>
      <td class="py-3 px-3 text-center tx-col-covered"><button type="button" class="cursor-pointer text-sm inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-slate-100 ${tx.covered ? 'opacity-100' : 'opacity-40 hover:opacity-70'} transition-all" onclick="toggleCovered(${tx.id})" aria-label="${tx.covered ? 'Unmark covered' : 'Mark covered'}">${tx.covered ? '&#10003;' : '&#9675;'}</button></td>
      <td class="py-3 px-1">
        <div class="flex items-center gap-0.5">
          ${!isSplitChild ? `<button type="button" class="cursor-pointer text-sm text-slate-500 opacity-60 hover:opacity-100 hover:text-blue-600 transition-all inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-slate-100" onclick="openSplitModal(${tx.id})" title="Split transaction" aria-label="Split">&#x2702;</button>` : ''}
          ${restoreAction}
          <button type="button" class="cursor-pointer text-sm text-slate-500 opacity-60 hover:opacity-100 hover:text-red-500 transition-all inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-red-50" onclick="deleteTx(${tx.id})" title="Delete transaction" aria-label="Delete">&#x2715;</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderDashboard() {
  const month = document.getElementById('dash-month').value;
  if (!month) return;
  const excludeCovered = document.getElementById('dash-exclude-covered').checked;
  const dashboardOptions = {
    store,
    excludeCovered,
    ensureYearBudget: year => ensureYearBudget(store, year)
  };
  const data = getMonthlyScorecardData(month, { ...dashboardOptions });
  const verdictAmount = data.budget.success ? fmt(data.budget.variance) : fmt(-data.budget.variance);
  const biggestMiss = data.budget.overBudgetCategories[0] || null;

  const gradient = data.budget.success
    ? 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-teal-50 border-emerald-300'
    : 'bg-gradient-to-br from-red-100 via-red-50 to-orange-50 border-red-300';
  const badgeClass = data.budget.success
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-red-100 text-red-600';
  const patternColor = data.budget.success ? 'text-emerald-800' : 'text-red-800';

  document.getElementById('dash-surplus').innerHTML = `<div class="relative overflow-hidden rounded-2xl border ${gradient} p-6 sm:p-8">
    <div class="relative z-10">
      <div class="flex flex-wrap items-center gap-2.5 mb-5">
        <span class="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">${data.monthLabel}</span>
        <span class="px-2.5 py-1 rounded-full text-xs font-bold ${badgeClass}">${data.budget.success ? 'Under budget' : 'Over budget'}</span>
        ${store.salaryShiftDay ? `<span class="text-xs text-slate-600">Salary shifted by day ${store.salaryShiftDay}</span>` : ''}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-[1.15fr_0.85fr] gap-6 items-start scorecard-main">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-2">How the month went</div>
          <h2 class="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tighter leading-none mb-3 max-w-[11ch]" style="text-wrap:balance">${data.budget.success ? `Under budget by ${verdictAmount}` : `Over budget by ${verdictAmount}`}</h2>
          <p class="text-sm text-slate-500 leading-relaxed max-w-[52ch]">${data.budget.overBudgetCategories.length > 0
            ? `${esc(data.budget.overBudgetCategories[0].category)} drove the biggest miss. The overview answers the month first, then gives you the top reasons before the lower drill-down cards.`
            : 'The month stayed within budget. Use the lower detail section only if you want a deeper read on category and merchant movement.'}</p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-5 border-t border-slate-200/40 scorecard-breakdown">
            <div class="p-3 rounded-xl bg-white/60 border border-slate-200/40">
              <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Fixed spending</div>
              <div class="text-xl font-bold tabular-nums tracking-tight">${fmt(data.spendingBreakdown.fixed.actual)}</div>
              <div class="text-xs text-slate-600 mt-1">Core monthly obligations</div>
            </div>
            <div class="p-3 rounded-xl bg-white/60 border border-slate-200/40">
              <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Flexible spending</div>
              <div class="text-xl font-bold tabular-nums tracking-tight">${fmt(data.spendingBreakdown.discretionary.actual)}</div>
              <div class="text-xs text-slate-600 mt-1">Everything outside fixed costs</div>
            </div>
            <div class="p-3 rounded-xl bg-white/60 border border-slate-200/40">
              <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Biggest miss</div>
              <div class="text-xl font-bold tabular-nums tracking-tight">${biggestMiss ? esc(biggestMiss.category) : 'None'}</div>
              <div class="text-xs text-slate-600 mt-1">${biggestMiss ? `${fmt(biggestMiss.variance)} over budget` : 'No overspent categories'}</div>
            </div>
          </div>
        </div>
        <div class="space-y-2.5">
          <div class="p-3.5 rounded-xl border border-slate-200/60 bg-white/50">
            <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">True income</div>
            <div class="text-2xl font-bold tabular-nums tracking-tight text-emerald-600">${fmt(data.totals.income)}</div>
            <div class="text-xs text-slate-600 mt-1.5">${data.totals.loanInflow > 0 ? `Loan inflow kept separate: ${fmt(data.totals.loanInflow)}` : 'Loan inflow does not count as income.'}</div>
          </div>
          <div class="p-3.5 rounded-xl border border-slate-200/60 bg-white/50">
            <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Spent vs budget</div>
            <div class="text-2xl font-bold tabular-nums tracking-tight text-red-500">${fmt(data.budget.spent)} / ${fmt(data.budget.total)}</div>
            <div class="text-xs text-slate-600 mt-1.5">${data.budget.overBudgetCategories.length} ${data.budget.overBudgetCategories.length === 1 ? 'category' : 'categories'} over budget.</div>
          </div>
          <div class="p-3.5 rounded-xl border border-slate-200/60 bg-white/50">
            <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Invested</div>
            <div class="text-2xl font-bold tabular-nums tracking-tight text-violet-600">${fmt(data.totals.invested)}</div>
            <div class="text-xs text-slate-600 mt-1.5">Shown separately from budget success.</div>
          </div>
          <div class="p-3.5 rounded-xl border border-slate-200/60 bg-white/50">
            <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">${data.totals.remainingCash >= 0 ? 'Remaining cash' : 'Cash shortfall'}</div>
            <div class="text-2xl font-bold tabular-nums tracking-tight ${data.totals.remainingCash >= 0 ? 'text-blue-600' : 'text-red-500'}">${fmt(data.totals.remainingCash)}</div>
            <div class="text-xs text-slate-600 mt-1.5">${data.totals.remainingCash >= 0 ? 'Cash left after spending and investing.' : 'Spending and investing exceeded true income.'}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="absolute inset-0 opacity-[0.04] pointer-events-none ${patternColor} bg-[radial-gradient(circle,_currentColor_1px,_transparent_1px)] [background-size:20px_20px]"></div>
  </div>`;

  const savings = getSavingsProgressData(month, dashboardOptions);
  const savingsYtd = getYtdSavingsProgress(month, dashboardOptions);
  document.getElementById('dash-savings-progress').innerHTML = `<div class="space-y-0">
    <div class="flex justify-between items-start py-3 text-sm">
      <div><div class="font-medium">Invested (${data.monthShortLabel})</div><div class="text-xs text-slate-600 mt-0.5">Monthly committed capital</div></div>
      <strong class="tabular-nums text-violet-600">${fmt(savings.monthly.invested)}</strong>
    </div>
    <div class="flex justify-between items-start py-3 border-t border-slate-100 text-sm">
      <div><div class="font-medium">Cash saved (YTD)</div><div class="text-xs text-slate-600 mt-0.5">Non-investment savings transfers</div></div>
      <strong class="tabular-nums text-emerald-600">${fmt(savingsYtd.ytd.cashSaved)}</strong>
    </div>
    <div class="flex justify-between items-start py-3 border-t border-slate-100 text-sm">
      <div><div class="font-medium">Invested (YTD)</div><div class="text-xs text-slate-600 mt-0.5">Keeps savings visible without counting against budget</div></div>
      <strong class="tabular-nums text-violet-600">${fmt(savingsYtd.ytd.invested)}</strong>
    </div>
    <div class="flex justify-between items-start py-3 border-t border-slate-100 text-sm">
      <div><div class="font-medium">Total progress (YTD)</div><div class="text-xs text-slate-600 mt-0.5">${savingsYtd.ytd.monthCount} month${savingsYtd.ytd.monthCount === 1 ? '' : 's'} tracked</div></div>
      <strong class="tabular-nums">${fmt(savingsYtd.ytd.total)}</strong>
    </div>
  </div>`;

  const obligations = detectRecurringObligations({
    store,
    asOfDate: getNextMonthDateString(month),
    excludeCovered
  });
  document.getElementById('dash-obligations').innerHTML = obligations.length === 0
    ? '<p class="text-sm text-slate-500 py-2">No active recurring obligations detected for the last full month.</p>'
    : obligations.slice(0, 3).map((item, i) => `
      <div class="flex justify-between items-start py-3 ${i > 0 ? 'border-t border-slate-100' : ''} text-sm">
        <div>
          <div class="font-medium">${esc(item.category)}</div>
          <div class="text-xs text-slate-600 mt-0.5">${item.fixed ? 'Fixed' : 'Recurring'} &bull; ${item.cadence} &bull; next ${item.nextExpectedDate}</div>
        </div>
        <strong class="tabular-nums">${fmt(-item.typicalAmount)}</strong>
      </div>
    `).join('');

  const overspent = getOverspentCategories(month, dashboardOptions);
  const diagnosisPatternClasses = {
    'budget-issue': 'bg-blue-50 text-blue-600',
    'one-off': 'bg-amber-50 text-amber-600',
    'recurring-habit': 'bg-red-50 text-red-500',
    'no-history': 'bg-slate-100 text-slate-500'
  };
  document.getElementById('dash-diagnosis').innerHTML = overspent.length === 0
    ? '<p class="text-sm text-slate-500 py-2">No overspent categories this month.</p>'
    : overspent.slice(0, 3).map((status, i) => {
      const comparisons = getCategoryComparisons(status.category, month, dashboardOptions);
      const pattern = classifyOverspendPattern(status.category, month, dashboardOptions);
      return `<div class="grid grid-cols-[1fr_auto] gap-4 py-4 ${i > 0 ? 'border-t border-slate-100' : ''}">
        <div>
          <span class="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide ${diagnosisPatternClasses[pattern.code] || diagnosisPatternClasses['no-history']}">${esc(pattern.label)}</span>
          <div class="text-lg font-semibold mt-2">${esc(status.category)}</div>
          <div class="text-sm text-slate-500">Budget ${fmt(-status.budget)} &bull; Last month ${fmt(-comparisons.previousMonth.actual)} &bull; 3-mo avg ${fmt(-comparisons.threeMonthAverage.actual)} &bull; 1-year avg ${fmt(-comparisons.twelveMonthAverage.actual)}</div>
        </div>
        <div class="text-base font-bold text-red-500 tabular-nums whitespace-nowrap">${fmt(-status.variance)} over</div>
      </div>`;
    }).join('');

  const breakdownItems = [];
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
    cats.forEach(cat => {
      const budget = getBudgetForMonth(store, cat, month, year => ensureYearBudget(store, year));
      if (budget <= 0) return;
      const actual = data.categoryTotals[cat] || 0;
      const pct = Math.round(actual / budget * 100);
      const comparisons = getCategoryComparisons(cat, month, dashboardOptions);
      breakdownItems.push({ cat, actual, budget, pct, comparisons });
    });
  });
  breakdownItems.sort((a, b) => b.pct - a.pct);
  const breakdownHTML = breakdownItems.map(({ cat, actual, budget, pct, comparisons }, i) => {
    const over = actual > budget;
    const diff = Math.abs(actual - budget);
    const barColor = pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-blue-500';
    const statusColor = over ? 'text-red-500 font-semibold' : 'text-slate-500';
    const statusText = over ? `${fmt(-diff)} over` : `${fmt(-diff)} left`;
    const deemphasize = pct < 60 ? 'opacity-60' : '';
    return `<div class="py-3.5 ${i > 0 ? 'border-t border-slate-100' : ''} ${deemphasize}">
      <div class="flex items-center gap-3">
        <span class="text-sm font-medium w-36 sm:w-44 shrink-0 truncate" title="${esc(cat)}">${esc(cat)}</span>
        <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${cat}: ${pct}% of budget used">
          <div class="h-full rounded-full ${barColor}" style="width:${Math.min(pct, 100)}%"></div>
        </div>
        <span class="text-xs tabular-nums text-slate-500 shrink-0 w-10 text-right">${pct}%</span>
        <span class="text-xs tabular-nums text-slate-600 shrink-0 w-32 text-right">${fmt(-actual)} / ${fmt(-budget)}</span>
        <span class="text-xs tabular-nums ${statusColor} shrink-0 w-24 text-right">${statusText}</span>
      </div>
      <div class="flex gap-4 mt-1.5 ml-36 sm:ml-44 pl-3 text-[11px] text-slate-400 tabular-nums">
        <span>Last mo: ${fmt(-comparisons.previousMonth.actual)}</span>
        <span>3-mo avg: ${fmt(-comparisons.threeMonthAverage.actual)}</span>
        <span>1-yr avg: ${fmt(-comparisons.twelveMonthAverage.actual)}</span>
      </div>
    </div>`;
  });
  const breakdownEl = document.getElementById('dash-category-breakdown');
  breakdownEl.innerHTML = breakdownItems.length > 0
    ? `<div class="border-t border-slate-200 mt-4 pt-2">
        <div class="flex justify-between items-baseline mb-2 px-1">
          <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">All categories</span>
          <span class="text-[11px] text-slate-400">Sorted by most over budget</span>
        </div>
        ${breakdownHTML.join('')}
      </div>`
    : '<p class="text-sm text-slate-500 mt-4 pt-4 border-t border-slate-200">No budgets set for this month.</p>';
  breakdownEl.classList.add('hidden');
  const toggleBtn = document.getElementById('dash-breakdown-toggle');
  if (toggleBtn) toggleBtn.textContent = 'Show all categories';
}

function renderYearlyDashboard() {
  const year = document.getElementById('dash-year').value || String(new Date().getFullYear());
  const excludeCovered = document.getElementById('dash-exclude-covered').checked;
  ensureYearBudget(store, year);
  const data = getYearlyDashboardData(year, {
    excludeCovered,
    transactions: store.transactions,
    budgets: store.budgets,
    categories: store.categories,
    loanBudget: store.loanBudget,
    salaryShiftDay: store.salaryShiftDay
  });

  document.getElementById('year-summary').innerHTML = `<div class="relative overflow-hidden rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50 via-indigo-50/30 to-slate-50 p-6 sm:p-8">
    <div class="relative z-10">
      <h2 class="text-lg font-bold mb-1">${year} Overview${data.ytd.monthCount < 12 ? ` (${data.ytd.monthCount} months of data)` : ''}${store.salaryShiftDay ? ` <span class="text-xs text-slate-600 font-normal">(salary-shifted day ${store.salaryShiftDay})</span>` : ''}</h2>
      <div class="flex items-center gap-2 mb-4 pb-4 border-b border-slate-200/40">
        <span class="text-sm text-slate-500">Expected annual loan (SU-lan):</span>
        <input type="number" id="loan-budget-input" value="${data.annualLoanBudget}" min="0" step="100" class="w-28 px-2 py-1 border border-slate-200 rounded-lg text-sm tabular-nums focus:outline-none focus:border-blue-500" onchange="saveLoanBudget('${year}', this.value)">
        <span class="text-sm text-slate-500">kr/year</span>
      </div>
      <div class="space-y-1.5 text-sm">
        <div class="flex justify-between"><span class="text-slate-500">YTD Income</span><span class="font-medium tabular-nums text-emerald-600">${fmt(data.ytd.income)}</span></div>
        ${data.ytd.loan > 0 || data.annualLoanBudget > 0 ? `<div class="flex justify-between"><span class="text-slate-500">YTD Loan inflow (SU-lan)</span><span class="font-medium tabular-nums text-slate-500">${fmt(data.ytd.loan)}${data.ytdLoanBudget > 0 ? ` / ${fmt(data.ytdLoanBudget)} expected` : ''}</span></div>` : ''}
        <div class="flex justify-between"><span class="text-slate-500">YTD Spending</span><span class="font-medium tabular-nums text-red-500">${fmt(-data.ytd.spend)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">YTD Saved / invested</span><span class="font-medium tabular-nums text-violet-600">${fmt(-data.ytd.save)}</span></div>
        <div class="flex justify-between pt-2 border-t border-slate-200/40"><span class="text-slate-500">YTD Budget (spending)</span><span class="font-medium tabular-nums text-slate-500">${fmt(-data.ytd.budget)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">${data.ytd.budget - data.ytd.spend >= 0 ? 'Under budget' : 'Over budget'}</span><span class="font-medium tabular-nums ${data.ytd.budget - data.ytd.spend >= 0 ? 'text-emerald-600' : 'text-red-500'}">${fmt(data.ytd.budget - data.ytd.spend)}</span></div>
        <div class="flex justify-between pt-2 mt-1 border-t-2 border-slate-300 font-semibold text-base"><span>${data.ytd.remaining >= 0 ? 'YTD Remaining' : 'YTD Shortfall'}</span><span class="tabular-nums ${data.ytd.remaining >= 0 ? 'text-emerald-600' : 'text-red-500'}">${fmt(data.ytd.remaining)}</span></div>
      </div>
    </div>
    <div class="absolute inset-0 opacity-[0.03] pointer-events-none text-blue-800 bg-[radial-gradient(circle,_currentColor_1px,_transparent_1px)] [background-size:20px_20px]"></div>
  </div>`;

  document.getElementById('year-stats').innerHTML = `
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Annual Budget</div>
      <div class="text-xl font-bold tabular-nums">${fmt(-data.annual.budget)}</div>
      <div class="text-xs text-slate-600 mt-1">spending categories</div>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Avg Monthly Spend</div>
      <div class="text-xl font-bold tabular-nums text-red-500">${fmt(-data.annual.avgSpend)}</div>
      <div class="text-xs text-slate-600 mt-1">over ${data.ytd.monthCount} month${data.ytd.monthCount !== 1 ? 's' : ''}</div>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Avg Monthly Income</div>
      <div class="text-xl font-bold tabular-nums text-emerald-600">${fmt(data.annual.avgIncome)}</div>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Budget Used</div>
      <div class="text-xl font-bold tabular-nums ${data.ytd.spend <= data.ytd.budget ? 'text-emerald-600' : 'text-red-500'}">${data.annual.budget > 0 ? `${Math.round(data.ytd.spend / data.annual.budget * 100)}%` : '0%'}</div>
      <div class="text-xs text-slate-600 mt-1">of annual budget</div>
    </div>`;

  // Cash flow bars: income vs spending paired
  const maxCashflow = Math.max(...data.monthData.map(m => Math.max(m.inc, m.spend, m.budget)), data.annual.avgIncome, 1);
  document.getElementById('year-cashflow-bars').innerHTML = `<div class="flex items-end gap-2" style="height:200px">${data.monthData.map((m) => {
    const isFuture = !m.hasActuals && !m.isPast;
    const avgIncome = data.annual.avgIncome;
    const displayIncome = isFuture ? avgIncome : m.inc;
    const displaySpend = isFuture ? m.budget : m.spend;
    const hIncome = displayIncome / maxCashflow * 170;
    const hSpend = displaySpend / maxCashflow * 170;
    const overBudget = m.hasActuals && m.spend > m.budget && m.budget > 0;
    const incomeClass = isFuture ? 'bg-emerald-100' : 'bg-emerald-500';
    const spendClass = isFuture ? 'bg-blue-100' : (overBudget ? 'bg-red-400' : 'bg-blue-500');
    const labelClass = isFuture ? 'text-slate-300' : 'text-slate-500';
    const hBudget = m.budget / maxCashflow * 170;
    const budgetLine = !isFuture && m.budget > 0
      ? `<div class="absolute left-0 right-0 h-[2px] bg-amber-500 rounded" style="bottom:${hBudget}px" title="Budget: ${fmtShort(m.budget)}"></div>`
      : '';
    return `<div class="flex-1 flex flex-col items-center justify-end h-full">
      <div class="flex gap-[2px] items-end w-full justify-center relative" style="height:100%">
        <div class="w-[42%] rounded-t ${incomeClass}" style="height:${Math.max(hIncome, 2)}px"></div>
        <div class="w-[42%] rounded-t ${spendClass} relative" style="height:${Math.max(hSpend, 2)}px">${budgetLine}</div>
      </div>
      <div class="text-[11px] ${labelClass} mt-2">${m.month}</div>
    </div>`;
  }).join('')}</div>`;

  const ytdNet = data.ytd.income - data.ytd.spend - data.ytd.save;

  // Summary line
  document.getElementById('year-cashflow-summary').innerHTML = `
    <div class="flex items-center gap-6 text-sm tabular-nums text-slate-500">
      <span>In: <strong class="text-emerald-600">${fmtShort(data.ytd.income)}</strong></span>
      <span>Out: <strong class="text-blue-600">${fmtShort(data.ytd.spend)}</strong></span>
      <span>Saved: <strong class="text-violet-600">${fmtShort(data.ytd.save)}</strong></span>
      <span class="text-slate-300">|</span>
      <span>Net: <strong class="${ytdNet >= 0 ? 'text-emerald-600' : 'text-red-500'}">${fmtShort(ytdNet)}</strong></span>
    </div>`;

  // Savings tracker
  const savingsBudget = Object.entries(store.categories).reduce((total, [group, cats]) => {
    if (group !== SAVINGS_GROUP) return total;
    return total + cats.reduce((sum, cat) => {
      return sum + MONTH_KEYS.reduce((mSum, m) => mSum + (Number(store.budgets[year]?.[cat]?.[m]) || 0), 0);
    }, 0);
  }, 0);
  const avgMonthlySave = data.ytd.monthCount > 0 ? data.ytd.save / data.ytd.monthCount : 0;
  const projectedSave = data.ytd.save + (data.forecast.futureMonthCount * avgMonthlySave);
  const projectedRemaining = data.forecast.income - data.forecast.spend;
  const savingsPct = savingsBudget > 0 ? Math.round(data.ytd.save / savingsBudget * 100) : 0;
  document.getElementById('year-savings-tracker').innerHTML = `
    <div class="flex justify-between items-baseline mb-5">
      <h2 class="text-base font-semibold text-slate-800">Savings & Forecast</h2>
      <span class="text-[11px] text-slate-400">Based on YTD averages</span>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
      <div>
        <div class="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">YTD Saved</div>
        <div class="text-xl font-bold tabular-nums text-violet-600">${fmtShort(data.ytd.save)}</div>
        <div class="text-xs text-slate-500 mt-0.5">${fmtShort(avgMonthlySave)}/mo avg</div>
      </div>
      <div>
        <div class="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Savings Budget</div>
        <div class="text-xl font-bold tabular-nums">${fmtShort(savingsBudget)}</div>
        <div class="text-xs text-slate-500 mt-0.5">${savingsPct}% achieved</div>
      </div>
      <div>
        <div class="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Projected Savings</div>
        <div class="text-xl font-bold tabular-nums text-violet-600">${fmtShort(projectedSave)}</div>
        <div class="text-xs text-slate-500 mt-0.5">at current pace</div>
      </div>
      <div>
        <div class="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Projected Surplus</div>
        <div class="text-xl font-bold tabular-nums ${projectedRemaining >= 0 ? 'text-emerald-600' : 'text-red-500'}">${fmtShort(projectedRemaining)}</div>
        <div class="text-xs text-slate-500 mt-0.5">income - spending</div>
      </div>
    </div>
    <div id="year-savings-chart" class="mt-5 mb-4"></div>
    <div class="space-y-2 text-sm border-t border-slate-100 pt-4">
      <div class="flex justify-between"><span class="text-slate-500">Projected income (EOY)</span><span class="font-medium tabular-nums text-emerald-600">${fmtShort(data.forecast.income)}</span></div>
      <div class="flex justify-between"><span class="text-slate-500">Projected spending (EOY)</span><span class="font-medium tabular-nums text-red-500">${fmtShort(-data.forecast.spend)}</span></div>
      <div class="flex justify-between"><span class="text-slate-500">Projected savings (EOY)</span><span class="font-medium tabular-nums text-violet-600">${fmtShort(-projectedSave)}</span></div>
      <div class="flex justify-between pt-2 mt-1 border-t-2 border-slate-300 font-semibold text-base"><span>Projected remaining</span><span class="tabular-nums ${projectedRemaining - projectedSave >= 0 ? 'text-emerald-600' : 'text-red-500'}">${fmtShort(projectedRemaining - projectedSave)}</span></div>
    </div>`;

  // Savings line chart
  const svgW = 720, svgH = 220, padL = 40, padR = 10, padT = 15, padB = 25;
  const chartW = svgW - padL - padR, chartH = svgH - padT - padB;
  let cumSave = 0;
  const savePoints = data.monthData.map((m, i) => {
    const isFuture = !m.hasActuals && !m.isPast;
    cumSave += isFuture ? avgMonthlySave : m.save;
    return { x: padL + (i * chartW / 11), cum: cumSave, isFuture };
  });
  const maxSave = Math.max(projectedSave, savingsBudget, 1);
  const savePts = savePoints.map(p => ({ ...p, y: padT + chartH - (p.cum / maxSave * chartH) }));
  const saveActual = savePts.filter(p => !p.isFuture);
  const saveForecast = savePts.filter(p => p.isFuture);
  const saveLastActual = saveActual[saveActual.length - 1];
  const saveActualLine = saveActual.map(p => p.x + ',' + p.y).join(' ');
  const saveForecastLine = saveLastActual
    ? [saveLastActual, ...saveForecast].map(p => p.x + ',' + p.y).join(' ')
    : saveForecast.map(p => p.x + ',' + p.y).join(' ');
  const budgetY = padT + chartH - (savingsBudget / maxSave * chartH);
  // Nice round grid lines for y-axis
  const niceStep = (() => {
    const rough = maxSave / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const candidates = [1, 2, 2.5, 5, 10];
    return mag * candidates.find(c => c * mag >= rough);
  })();
  const saveGridLines = [];
  for (let v = 0; v <= maxSave; v += niceStep) {
    saveGridLines.push({ y: padT + chartH - (v / maxSave * chartH), label: fmtShort(v) });
  }
  let svgContent = saveGridLines.map(g =>
    '<line x1="' + padL + '" y1="' + g.y + '" x2="' + (svgW - padR) + '" y2="' + g.y + '" stroke="#f1f5f9" stroke-width="1"/>'
  ).join('');
  svgContent += '<line x1="' + padL + '" y1="' + budgetY + '" x2="' + (svgW - padR) + '" y2="' + budgetY + '" stroke="#a78bfa" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>';
  if (saveActualLine) svgContent += '<polyline points="' + saveActualLine + '" fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  if (saveForecastLine) svgContent += '<polyline points="' + saveForecastLine + '" fill="none" stroke="#7c3aed" stroke-width="2" stroke-dasharray="5 4" opacity="0.4"/>';
  svgContent += saveActual.map(p => '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" fill="#7c3aed"/>').join('');
  if (saveLastActual) svgContent += '<circle cx="' + saveLastActual.x + '" cy="' + saveLastActual.y + '" r="6" fill="#7c3aed" opacity="0.15"/>';
  svgContent += data.monthData.map((m, i) =>
    '<text x="' + (padL + (i * chartW / 11)) + '" y="' + (svgH - 4) + '" text-anchor="middle" fill="#94a3b8" font-size="10">' + m.month + '</text>'
  ).join('');
  svgContent += saveGridLines.map(g =>
    '<text x="' + (padL - 4) + '" y="' + (g.y + 3) + '" text-anchor="end" fill="#cbd5e1" font-size="9">' + g.label + '</text>'
  ).join('');
  let chartHTML = '<div class="relative" style="height:' + svgH + 'px">';
  chartHTML += '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" class="w-full" style="height:auto" preserveAspectRatio="xMidYMid meet">' + svgContent + '</svg>';
  if (saveLastActual) chartHTML += '<div class="absolute text-[10px] font-semibold text-violet-600" style="left:' + (saveLastActual.x / svgW * 100) + '%;top:' + ((saveLastActual.y / svgH * 100) - 10) + '%">' + fmtShort(data.ytd.save) + '</div>';
  if (saveForecast.length > 0) chartHTML += '<div class="absolute text-[10px] font-medium text-violet-400" style="right:4px;top:' + ((savePts[savePts.length - 1].y / svgH * 100) - 10) + '%">EOY ' + fmtShort(projectedSave) + '</div>';
  chartHTML += '<div class="absolute text-[9px] text-violet-300" style="right:4px;top:' + (budgetY / svgH * 100) + '%">Target ' + fmtShort(savingsBudget) + '</div>';
  chartHTML += '</div>';
  document.getElementById('year-savings-chart').innerHTML = chartHTML;

  document.getElementById('year-forecast').innerHTML = '';
}

function saveLoanBudget(year, value) {
  store.loanBudget[year] = Number.parseFloat(value) || 0;
  commit(null);
}

function saveSalaryShiftDay(value) {
  store.salaryShiftDay = Number.parseInt(value, 10) || 0;
  commit(null);
}

function bindBudgetEditorEvents() {
  if (budgetEventsBound) return;
  const editorEl = document.getElementById('budget-editor');
  editorEl.addEventListener('change', ev => {
    const input = ev.target.closest('input[data-cat]');
    if (!input) return;
    setBudgetCell(input.getAttribute('data-year'), input.getAttribute('data-cat'), input.getAttribute('data-month'), input.value);
  });
  editorEl.addEventListener('contextmenu', ev => {
    const input = ev.target.closest('input[data-cat]');
    if (!input) return;
    fillRight(ev, input.getAttribute('data-year'), input.getAttribute('data-cat'), input.getAttribute('data-month'), input.value);
  });
  budgetEventsBound = true;
}

function renderBudgetEditor() {
  const year = document.getElementById('budget-year').value || String(new Date().getFullYear());
  ensureYearBudget(store, year);
  const yb = store.budgets[year];
  let html = '<table class="budget-table"><thead><tr><th>Category</th>';
  MONTHS.forEach(m => { html += `<th>${m}</th>`; });
  html += '<th>Total</th><th>Avg</th></tr></thead><tbody>';
  // Pre-calculate group totals for banners
  const groupTotals = {};
  Object.entries(store.categories).forEach(([group, cats]) => {
    const totals = {};
    MONTH_KEYS.forEach(m => { totals[m] = 0; });
    let annual = 0;
    cats.forEach(cat => {
      if (!yb[cat]) { yb[cat] = {}; MONTH_KEYS.forEach(m => { yb[cat][m] = 0; }); }
      MONTH_KEYS.forEach(m => {
        const val = Number(yb[cat][m]) || 0;
        totals[m] += val;
        annual += val;
      });
    });
    groupTotals[group] = { monthly: totals, annual };
  });

  // Render groups in order: Income, Savings, then spending groups
  const spendingGroups = Object.keys(store.categories).filter(g => g !== INCOME_GROUP && g !== SAVINGS_GROUP);
  const groupOrder = [INCOME_GROUP, SAVINGS_GROUP, ...spendingGroups];

  function renderGroup(group) {
    const cats = store.categories[group] || [];
    const gt = groupTotals[group] || { monthly: {}, annual: 0 };
    html += `<tr class="group-row"><td>${esc(group)}</td>`;
    MONTH_KEYS.forEach(m => {
      html += `<td style="text-align:right;font-variant-numeric:tabular-nums;font-size:11px;font-weight:500">${fmtShort(gt.monthly[m] || 0)}</td>`;
    });
    html += `<td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${fmtShort(gt.annual)}</td><td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:500;color:#64748b">${fmtShort(Math.round(gt.annual / 12))}</td></tr>`;
    cats.forEach(cat => {
      if (!yb[cat]) { yb[cat] = {}; MONTH_KEYS.forEach(m => { yb[cat][m] = 0; }); }
      let rowTotal = 0;
      html += `<tr><td>${esc(cat)}</td>`;
      MONTH_KEYS.forEach(m => {
        const val = Number(yb[cat][m]) || 0;
        rowTotal += val;
        html += `<td><input type="number" value="${val}" data-year="${year}" data-cat="${esc(cat)}" data-month="${m}"></td>`;
      });
      html += `<td class="col-total">${fmtShort(rowTotal)}</td><td class="col-avg">${fmtShort(Math.round(rowTotal / 12))}</td></tr>`;
    });
  }

  groupOrder.forEach(renderGroup);

  // Grand totals
  const totalSpending = spendingGroups.reduce((sum, g) => sum + (groupTotals[g]?.annual || 0), 0);
  const totalSpendingMonthly = {};
  MONTH_KEYS.forEach(m => {
    totalSpendingMonthly[m] = spendingGroups.reduce((sum, g) => sum + (groupTotals[g]?.monthly[m] || 0), 0);
  });
  html += '<tr class="total-row"><td>Total Spending</td>';
  MONTH_KEYS.forEach(m => { html += `<td class="col-total">${fmtShort(totalSpendingMonthly[m])}</td>`; });
  html += `<td class="col-total">${fmtShort(totalSpending)}</td><td class="col-avg">${fmtShort(Math.round(totalSpending / 12))}</td></tr>`;
  html += '</tbody></table>';
  document.getElementById('budget-editor').innerHTML = html;
}

function setBudgetCell(year, cat, month, value) {
  ensureYearBudget(store, year);
  if (!store.budgets[year][cat]) {
    store.budgets[year][cat] = {};
    MONTH_KEYS.forEach(m => { store.budgets[year][cat][m] = 0; });
  }
  store.budgets[year][cat][month] = Number.parseFloat(value) || 0;
  // Auto-calculate Feriepenge as 12.5% of Part-time job
  if (cat === 'Part-time job') {
    if (!store.budgets[year]['Feriepenge']) {
      store.budgets[year]['Feriepenge'] = {};
      MONTH_KEYS.forEach(m => { store.budgets[year]['Feriepenge'][m] = 0; });
    }
    store.budgets[year]['Feriepenge'][month] = Math.round((Number.parseFloat(value) || 0) * 0.125);
  }
  commit(null, 'budget');
}

function fillRight(event, year, cat, fromMonth, value) {
  event.preventDefault();
  ensureYearBudget(store, year);
  if (!store.budgets[year][cat]) {
    store.budgets[year][cat] = {};
    MONTH_KEYS.forEach(m => { store.budgets[year][cat][m] = 0; });
  }
  const startIdx = MONTH_KEYS.indexOf(fromMonth);
  const numericValue = Number.parseFloat(value) || 0;
  for (let i = startIdx; i < 12; i++) {
    store.budgets[year][cat][MONTH_KEYS[i]] = numericValue;
    // Auto-calculate Feriepenge as 12.5% of Part-time job
    if (cat === 'Part-time job') {
      if (!store.budgets[year]['Feriepenge']) {
        store.budgets[year]['Feriepenge'] = {};
        MONTH_KEYS.forEach(m => { store.budgets[year]['Feriepenge'][m] = 0; });
      }
      store.budgets[year]['Feriepenge'][MONTH_KEYS[i]] = Math.round(numericValue * 0.125);
    }
  }
  commit(`Filled ${cat} from ${MONTHS[startIdx]} onward with ${fmtShort(numericValue)}`);
}

function renderCategoryManager() {
  const container = document.getElementById('cat-manager');
  container.innerHTML = '';
  Object.entries(store.categories).forEach(([group, cats]) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'bg-white rounded-xl shadow-sm border border-slate-200 p-5';
    groupDiv.innerHTML = `<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 pb-2 border-b border-slate-100">${esc(group)} (${cats.length})</h3>`;
    const listDiv = document.createElement('div');
    listDiv.className = 'space-y-0';
    cats.forEach(cat => {
      const count = store.transactions.filter(tx => tx.category === cat).length;
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between py-2 px-2 rounded-lg text-sm hover:bg-slate-50 transition-colors';
      item.innerHTML = `<span>${esc(cat)} <span class="text-xs text-slate-600">(${count} txns)</span></span><div class="flex gap-2"></div>`;
      const btnWrap = item.querySelector('.flex.gap-2');
      const renameBtn = document.createElement('button');
      renameBtn.className = 'px-2 py-0.5 rounded text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors';
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', () => renameCat(group, cat));
      btnWrap.appendChild(renameBtn);
      if (count === 0) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'px-2 py-0.5 rounded text-xs font-medium text-red-500 border border-red-300 hover:bg-red-50 transition-colors';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteCat(group, cat));
        btnWrap.appendChild(deleteBtn);
      }
      listDiv.appendChild(item);
    });
    groupDiv.appendChild(listDiv);
    container.appendChild(groupDiv);
  });
}

function openNewCatModal() {
  modalTriggerEl = document.activeElement;
  document.getElementById('modal-new-cat').classList.add('open');
  document.getElementById('new-cat-name').focus();
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (modalTriggerEl && typeof modalTriggerEl.focus === 'function') {
    modalTriggerEl.focus();
    modalTriggerEl = null;
  }
}

function addNewCategory() {
  const name = document.getElementById('new-cat-name').value.trim();
  const group = document.getElementById('new-cat-group').value;
  if (!name) return;
  if (!store.categories[group]) store.categories[group] = [];
  if (store.categories[group].includes(name)) {
    toast('Already exists.');
    return;
  }
  store.categories[group].push(name);
  Object.keys(store.budgets).forEach(year => {
    store.budgets[year][name] = {};
    MONTH_KEYS.forEach(m => { store.budgets[year][name][m] = 0; });
  });
  document.getElementById('new-cat-name').value = '';
  closeModal('modal-new-cat');
  commit(`Added "${name}" to ${group}.`);
}

function renameCat(group, oldName) {
  const newName = window.prompt(`Rename "${oldName}" to:`, oldName);
  if (!newName || newName === oldName) return;
  const idx = store.categories[group].indexOf(oldName);
  if (idx >= 0) store.categories[group][idx] = newName;
  store.transactions.forEach(tx => {
    if (tx.category === oldName) tx.category = newName;
  });
  Object.keys(store.budgets).forEach(year => {
    if (store.budgets[year][oldName]) {
      store.budgets[year][newName] = store.budgets[year][oldName];
      delete store.budgets[year][oldName];
    }
  });
  Object.keys(store.merchantMap).forEach(key => {
    if (store.merchantMap[key].category === oldName) store.merchantMap[key].category = newName;
  });
  MERCHANT_PATTERNS.forEach(rule => {
    if (rule.c === oldName) rule.c = newName;
  });
  commit(`Renamed to "${newName}".`);
}

function deleteCat(group, name) {
  if (!window.confirm(`Delete category "${name}"? This will uncategorize all transactions tagged with it.`)) return;
  store.categories[group] = store.categories[group].filter(cat => cat !== name);
  if (!store.deletedCategories) store.deletedCategories = [];
  if (!store.deletedCategories.includes(name)) store.deletedCategories.push(name);
  store.transactions.forEach(tx => {
    if (tx.category === name) {
      tx.category = '';
      tx.manualCategory = false;
    }
  });
  Object.keys(store.merchantMap).forEach(key => {
    if (store.merchantMap[key].category === name) delete store.merchantMap[key];
  });
  MERCHANT_PATTERNS.forEach(rule => {
    if (rule.c === name) rule.c = '';
  });
  Object.keys(store.budgets).forEach(year => {
    delete store.budgets[year][name];
  });
  commit(`Deleted "${name}".`);
}

function exportData() {
  const payload = exportPayload(store);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spending-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported backup (schema v${payload.version}).`);
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || !Array.isArray(data.transactions) || !data.categories) {
        toast('Invalid backup: expected transactions and categories.');
        return;
      }
      setStore(data);
      const sanitized = sanitizeTransactions(store);
      commit(sanitized > 0 ? `Data imported. Auto-cleared ${sanitized} mismatched categories.` : 'Data imported.');
    } catch (error) {
      toast(`Error reading file: ${error.message}`);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function updateCatFilter() {
  const group = document.getElementById('tx-group-filter').value;
  const txCat = document.getElementById('tx-cat-filter');
  const prev = txCat.value;
  let cats = [];
  if (group === 'all') {
    Object.entries(store.categories).forEach(([, list]) => cats.push(...list));
    const usedCats = [...new Set(store.transactions.filter(tx => tx.category).map(tx => tx.category))];
    cats = [...new Set([...cats, ...usedCats])].sort();
  } else {
    cats = (store.categories[group] || []).slice().sort();
  }
  txCat.innerHTML = '<option value="all">All categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  txCat.value = cats.includes(prev) ? prev : 'all';
}

function populateFilters() {
  const allMonths = getUniqueMonths(store.transactions, store.salaryShiftDay || 0);
  const months = getRecentMonths(store.transactions, store.salaryShiftDay || 0);
  const dashMonth = document.getElementById('dash-month');
  const dashMonthValue = dashMonth.value;
  const lastCompletedMonth = getLastCompletedMonth(new Date());
  const firstMonth = getEarliestMonthForDashboard(store.transactions, store.budgets, store.salaryShiftDay || 0);
  const finalMonth = allMonths.length > 0
    ? allMonths[allMonths.length - 1]
    : lastCompletedMonth;
  const dashboardMonths = firstMonth ? getMonthRange(firstMonth, finalMonth) : [lastCompletedMonth];
  const defaultDashMonth = dashboardMonths.includes(lastCompletedMonth) ? lastCompletedMonth : dashboardMonths[dashboardMonths.length - 1];
  dashMonth.innerHTML = dashboardMonths.map(m => `<option value="${m}">${m}</option>`).join('');
  dashMonth.value = dashboardMonths.includes(dashMonthValue) ? dashMonthValue : (defaultDashMonth || '');
  document.getElementById('dash-salary-shift').value = store.salaryShiftDay || 0;
  const txMonth = document.getElementById('tx-month-filter');
  const txMonthValue = txMonth.value;
  txMonth.innerHTML = '<option value="all">All months</option>' + months.map(m => `<option value="${m}">${m}</option>`).join('');
  txMonth.value = txMonthValue || 'all';
  const txGroup = document.getElementById('tx-group-filter');
  const txGroupValue = txGroup.value;
  txGroup.innerHTML = '<option value="all">All groups</option>' + Object.keys(store.categories).map(g => `<option value="${g}">${g}</option>`).join('');
  txGroup.value = txGroupValue || 'all';
  updateCatFilter();
  const years = new Set();
  allMonths.forEach(m => years.add(m.slice(0, 4)));
  years.add(String(new Date().getFullYear()));
  const sortedYears = [...years].sort();
  const budgetYear = document.getElementById('budget-year');
  const budgetYearValue = budgetYear.value;
  budgetYear.innerHTML = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
  budgetYear.value = budgetYearValue || String(new Date().getFullYear());
  const dashYear = document.getElementById('dash-year');
  const dashYearValue = dashYear.value;
  dashYear.innerHTML = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
  dashYear.value = dashYearValue || String(new Date().getFullYear());
}

function switchDashView(view) {
  document.querySelectorAll('.dash-view-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  document.getElementById('dash-monthly-view').style.display = view === 'monthly' ? '' : 'none';
  document.getElementById('dash-yearly-view').style.display = view === 'yearly' ? '' : 'none';
  document.getElementById('dash-month').style.display = view === 'monthly' ? '' : 'none';
  document.getElementById('dash-year').style.display = view === 'yearly' ? '' : 'none';
  if (view === 'yearly') renderYearlyDashboard();
  else renderDashboard();
}

function switchSection(section) {
  document.querySelectorAll('.nav-item[data-section]').forEach(el => {
    const isActive = el.dataset.section === section;
    el.classList.toggle('active', isActive);
    if (isActive) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.querySelectorAll('.mobile-nav-item[data-section]').forEach(el => {
    const isActive = el.dataset.section === section;
    el.classList.toggle('active', isActive);
    if (isActive) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.querySelectorAll('.section-content').forEach(el => {
    el.classList.toggle('hidden', el.id !== `tab-${section}`);
  });
  const titleEl = document.getElementById('nav-section-title');
  if (titleEl) titleEl.textContent = SECTION_TITLES[section] || section;
  if (section === 'dashboard') renderDashboard();
  if (section === 'transactions') renderTransactions();
  if (section === 'budgets') renderBudgetEditor();
  if (section === 'categories') renderCategoryManager();
}

function acceptSuggestion(el) {
  const txId = Number.parseInt(el.getAttribute('data-txid'), 10);
  const cat = el.getAttribute('data-cat');
  selectCategory(txId, cat);
}

function bindNavEvents() {
  document.querySelectorAll('[data-section]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.preventDefault();
      switchSection(el.dataset.section);
    });
  });
}

function bindImportEvents() {
  const importArea = document.getElementById('import-area');
  importArea.addEventListener('dragover', e => {
    e.preventDefault();
    importArea.classList.add('dragover');
  });
  importArea.addEventListener('dragleave', () => importArea.classList.remove('dragover'));
  importArea.addEventListener('drop', e => {
    e.preventDefault();
    importArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.csv')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      pendingImport = parseNordeaCSV(ev.target.result);
      renderImportPreview();
    };
    reader.readAsText(file, 'UTF-8');
  });
}

function toggleCategoryBreakdown() {
  const el = document.getElementById('dash-category-breakdown');
  const btn = document.getElementById('dash-breakdown-toggle');
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    btn.textContent = 'Hide all categories';
  } else {
    el.classList.add('hidden');
    btn.textContent = 'Show all categories';
  }
}

function bindGlobalActions() {
  Object.assign(window, {
    addNewCategory,
    addSplitPart,
    acceptSuggestion,
    applyVisibleSuggestions,
    cancelImport,
    clearAllTransactions,
    closeModal,
    confirmImport,
    confirmSplit,
    deleteCat,
    deleteTx,
    exportData,
    fillRight,
    filterCatOptions,
    handleCSV,
    importJSON,
    openCatDropdown,
    openNewCatModal,
    openSplitModal,
    renderDashboard,
    renderBudgetEditor,
    renderAll: rerenderAll,
    renderTransactions,
    renderYearlyDashboard,
    restoreSplit,
    saveLoanBudget,
    saveSalaryShiftDay,
    setBudgetCell,
    setTxType,
    switchDashView,
    switchSection,
    toggleCategoryBreakdown,
    toggleCovered,
    updateCatFilter
  });
}

export function initApp() {
  const sanitized = sanitizeTransactions(store);
  if (sanitized > 0) persistStore();
  renderAppVersion();
  bindGlobalActions();
  bindNavEvents();
  bindImportEvents();
  bindBudgetEditorEvents();
  document.addEventListener('click', closeCatDropdowns);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      const openDropdowns = document.querySelectorAll('.cat-dropdown');
      if (openDropdowns.length > 0) {
        closeCatDropdowns();
        return;
      }
      const openModal = document.querySelector('.modal-overlay.open');
      if (openModal) {
        closeModal(openModal.id);
      }
    }
  });
  rerenderAll();
  if (sanitized > 0) toast(`Auto-cleared ${sanitized} mismatched category${sanitized !== 1 ? 's' : ''}.`);
}

export {
  getStore,
  rerenderAll as renderAllForTests,
  resolveMerchant
};
