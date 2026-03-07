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
  txFingerprint,
  normalizeMerchantName
} from './transactions.js';
import {
  classifyOverspendPattern,
  getCategoryComparisons,
  getBudgetForMonth,
  getEffectiveMonth,
  getLastCompletedMonth,
  getMonthlyScorecardData,
  getOverspentCategories,
  getRecentMonths,
  getUniqueMonths,
  getYearlyDashboardData
} from './dashboard.js';

const APP_VERSION = 'v0.2';
const APP_VERSION_COMMIT_URL = 'https://api.github.com/repos/alexandermyrup/spending-tracker/commits/main';

let store = loadStore();
let pendingImport = [];
let lastImportedIds = [];
let splitTxId = null;
let budgetEventsBound = false;

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
    const response = await fetch(APP_VERSION_COMMIT_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) return;
    const commit = await response.json();
    const shortSha = String(commit?.sha || '').slice(0, 7);
    if (shortSha) badge.textContent = `${APP_VERSION}.${shortSha}`;
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
  persistStore();
  if (renderMode === 'all') rerenderAll();
  else if (renderMode === 'transactions') renderTransactions();
  else if (renderMode === 'dashboard') {
    renderDashboard();
    renderBudgetEditor();
  }
  if (message) toast(message);
}

function getDerivedClassification() {
  const merchantStats = computeMerchantStats(store.transactions);
  const recurring = detectRecurringMerchants(merchantStats);
  const conflicts = detectConflicts(merchantStats);
  return { merchantStats, recurring, conflicts };
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
    return `<tr>
      <td>${tx.pending ? '<em>Pending</em>' : tx.date}</td>
      <td>${esc(tx.merchant)}</td>
      <td class="text-muted">${esc(tx.description)}</td>
      <td class="amount ${tx.amount < 0 ? 'expense' : 'income'}">${fmt(tx.amount)}</td>
      <td>${autocat && autocat.category ? `<span class="badge badge-uncategorized">${esc(autocat.category)} ?</span>` : autocat && autocat.type === 'ignore' ? '<span class="badge badge-covered">Ignore</span>' : '<span class="badge badge-uncategorized">?</span>'}</td>
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
    if (autocat && autocat.category) {
      const key = tx.merchant.toUpperCase();
      const stats = merchantStats[key];
      if (recurring[key] && stats && stats.primaryCategoryCount >= 3 && stats.primaryCategory === autocat.category) {
        assignedCategory = autocat.category;
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
    html += '<div class="cat-option" data-cat="" style="color:var(--red);font-weight:500;border-bottom:1px solid var(--border)">Remove category</div>';
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
  html += `<div class="cat-new-group-picker" style="display:none;padding:6px 8px;border-top:1px solid var(--border)">
    <div style="font-size:11px;color:var(--text2);margin-bottom:4px;font-weight:500">Add to group:</div>
    ${validGroups.map(g => `<div class="cat-group-pick" data-group="${esc(g)}" style="padding:3px 8px;border-radius:4px;font-size:12px;cursor:pointer;margin-bottom:2px">${esc(g)}</div>`).join('')}
  </div>`;
  dd.innerHTML = html;
  const input = dd.querySelector('input');
  input.addEventListener('input', () => filterCatOptions(input));
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
  row.className = 'split-part';
  row.innerHTML = `
    <div class="form-group"><label>Label / Category</label>
      <input type="text" class="split-cat" value="${esc(category)}" placeholder="e.g. SU (grant)">
    </div>
    <div class="form-group"><label>Amount</label>
      <input type="number" class="split-amt" value="${Math.abs(amount)}" step="0.01" min="0">
    </div>
    <div class="form-group"><label>Type</label>
      <select class="split-type">
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
    <button class="remove-part" type="button">&times;</button>
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
    el.innerHTML = '<span style="color:var(--green)">Fully allocated</span>';
    btn.disabled = false;
  } else {
    el.innerHTML = `<span style="color:var(--orange)">Remainder: ${fmt(tx.amount > 0 ? remainder : -remainder)}</span>`;
    btn.disabled = Math.abs(remainder) > 0.01;
  }
}

function confirmSplit() {
  const tx = store.transactions.find(t => t.id === splitTxId);
  if (!tx) return;
  const parts = document.querySelectorAll('#split-parts .split-part');
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
  return `<details class="conflict-banner"><summary>${entries.length} merchant${entries.length !== 1 ? 's' : ''} with conflicting categories</summary><div class="conflict-list">${entries.map(([name, c]) =>
    `<div class="conflict-item"><strong>${esc(name)}</strong>: ${Object.entries(c.categories).map(([cat, cnt]) => `${esc(cat)} (${cnt})`).join(', ')}</div>`
  ).join('')}</div></details>`;
}

function applyVisibleSuggestions() {
  const derived = getDerivedClassification();
  const filters = {
    month: document.getElementById('tx-month-filter').value,
    category: document.getElementById('tx-cat-filter').value,
    type: document.getElementById('tx-type-filter').value,
    uncategorizedOnly: false,
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
    uncategorizedOnly: false,
    search: document.getElementById('tx-search').value
  };
  const result = getFilteredTransactions(filters, store.transactions, store);
  const derived = getDerivedClassification();
  const displayTxs = getVisibleTransactions(result.filtered, derived);
  document.getElementById('conflict-banner').innerHTML = getConflictBannerHtml(derived.conflicts);
  const summaryEl = document.getElementById('tx-summary');
  const visibleSuggestions = displayTxs.filter(tx => !tx.category && autoMatchMerchant(tx.merchant, tx.amount, store)?.category).length;
  summaryEl.innerHTML = `${displayTxs.length} transactions | Spending: ${fmt(-result.totalSpending)} | Income: ${fmt(result.totalIncome)}${visibleSuggestions > 0 ? ` <button class="btn btn-sm" onclick="applyVisibleSuggestions()">Apply ${visibleSuggestions} visible suggestion${visibleSuggestions !== 1 ? 's' : ''}</button>` : ''}`;
  const tbody = document.getElementById('tx-body');
  tbody.innerHTML = displayTxs.map(tx => {
    const isSplitChild = !!tx.splitFrom;
    const isDupe = !isSplitChild && result.duplicateFingerprints[txFingerprint(tx)] > 1;
    const isRecurring = !!derived.recurring[tx.merchant.toUpperCase()];
    const suggestion = !tx.category ? autoMatchMerchant(tx.merchant, tx.amount, store) : null;
    const certainty = suggestion && suggestion.category ? computeCategoryCertainty(tx, suggestion, derived.merchantStats, derived.recurring, store) : 0;
    const band = certaintyBand(certainty);
    const bandClass = band === 'high' ? ' cat-suggest-high' : band === 'medium' ? ' cat-suggest-medium' : '';
    const restoreAction = isSplitChild ? `<span class="split-icon" onclick="restoreSplit(${tx.splitFrom})" title="Restore original transaction">&#8634;</span>` : '';
    return `<tr${isSplitChild ? ' style="background:#f8f9ff"' : (isDupe ? ' style="background:#fef2f2"' : '')}>
      <td class="mono">${tx.pending ? '<em>Pending</em>' : tx.date}${isSplitChild ? '<span class="badge-split">split</span>' : ''}${isDupe ? '<span class="badge-duplicate" title="Possible duplicate">dup?</span>' : ''}</td>
      <td class="fw-500">${esc(tx.merchant)}${isRecurring ? '<span class="badge-recurring" title="Recurring subscription">&#8635;</span>' : ''}</td>
      <td class="text-muted text-sm">${esc(tx.description)}</td>
      <td class="amount ${tx.amount < 0 ? (tx.type === 'saving' ? 'saving' : 'expense') : 'income'} mono">${fmt(tx.amount)}</td>
      <td><div class="cat-select-wrap">${tx.category
        ? `<span class="cat-select-trigger" onclick="openCatDropdown(event, ${tx.id})">${esc(tx.category)}</span>`
        : suggestion && suggestion.category
          ? `<span class="cat-suggest${bandClass}" data-txid="${tx.id}" data-cat="${esc(suggestion.category)}" onclick="acceptSuggestion(this)" title="${Math.round(certainty * 100)}% certainty">${esc(suggestion.category)} &#x2713;</span><span class="cat-select-trigger badge-uncategorized" onclick="openCatDropdown(event, ${tx.id})" style="padding:2px 6px;margin-left:2px">&#x25BE;</span>`
          : `<span class="cat-select-trigger badge-uncategorized" onclick="openCatDropdown(event, ${tx.id})">+ Category</span>`}</div></td>
      <td><select class="type-select" onchange="setTxType(${tx.id}, this.value)">
        ${tx.amount < 0 ? `
          <option value="spending" ${tx.type === 'spending' ? 'selected' : ''}>Spending</option>
          <option value="saving" ${tx.type === 'saving' ? 'selected' : ''}>Saving</option>
        ` : `
          <option value="income" ${tx.type === 'income' ? 'selected' : ''}>Income</option>
          <option value="loan" ${tx.type === 'loan' ? 'selected' : ''}>Loan inflow</option>
        `}
        <option value="ignore" ${tx.type === 'ignore' ? 'selected' : ''}>Ignore</option>
      </select></td>
      <td style="text-align:center"><span class="covered-toggle ${tx.covered ? 'active' : ''}" onclick="toggleCovered(${tx.id})">${tx.covered ? '&#10003;' : '&#9675;'}</span></td>
      <td class="tx-actions">
        ${!isSplitChild ? `<span class="split-icon" onclick="openSplitModal(${tx.id})" title="Split transaction">&#x2702;</span>` : ''}
        ${restoreAction}
        <span class="split-icon" onclick="deleteTx(${tx.id})" title="Delete transaction" style="color:var(--red)">&#x2715;</span>
      </td>
    </tr>`;
  }).join('');
}

function renderDashboard() {
  const month = document.getElementById('dash-month').value;
  if (!month) return;
  const excludeCovered = document.getElementById('dash-exclude-covered').checked;
  const data = getMonthlyScorecardData(month, {
    store,
    excludeCovered,
    ensureYearBudget: year => ensureYearBudget(store, year)
  });
  document.getElementById('dash-surplus').innerHTML = `<div class="surplus-card">
    <h2>Monthly Scorecard <span class="text-xs text-muted">(${data.monthShortLabel})</span>${store.salaryShiftDay ? ` <span class="text-xs text-muted">(salary-shifted by day ${store.salaryShiftDay})</span>` : ''}</h2>
    <div class="text-sm" style="margin-bottom:12px;color:${data.verdict.status === 'positive' ? 'var(--green)' : 'var(--red)'};font-weight:600">
      ${data.budget.success ? `Under budget by ${fmt(data.budget.variance)}` : `Over budget by ${fmt(-data.budget.variance)}`}
    </div>
    <div class="surplus-row"><span class="surplus-label">True income received</span><span class="surplus-val" style="color:var(--green)">${fmt(data.totals.income)}</span></div>
    ${data.totals.loanInflow > 0 ? `<div class="surplus-row"><span class="surplus-label">Loan inflow (SU-lån)</span><span class="surplus-val" style="color:var(--text2)">${fmt(data.totals.loanInflow)}</span></div>` : ''}
    <div class="surplus-row"><span class="surplus-label">Spent vs budget</span><span class="surplus-val" style="color:var(--red)">${fmt(-data.budget.spent)} / ${fmt(-data.budget.total)}</span></div>
    <div class="surplus-row"><span class="surplus-label">Cash saved</span><span class="surplus-val" style="color:var(--green)">${fmt(data.totals.cashSaved)}</span></div>
    <div class="surplus-row"><span class="surplus-label">Invested</span><span class="surplus-val" style="color:var(--purple)">${fmt(data.totals.invested)}</span></div>
    <div class="surplus-row total"><span class="surplus-label">${data.totals.remainingCash >= 0 ? 'Remaining cash' : 'Cash shortfall'}</span><span class="surplus-val" style="color:${data.totals.remainingCash >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(data.totals.remainingCash)}</span></div>
  </div>`;
  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card"><div class="label">Fixed costs</div><div class="value negative">${fmt(-data.spendingBreakdown.fixed.actual)}</div><div class="sub">${data.spendingBreakdown.fixed.budget > 0 ? `${Math.round(data.spendingBreakdown.fixed.actual / data.spendingBreakdown.fixed.budget * 100)}% of fixed budget` : 'No fixed budget set'}</div></div>
    <div class="stat-card"><div class="label">Discretionary</div><div class="value negative">${fmt(-data.spendingBreakdown.discretionary.actual)}</div><div class="sub">${data.spendingBreakdown.discretionary.budget > 0 ? `${Math.round(data.spendingBreakdown.discretionary.actual / data.spendingBreakdown.discretionary.budget * 100)}% of discretionary budget` : 'No discretionary budget set'}</div></div>
    <div class="stat-card"><div class="label">Cash saved</div><div class="value positive">${fmt(data.totals.cashSaved)}</div></div>
    <div class="stat-card"><div class="label">Invested</div><div class="value" style="color:var(--purple)">${fmt(data.totals.invested)}</div></div>
    <div class="stat-card"><div class="label">Over-budget categories</div><div class="value ${data.budget.overBudgetCategories.length === 0 ? 'positive' : 'negative'}">${data.budget.overBudgetCategories.length}</div><div class="sub">${data.budget.overBudgetCategories.length === 0 ? 'clean month' : 'needs diagnosis'}</div></div>
    <div class="stat-card"><div class="label">Remaining cash</div><div class="value ${data.totals.remainingCash >= 0 ? 'positive' : 'negative'}">${fmt(data.totals.remainingCash)}</div><div class="sub">after spending, savings, investing</div></div>
    ${data.totals.uncategorizedCount > 0 ? `<div class="stat-card" style="border-color:var(--orange)"><div class="label">Uncategorized</div><div class="value" style="color:var(--orange)">${data.totals.uncategorizedCount}</div><div class="sub">need tagging</div></div>` : ''}
  `;
  const overspent = getOverspentCategories(month, {
    store,
    excludeCovered,
    ensureYearBudget: year => ensureYearBudget(store, year)
  });
  document.getElementById('dash-diagnosis').innerHTML = overspent.length === 0
    ? '<p class="text-muted">No overspent categories this month.</p>'
    : `<div style="display:flex;flex-direction:column;gap:12px">${overspent.slice(0, 4).map(status => {
      const comparisons = getCategoryComparisons(status.category, month, {
        store,
        excludeCovered,
        ensureYearBudget: year => ensureYearBudget(store, year)
      });
      const pattern = classifyOverspendPattern(status.category, month, {
        store,
        excludeCovered,
        ensureYearBudget: year => ensureYearBudget(store, year)
      });
      return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px 14px">
        <div class="flex-between" style="margin-bottom:6px">
          <strong>${esc(status.category)}</strong>
          <span class="mono" style="color:var(--red)">${fmt(-status.variance)} over</span>
        </div>
        <div class="text-sm text-muted" style="margin-bottom:6px">${pattern.label}</div>
        <div class="text-sm text-muted">Budget ${fmt(-status.budget)} | Last month ${fmt(-comparisons.previousMonth.actual)} | 3-mo avg ${fmt(-comparisons.threeMonthAverage.actual)}</div>
      </div>`;
    }).join('')}</div>`;
  const sortedCats = Object.entries(data.categoryTotals).sort((a, b) => b[1] - a[1]);
  const maxCat = sortedCats.length > 0 ? sortedCats[0][1] : 1;
  document.getElementById('dash-category-chart').innerHTML = `<div class="bar-chart">${sortedCats.slice(0, 12).map(([cat, val], i) => {
    const budgetAmt = getBudgetForMonth(store, cat, month, year => ensureYearBudget(store, year));
    const pct = val / Math.max(maxCat, budgetAmt) * 100;
    const budgetPct = budgetAmt > 0 ? budgetAmt / Math.max(maxCat, budgetAmt) * 100 : 0;
    return `<div class="bar-row"><div class="bar-label" title="${esc(cat)}">${esc(cat)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(pct, 100)}%;background:${CHART_COLORS[i % CHART_COLORS.length]}"><span>${fmt(-val)}</span></div>
      ${budgetAmt > 0 ? `<div class="bar-budget-line" style="left:${Math.min(budgetPct, 100)}%" title="Budget: ${fmt(-budgetAmt)}"></div>` : ''}</div>
      <div class="bar-value">${fmt(-val)}</div></div>`;
  }).join('')}</div>`;
  const sortedMerchants = Object.entries(data.merchantTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById('dash-merchants').innerHTML = `<div style="display:flex;flex-direction:column;gap:4px">${sortedMerchants.map(([merchant, val]) =>
    `<div class="flex-between" style="padding:4px 0;border-bottom:1px solid var(--border)"><span class="text-sm">${esc(merchant)}</span><span class="text-sm mono fw-500">${fmt(-val)}</span></div>`
  ).join('')}</div>`;
  const maxTrend = Math.max(...data.trend.map(m => m.total), 1);
  document.getElementById('dash-trend').innerHTML = `<div style="display:flex;align-items:flex-end;gap:8px;height:150px;padding-top:10px">${data.trend.map(m => {
    const h = m.total / maxTrend * 120;
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
      <div class="text-xs mono fw-500">${fmt(-m.total)}</div>
      <div style="width:100%;height:${h}px;background:${m.month === month ? 'var(--accent)' : '#cbd5e1'};border-radius:4px 4px 0 0;min-height:2px;margin:4px 0"></div>
      <div class="text-xs text-muted">${m.month.slice(5)}</div></div>`;
  }).join('')}</div>`;
  const budgetHTML = [];
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
    cats.forEach(cat => {
      const budget = getBudgetForMonth(store, cat, month, year => ensureYearBudget(store, year));
      if (budget <= 0) return;
      const actual = data.categoryTotals[cat] || 0;
      const pct = Math.round(actual / budget * 100);
      const cls = pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok';
      budgetHTML.push(`<div class="budget-item">
        <div class="budget-header"><span class="budget-cat">${esc(cat)}</span><span class="budget-amount">${fmt(-actual)} / ${fmt(-budget)}</span></div>
        <div class="budget-progress"><div class="budget-progress-fill ${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
        <div class="budget-numbers"><span>${pct}%</span><span>${actual > budget ? `${fmt(-(actual - budget))} over` : `${fmt(-(budget - actual))} left`}</span></div>
      </div>`);
    });
  });
  document.getElementById('dash-budget').innerHTML = `<div class="budget-grid">${budgetHTML.join('') || '<p class="text-muted">No budgets set for this month.</p>'}</div>`;
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
  document.getElementById('year-summary').innerHTML = `<div class="surplus-card">
    <h2>${year} Overview${data.ytd.monthCount < 12 ? ` (${data.ytd.monthCount} months of data)` : ''}${store.salaryShiftDay ? ` <span class="text-xs text-muted">(salary-shifted day ${store.salaryShiftDay})</span>` : ''}</h2>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(0,0,0,0.06)">
      <span class="text-sm text-muted">Expected annual loan (SU-lån):</span>
      <input type="number" id="loan-budget-input" value="${data.annualLoanBudget}" min="0" step="100" style="width:120px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px" onchange="saveLoanBudget('${year}', this.value)">
      <span class="text-sm text-muted">kr/year</span>
    </div>
    <div class="surplus-row"><span class="surplus-label">YTD Income</span><span class="surplus-val" style="color:var(--green)">${fmt(data.ytd.income)}</span></div>
    ${data.ytd.loan > 0 || data.annualLoanBudget > 0 ? `<div class="surplus-row"><span class="surplus-label">YTD Loan inflow (SU-lån)</span><span class="surplus-val" style="color:var(--text2)">${fmt(data.ytd.loan)}${data.ytdLoanBudget > 0 ? ` / ${fmt(data.ytdLoanBudget)} expected` : ''}</span></div>` : ''}
    <div class="surplus-row"><span class="surplus-label">YTD Spending</span><span class="surplus-val" style="color:var(--red)">${fmt(-data.ytd.spend)}</span></div>
    <div class="surplus-row"><span class="surplus-label">YTD Saved / invested</span><span class="surplus-val" style="color:var(--purple)">${fmt(-data.ytd.save)}</span></div>
    <div class="surplus-row" style="border-top:1px solid rgba(0,0,0,0.06);padding-top:8px;margin-top:4px"><span class="surplus-label">YTD Budget (spending)</span><span class="surplus-val" style="color:var(--text2)">${fmt(-data.ytd.budget)}</span></div>
    <div class="surplus-row"><span class="surplus-label">${data.ytd.budget - data.ytd.spend >= 0 ? 'Under budget' : 'Over budget'}</span><span class="surplus-val" style="color:${data.ytd.budget - data.ytd.spend >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(data.ytd.budget - data.ytd.spend)}</span></div>
    <div class="surplus-row total"><span class="surplus-label">${data.ytd.remaining >= 0 ? 'YTD Remaining' : 'YTD Shortfall'}</span><span class="surplus-val" style="color:${data.ytd.remaining >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(data.ytd.remaining)}</span></div>
  </div>`;
  document.getElementById('year-stats').innerHTML = `
    <div class="stat-card"><div class="label">Annual Budget</div><div class="value">${fmt(-data.annual.budget)}</div><div class="sub">spending categories</div></div>
    <div class="stat-card"><div class="label">Avg Monthly Spend</div><div class="value negative">${fmt(-data.annual.avgSpend)}</div><div class="sub">over ${data.ytd.monthCount} month${data.ytd.monthCount !== 1 ? 's' : ''}</div></div>
    <div class="stat-card"><div class="label">Avg Monthly Income</div><div class="value positive">${fmt(data.annual.avgIncome)}</div></div>
    <div class="stat-card"><div class="label">Budget Used</div><div class="value ${data.ytd.spend <= data.ytd.budget ? 'positive' : 'negative'}">${data.annual.budget > 0 ? `${Math.round(data.ytd.spend / data.annual.budget * 100)}%` : '0%'}</div><div class="sub">of annual budget</div></div>
  `;
  const maxBar = Math.max(...data.monthData.map(m => Math.max(m.spend, m.budget)), 1);
  document.getElementById('year-monthly-bars').innerHTML = `<div style="display:flex;align-items:flex-end;gap:4px;height:180px;padding-top:10px">${data.monthData.map(m => {
    const hSpend = m.spend / maxBar * 140;
    const hBudget = m.budget / maxBar * 140;
    const isFuture = !m.hasActuals && !m.isPast;
    const barColor = isFuture ? '#e2e8f0' : (m.spend > m.budget && m.budget > 0 ? 'var(--red)' : 'var(--accent)');
    const displayAmt = isFuture ? m.budget : m.spend;
    const hDisplay = isFuture ? hBudget : hSpend;
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
      <div class="text-xs mono fw-500" style="font-size:10px;${isFuture ? 'color:var(--text2);font-style:italic' : ''}">${displayAmt > 0 ? fmtShort(displayAmt) : ''}</div>
      <div style="width:100%;position:relative">
        <div style="width:100%;height:${Math.max(hDisplay, 2)}px;background:${barColor};border-radius:4px 4px 0 0;min-height:2px;margin:2px 0;${isFuture ? 'opacity:0.5' : ''}"></div>
        ${!isFuture && m.budget > 0 ? `<div style="position:absolute;bottom:${hBudget}px;left:0;right:0;height:2px;background:var(--orange);border-radius:1px" title="Budget: ${fmtShort(m.budget)}"></div>` : ''}
      </div>
      <div class="text-xs text-muted">${m.month}</div></div>`;
  }).join('')}</div>
  <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--text2)">
    <span><span style="display:inline-block;width:12px;height:12px;background:var(--accent);border-radius:2px;vertical-align:middle;margin-right:4px"></span>Actual</span>
    <span><span style="display:inline-block;width:12px;height:2px;background:var(--orange);border-radius:1px;vertical-align:middle;margin-right:4px"></span>Budget</span>
    <span><span style="display:inline-block;width:12px;height:12px;background:#e2e8f0;border-radius:2px;vertical-align:middle;margin-right:4px;opacity:0.5"></span>Forecast (budget)</span>
  </div>`;
  const sortedCats = Object.entries(data.catTotals).sort((a, b) => b[1] - a[1]);
  const maxCat = sortedCats.length > 0 ? sortedCats[0][1] : 1;
  document.getElementById('year-category-chart').innerHTML = `<div class="bar-chart">${sortedCats.slice(0, 15).map(([cat, val], i) => {
    const budgetAmt = data.catBudgets[cat] || 0;
    const pct = val / Math.max(maxCat, budgetAmt) * 100;
    const budgetPct = budgetAmt > 0 ? budgetAmt / Math.max(maxCat, budgetAmt) * 100 : 0;
    return `<div class="bar-row"><div class="bar-label" title="${esc(cat)}">${esc(cat)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(pct, 100)}%;background:${CHART_COLORS[i % CHART_COLORS.length]}"><span>${fmt(-val)}</span></div>
      ${budgetAmt > 0 ? `<div class="bar-budget-line" style="left:${Math.min(budgetPct, 100)}%" title="Annual budget: ${fmt(-budgetAmt)}"></div>` : ''}</div>
      <div class="bar-value">${fmt(-val)}</div></div>`;
  }).join('')}</div>`;
  const budgetVsActual = [];
  Object.entries(store.categories).forEach(([group, cats]) => {
    if (group === SAVINGS_GROUP || group === INCOME_GROUP) return;
    cats.forEach(cat => {
      const budget = data.catBudgets[cat] || 0;
      if (budget <= 0 && !(data.catTotals[cat] > 0)) return;
      const actual = data.catTotals[cat] || 0;
      const pct = budget > 0 ? Math.round(actual / budget * 100) : (actual > 0 ? 999 : 0);
      const cls = pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok';
      budgetVsActual.push(`<div class="budget-item">
        <div class="budget-header"><span class="budget-cat">${esc(cat)}</span><span class="budget-amount">${fmt(-actual)} / ${fmt(-budget)}</span></div>
        <div class="budget-progress"><div class="budget-progress-fill ${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
        <div class="budget-numbers"><span>${pct}%</span><span>${actual > budget ? `${fmt(-(actual - budget))} over` : `${fmt(-(budget - actual))} left`}</span></div>
      </div>`);
    });
  });
  document.getElementById('year-budget-vs-actual').innerHTML = `<div class="budget-grid">${budgetVsActual.join('') || '<p class="text-muted">No budgets set.</p>'}</div>`;
  document.getElementById('year-forecast').innerHTML = data.forecast.futureMonthCount > 0 ? `<div class="surplus-card" style="background:linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%);border-color:#fbbf24">
    <h2>Year-End Forecast (${data.forecast.futureMonthCount} months projected)</h2>
    <p class="text-sm text-muted" style="margin-bottom:12px">Future spending uses budget. Future income and savings use the year-to-date average.${data.annualLoanBudget > 0 ? ' Loan uses the expected annual amount.' : ''}</p>
    <div class="surplus-row"><span class="surplus-label">Projected income</span><span class="surplus-val" style="color:var(--green)">${fmt(data.forecast.income)}</span></div>
    ${data.annualLoanBudget > 0 ? `<div class="surplus-row"><span class="surplus-label">Projected loan inflow</span><span class="surplus-val" style="color:var(--text2)">${fmt(data.forecast.loan)} / ${fmt(data.annualLoanBudget)} budgeted</span></div>` : ''}
    <div class="surplus-row"><span class="surplus-label">Projected spending</span><span class="surplus-val" style="color:var(--red)">${fmt(-data.forecast.spend)}</span></div>
    <div class="surplus-row"><span class="surplus-label">Projected savings</span><span class="surplus-val" style="color:var(--purple)">${fmt(-data.forecast.save)}</span></div>
    <div class="surplus-row total"><span class="surplus-label">${data.forecast.remaining >= 0 ? 'Projected remaining' : 'Projected shortfall'}</span><span class="surplus-val" style="color:${data.forecast.remaining >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(data.forecast.remaining)}</span></div>
  </div>` : '<p class="text-muted">Full year of data available, no forecast needed.</p>';
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
  const grandTotals = {};
  const savingTotals = {};
  MONTH_KEYS.forEach(m => {
    grandTotals[m] = 0;
    savingTotals[m] = 0;
  });
  Object.entries(store.categories).forEach(([group, cats]) => {
    html += `<tr class="group-row"><td colspan="${MONTHS.length + 3}">${esc(group)}</td></tr>`;
    cats.forEach(cat => {
      if (!yb[cat]) {
        yb[cat] = {};
        MONTH_KEYS.forEach(m => { yb[cat][m] = 0; });
      }
      let rowTotal = 0;
      html += `<tr><td>${esc(cat)}</td>`;
      MONTH_KEYS.forEach(m => {
        const val = yb[cat][m] || 0;
        rowTotal += val;
        if (group === SAVINGS_GROUP) savingTotals[m] += val;
        else if (group !== INCOME_GROUP) grandTotals[m] += val;
        html += `<td><input type="number" value="${val}" data-year="${year}" data-cat="${esc(cat)}" data-month="${m}"></td>`;
      });
      html += `<td class="col-total">${fmtShort(rowTotal)}</td><td class="col-avg">${fmtShort(Math.round(rowTotal / 12))}</td></tr>`;
    });
  });
  html += '<tr class="total-row"><td>Total Spending</td>';
  let annualTotal = 0;
  MONTH_KEYS.forEach(m => {
    html += `<td class="col-total">${fmtShort(grandTotals[m])}</td>`;
    annualTotal += grandTotals[m];
  });
  html += `<td class="col-total">${fmtShort(annualTotal)}</td><td class="col-avg">${fmtShort(Math.round(annualTotal / 12))}</td></tr>`;
  html += '<tr class="total-row"><td>Total Savings</td>';
  let annualSave = 0;
  MONTH_KEYS.forEach(m => {
    html += `<td class="col-total">${fmtShort(savingTotals[m])}</td>`;
    annualSave += savingTotals[m];
  });
  html += `<td class="col-total">${fmtShort(annualSave)}</td><td class="col-avg">${fmtShort(Math.round(annualSave / 12))}</td></tr>`;
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
  commit(null);
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
  }
  commit(`Filled ${cat} from ${MONTHS[startIdx]} onward with ${fmtShort(numericValue)}`);
}

function renderCategoryManager() {
  const container = document.getElementById('cat-manager');
  container.innerHTML = '';
  Object.entries(store.categories).forEach(([group, cats]) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'cat-list-group';
    groupDiv.innerHTML = `<h4>${esc(group)} (${cats.length})</h4>`;
    const listDiv = document.createElement('div');
    listDiv.className = 'cat-list';
    cats.forEach(cat => {
      const count = store.transactions.filter(tx => tx.category === cat).length;
      const item = document.createElement('div');
      item.className = 'cat-list-item';
      item.innerHTML = `<span>${esc(cat)} <span class="text-xs text-muted">(${count} txns)</span></span><div class="flex gap-8"></div>`;
      const btnWrap = item.querySelector('.flex');
      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn btn-sm';
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', () => renameCat(group, cat));
      btnWrap.appendChild(renameBtn);
      if (count === 0) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-danger';
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
  document.getElementById('modal-new-cat').classList.add('open');
  document.getElementById('new-cat-name').focus();
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
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
  URL.revokeObjectURL(a.href);
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
  const defaultDashMonth = months.includes(lastCompletedMonth) ? lastCompletedMonth : months[months.length - 1];
  dashMonth.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');
  dashMonth.value = months.includes(dashMonthValue) ? dashMonthValue : (defaultDashMonth || '');
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

function acceptSuggestion(el) {
  const txId = Number.parseInt(el.getAttribute('data-txid'), 10);
  const cat = el.getAttribute('data-cat');
  selectCategory(txId, cat);
}

function bindTabEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'dashboard') renderDashboard();
      if (tab.dataset.tab === 'transactions') renderTransactions();
      if (tab.dataset.tab === 'budgets') renderBudgetEditor();
      if (tab.dataset.tab === 'categories') renderCategoryManager();
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
    toggleCovered,
    updateCatFilter
  });
}

export function initApp() {
  const sanitized = sanitizeTransactions(store);
  if (sanitized > 0) persistStore();
  renderAppVersion();
  bindGlobalActions();
  bindTabEvents();
  bindImportEvents();
  bindBudgetEditorEvents();
  document.addEventListener('click', closeCatDropdowns);
  rerenderAll();
  if (sanitized > 0) toast(`Auto-cleared ${sanitized} mismatched category${sanitized !== 1 ? 's' : ''}.`);
}

export {
  getStore,
  rerenderAll as renderAllForTests,
  resolveMerchant
};
