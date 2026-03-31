import {
  CHART_COLORS,
  DEFAULT_CATEGORIES,
  MONTH_KEYS,
  applyBudgetSideEffect,
  ensureYearBudget,
  normalizeStore,
  getDefaultYearBudget,
  exportPayload,
  resolveCategory,
  registerCategory
} from './store.js';
import {
  autoMatchMerchant,
  collapseSplitParent,
  deduplicateImport,
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
  getCategoryBudgetStatus,
  getLastCompletedMonth,
  getMonthRange,
  getEffectiveMonth,
  getMonthlyScorecardData,
  getSavingsProgressData,
  getOverspentCategories,
  getRecentMonths,
  getUniqueMonths,
  getYtdSavingsProgress,
  getYearlyDashboardData
} from './dashboard.js';

class TestRunner {
  constructor() {
    this.suites = [];
    this.results = { pass: 0, fail: 0, pending: 0, tests: [] };
  }

  suite(name, fn) {
    const tests = [];
    this.suites.push({ name, tests });
    const test = (testName, testFn) => tests.push({ name: testName, fn: testFn });
    test.skip = (testName, testFn) => tests.push({ name: testName, fn: testFn, skip: true });
    fn(test);
  }

  async run() {
    for (const suite of this.suites) {
      for (const test of suite.tests) {
        try {
          if (test.skip) {
            this.results.pending++;
            this.results.tests.push({ suite: suite.name, name: test.name, status: 'pending' });
          } else {
            await test.fn();
            this.results.pass++;
            this.results.tests.push({ suite: suite.name, name: test.name, status: 'pass' });
          }
        } catch (error) {
          this.results.fail++;
          this.results.tests.push({ suite: suite.name, name: test.name, status: 'fail', error: error.message });
        }
      }
    }
    this.render();
  }

  render() {
    const suitesContainer = document.getElementById('test-suites');
    const grouped = {};
    this.results.tests.forEach(test => {
      if (!grouped[test.suite]) grouped[test.suite] = [];
      grouped[test.suite].push(test);
    });
    suitesContainer.innerHTML = Object.entries(grouped).map(([suiteName, tests]) => {
      const suitePass = tests.filter(t => t.status === 'pass').length;
      return `<div class="test-suite">
        <div class="test-suite-header expanded" data-suite="${suiteName}">${suiteName} (${suitePass}/${tests.length})</div>
        <div class="test-list visible">${tests.map(test => {
          const statusClass = test.status === 'pass' ? 'pass' : test.status === 'fail' ? 'fail' : 'pending';
          const icon = test.status === 'pass' ? '✓' : test.status === 'fail' ? '✗' : '○';
          return `<div class="test-item ${statusClass}"><span>${icon}</span> ${test.name}${test.error ? `<code class="test-code">Error: ${escapeHtml(test.error)}</code>` : ''}</div>`;
        }).join('')}</div>
      </div>`;
    }).join('');
    document.querySelectorAll('.test-suite-header').forEach(el => {
      el.addEventListener('click', () => {
        const list = el.nextElementSibling;
        list.classList.toggle('visible');
        el.classList.toggle('expanded');
        el.classList.toggle('collapsed');
      });
    });
    document.getElementById('total-count').textContent = this.results.tests.length;
    document.getElementById('pass-count').textContent = this.results.pass;
    document.getElementById('fail-count').textContent = this.results.fail;
    document.getElementById('pending-count').textContent = this.results.pending;
    const total = this.results.tests.length || 1;
    document.getElementById('progress-fill').style.width = `${Math.round((this.results.pass / total) * 100)}%`;
  }
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expectedStr}, got ${actualStr}`);
  }
}

function createStore(overrides = {}) {
  return normalizeStore({
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    budgets: { '2026': getDefaultYearBudget() },
    transactions: [],
    merchantMap: {},
    loanBudget: {},
    salaryShiftDay: 0,
    nextId: 1,
    ...overrides
  });
}

const runner = new TestRunner();

runner.suite('Store normalization', test => {
  test('normalizeStore recomputes sparse nextId', () => {
    const store = normalizeStore({
      transactions: [{ id: 2 }, { id: 7 }, { id: 3 }],
      categories: { Variable: ['Groceries'], Income: ['Salary'] },
      budgets: {},
      merchantMap: {}
    });
    assertEquals(store.nextId, 8, 'nextId should be max id + 1');
  });

  test('normalizeStore rekeys merchantMap and backfills categories/budgets', () => {
    const store = normalizeStore({
      transactions: [],
      categories: { Variable: ['Groceries'] },
      budgets: { '2026': { Groceries: { '01': 100 } } },
      merchantMap: { 'Foo-tex ': { category: 'Groceries', type: 'spending' } }
    });
    assert(store.categories['Income'].includes('Salary'), 'Default income categories should be restored');
    assert(store.budgets['2026']['Transport'], 'Missing budget rows should be added');
    assert(store.merchantMap['FOOTEX'], 'Merchant map key should be normalized');
  });

  test('exportPayload includes current schema version', () => {
    const payload = exportPayload(createStore());
    assertEquals(payload.version, 4, 'Export should include schema version');
  });
});

runner.suite('Import and parsing', test => {
  test('resolveMerchant strips 2025 date suffix', () => {
    assertEquals(resolveMerchant('FOETEX Den 12.02', ''), 'FOETEX', 'Should strip date suffix');
  });

  test('resolveMerchant extracts Nordea pay merchant', () => {
    assertEquals(resolveMerchant('', 'Nordea pay køb, . DELI Den 12.02'), 'DELI', 'Should extract merchant');
  });

  test('parseNordeaCSV handles reserved rows', () => {
    const rows = parseNordeaCSV('Dato;Beløb;X;X;Navn;Tekst\nReserveret;-123,00;;;FOETEX;Groceries', '2026-03-07');
    assertEquals(rows[0].date, '2026-03-07', 'Reserved rows should use provided today date');
    assertEquals(rows[0].pending, true, 'Reserved rows should be marked pending');
  });

  test('txFingerprint identifies exact duplicates', () => {
    const tx = { date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries' };
    assertEquals(txFingerprint(tx), '2026-02-15|-100|FOETEX|Groceries');
  });
});

runner.suite('Transaction logic', test => {
  test('autoMatchMerchant honors normalized merchantMap key', () => {
    const store = createStore({
      merchantMap: { 'FOOTEX': { category: 'Groceries', type: 'spending' } }
    });
    const match = autoMatchMerchant('Foo-tex', -100, store);
    assertDeepEqual(match, { category: 'Groceries', type: 'spending' });
  });

  test('sanitizeTransactions clears sign-mismatched auto categories', () => {
    const store = createStore({
      transactions: [{ id: 1, amount: 5000, category: 'Groceries', type: 'spending', covered: false, manualCategory: false }]
    });
    const fixed = sanitizeTransactions(store);
    assertEquals(fixed, 1);
    assertEquals(store.transactions[0].category, '');
  });

  test('getFilteredTransactions excludes split parents and keeps children', () => {
    const store = createStore({
      transactions: [
        { id: 1, date: '2026-02-15', amount: -300, merchant: 'FOETEX', description: 'Parent', type: 'ignore', category: '', splitInto: [2, 3] },
        { id: 2, date: '2026-02-15', amount: -200, merchant: 'FOETEX', description: 'Child 1', type: 'spending', category: 'Groceries', splitFrom: 1 },
        { id: 3, date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Child 2', type: 'spending', category: 'Groceries', splitFrom: 1 }
      ]
    });
    const result = getFilteredTransactions({ month: 'all', category: 'all', type: 'all', uncategorizedOnly: false, search: '' }, store.transactions, store);
    assertEquals(result.filtered.length, 2);
    assert(result.filtered.every(tx => tx.id !== 1), 'Split parent should be excluded');
  });

  test('getFilteredTransactions returns uncategorized in date-descending order', () => {
    const store = createStore({
      transactions: [
        { id: 1, date: '2026-02-10', amount: -50, merchant: 'Unknown', description: '', type: 'spending', category: '' },
        { id: 2, date: '2026-02-09', amount: -75, merchant: 'DSB', description: '', type: 'spending', category: '' },
        { id: 3, date: '2026-02-08', amount: -100, merchant: 'FOETEX', description: '', type: 'spending', category: '' }
      ]
    });
    const result = getFilteredTransactions({ month: 'all', category: 'all', type: 'all', uncategorizedOnly: true, search: '' }, store.transactions, store);
    assertEquals(result.filtered[0].merchant, 'Unknown');
    assertEquals(result.filtered[1].merchant, 'DSB');
    assertEquals(result.filtered[2].merchant, 'FOETEX');
  });
});

runner.suite('Salary shift consistency', test => {
  test('getLastCompletedMonth returns the previous calendar month', () => {
    assertEquals(getLastCompletedMonth(new Date('2026-03-07T12:00:00Z')), '2026-02');
    assertEquals(getLastCompletedMonth(new Date('2026-01-03T12:00:00Z')), '2025-12');
  });

  test('getMonthRange returns contiguous months between endpoints', () => {
    assertDeepEqual(
      getMonthRange('2025-11', '2026-03'),
      ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03']
    );
  });

  test('getEarliestMonthForDashboard starts from the earliest budget year when it is older than transactions', () => {
    assertEquals(
      getEarliestMonthForDashboard(
        [{ date: '2025-04-15', amount: -100, type: 'spending' }],
        { '2025': {}, '2026': {} },
        0
      ),
      '2025-01'
    );
  });

  test('getMonthRange can include an in-progress current month while defaulting elsewhere', () => {
    assertDeepEqual(
      getMonthRange('2025-01', '2026-03').slice(-3),
      ['2026-01', '2026-02', '2026-03']
    );
  });

  test('getEffectiveMonth shifts qualifying income after cutoff', () => {
    const tx = { date: '2026-01-28', amount: 5000, type: 'income' };
    assertEquals(getEffectiveMonth(tx, 25), '2026-02');
  });

  test('getUniqueMonths returns effective months only', () => {
    const months = getUniqueMonths([
      { date: '2026-01-28', amount: 5000, type: 'income' },
      { date: '2026-01-10', amount: -1000, type: 'spending' }
    ], 25);
    assertDeepEqual(months, ['2026-01', '2026-02']);
  });

  test('getRecentMonths caps visible history to the latest 12 months', () => {
    const transactions = [];
    for (let offset = 0; offset < 16; offset++) {
      const date = new Date(Date.UTC(2024, 10 + offset, 15));
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      transactions.push({ date: `${year}-${month}-15`, amount: -100, type: 'spending' });
    }
    const months = getRecentMonths(transactions, 0);
    assertEquals(months.length, 12, 'Should only expose the last 12 months');
    assertEquals(months[0], '2025-03');
    assertEquals(months[11], '2026-02');
  });
});

runner.suite('Monthly scorecard', test => {
  function createScorecardStore() {
    const store = createStore({
      transactions: [
        { id: 1, date: '2026-02-01', amount: 22000, merchant: 'SU', description: '', type: 'income', category: 'SU', covered: false },
        { id: 2, date: '2026-02-03', amount: 3000, merchant: 'SU loan', description: '', type: 'loan', category: '', covered: false },
        { id: 3, date: '2026-02-02', amount: -4800, merchant: 'Landlord', description: '', type: 'spending', category: 'Rent + utilities', covered: false },
        { id: 4, date: '2026-02-04', amount: -173, merchant: 'OpenAI', description: '', type: 'spending', category: 'OpenAI', covered: false },
        { id: 5, date: '2026-02-08', amount: -2800, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 6, date: '2026-02-12', amount: -600, merchant: 'Restaurant', description: '', type: 'spending', category: 'Eating out', covered: false },
        { id: 7, date: '2026-02-15', amount: -1200, merchant: 'Pension transfer', description: '', type: 'saving', category: 'Pension', covered: false },
        { id: 8, date: '2026-02-20', amount: -900, merchant: 'Nordnet', description: '', type: 'saving', category: 'Investments', covered: false },
        { id: 9, date: '2026-02-22', amount: -700, merchant: 'Friend repayment', description: '', type: 'spending', category: 'Travel', covered: true }
      ]
    });

    store.categories['Fixed costs'].push('Rent + utilities');
    store.categories['Subscriptions'].push('OpenAI');
    ['Rent + utilities', 'OpenAI'].forEach(cat => {
      store.budgets['2026'][cat] = {};
      MONTH_KEYS.forEach(m => { store.budgets['2026'][cat][m] = 0; });
    });

    Object.keys(store.budgets['2026']).forEach(cat => {
      store.budgets['2026'][cat]['02'] = 0;
    });
    store.budgets['2026']['Rent + utilities']['02'] = 5000;
    store.budgets['2026']['OpenAI']['02'] = 173;
    store.budgets['2026']['Groceries']['02'] = 3200;
    store.budgets['2026']['Eating out']['02'] = 300;
    store.budgets['2026']['Travel']['02'] = 1500;

    return store;
  }

  test('separates true income, spending, cash savings, and investing for the scorecard', () => {
    const store = createScorecardStore();
    const result = getMonthlyScorecardData('2026-02', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.monthLabel, 'Feb 2026');
    assertEquals(result.monthShortLabel, 'Feb 26');
    assertEquals(result.totals.income, 22000, 'Loan inflows should not count as true income');
    assertEquals(result.totals.loanInflow, 3000);
    assertEquals(result.totals.spent, 8373);
    assertEquals(result.totals.cashSaved, 1200);
    assertEquals(result.totals.invested, 900);
    assertEquals(result.totals.remainingCash, 11527);
  });

  test('excludes covered items from headline metrics by default', () => {
    const store = createScorecardStore();
    const excluded = getMonthlyScorecardData('2026-02', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });
    const included = getMonthlyScorecardData('2026-02', {
      store,
      excludeCovered: false,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(excluded.totals.spent, 8373);
    assertEquals(included.totals.spent, 9073);
  });

  test('reports fixed versus discretionary spending separately', () => {
    const store = createScorecardStore();
    const result = getMonthlyScorecardData('2026-02', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertDeepEqual(result.spendingBreakdown, {
      fixed: { actual: 4973, budget: 5173 },
      discretionary: { actual: 3400, budget: 5000 }
    });
  });

  test('treats budget success independently from savings transfers', () => {
    const store = createScorecardStore();
    const result = getMonthlyScorecardData('2026-02', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.budget.total, 10173);
    assertEquals(result.budget.variance, 1800);
    assertEquals(result.budget.success, true);
    assertEquals(result.budget.overBudgetCategories.length, 1);
    assertEquals(result.budget.overBudgetCategories[0].category, 'Eating out');
    assertEquals(result.verdict.status, 'positive');
  });

  test('returns a negative verdict for an over-budget month', () => {
    const store = createScorecardStore();
    store.transactions.push({ id: 10, date: '2026-02-24', amount: -3000, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false });
    store.budgets['2026']['Nightlife']['02'] = 800;

    const result = getMonthlyScorecardData('2026-02', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.budget.success, false);
    assertEquals(result.verdict.status, 'negative');
    assert(result.verdict.summary.includes('Over budget'), 'Negative verdict should call out overspending');
  });
});

runner.suite('Budget diagnosis', test => {
  function createDiagnosisStore() {
    const store = createStore({
      transactions: [
        { id: 101, date: '2025-04-05', amount: -2100, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 102, date: '2025-05-05', amount: -2200, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 103, date: '2025-06-05', amount: -2300, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 104, date: '2025-07-05', amount: -2400, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 105, date: '2025-08-05', amount: -2500, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 106, date: '2025-09-05', amount: -2600, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 107, date: '2025-10-05', amount: -2700, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 108, date: '2025-11-05', amount: -2800, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 109, date: '2025-12-05', amount: -2900, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 1, date: '2026-01-05', amount: -3000, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 2, date: '2026-01-10', amount: -0, merchant: 'Cafe', description: '', type: 'spending', category: 'Eating out', covered: false },
        { id: 3, date: '2026-01-18', amount: -300, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },
        { id: 4, date: '2026-01-25', amount: -300, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },
        { id: 18, date: '2026-01-14', amount: -500, merchant: 'Train', description: '', type: 'spending', category: 'Travel', covered: false },

        { id: 5, date: '2026-02-05', amount: -3200, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 6, date: '2026-02-10', amount: -0, merchant: 'Cafe', description: '', type: 'spending', category: 'Eating out', covered: false },
        { id: 7, date: '2026-02-18', amount: -320, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },
        { id: 8, date: '2026-02-25', amount: -320, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },
        { id: 19, date: '2026-02-14', amount: -400, merchant: 'Train', description: '', type: 'spending', category: 'Travel', covered: false },

        { id: 9, date: '2026-03-05', amount: -3100, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 10, date: '2026-03-10', amount: -0, merchant: 'Trip', description: '', type: 'spending', category: 'Travel', covered: false },
        { id: 11, date: '2026-03-18', amount: -360, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },
        { id: 12, date: '2026-03-25', amount: -360, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },

        { id: 13, date: '2026-04-05', amount: -2900, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false },
        { id: 14, date: '2026-04-12', amount: -4500, merchant: 'Airline', description: '', type: 'spending', category: 'Travel', covered: false },
        { id: 15, date: '2026-04-18', amount: -430, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },
        { id: 16, date: '2026-04-22', amount: -430, merchant: 'Bar', description: '', type: 'spending', category: 'Nightlife', covered: false },
        { id: 17, date: '2026-04-09', amount: -320, merchant: 'Cafe', description: '', type: 'spending', category: 'Eating out', covered: false }
      ]
    });

    Object.keys(store.budgets['2026']).forEach(cat => {
      ['01', '02', '03', '04'].forEach(month => {
        store.budgets['2026'][cat][month] = 0;
      });
    });

    ['01', '02', '03', '04'].forEach(month => {
      store.budgets['2026']['Groceries'][month] = 2600;
      store.budgets['2026']['Eating out'][month] = 300;
      store.budgets['2026']['Nightlife'][month] = 600;
      store.budgets['2026']['Travel'][month] = 1500;
    });

    return store;
  }

  test('ranks overspent categories by budget impact', () => {
    const store = createDiagnosisStore();
    const result = getOverspentCategories('2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.length, 4);
    assertEquals(result[0].category, 'Travel');
    assertEquals(result[0].variance, 3000);
    assertEquals(result[1].category, 'Groceries');
    assertEquals(result[2].category, 'Nightlife');
    assertEquals(result[3].category, 'Eating out');
  });

  test('returns budget, last month, and trailing 3-month comparisons', () => {
    const store = createDiagnosisStore();
    const result = getCategoryComparisons('Nightlife', '2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.current.actual, 860);
    assertEquals(result.budget.amount, 600);
    assertEquals(result.previousMonth.actual, 720);
    assertEquals(result.threeMonthAverage.actual, 653.33);
  });

  test('returns a trailing 12-month average comparison when enough history exists', () => {
    const store = createDiagnosisStore();
    const result = getCategoryComparisons('Groceries', '2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.twelveMonthAverage.actual, 2650);
    assertEquals(result.twelveMonthAverage.varianceFromCurrent, 250);
  });

  test('classifies category over budget but below trailing average as budget issue', () => {
    const store = createDiagnosisStore();
    const result = classifyOverspendPattern('Groceries', '2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.code, 'budget-issue');
  });

  test('classifies one large transaction as one-off overspend', () => {
    const store = createDiagnosisStore();
    const result = classifyOverspendPattern('Travel', '2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.code, 'one-off');
  });

  test('classifies repeated small overspends as recurring habit', () => {
    const store = createDiagnosisStore();
    const result = classifyOverspendPattern('Nightlife', '2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.code, 'recurring-habit');
  });

  test('returns no-history when there is no meaningful prior data', () => {
    const store = createDiagnosisStore();
    const result = classifyOverspendPattern('Eating out', '2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.code, 'no-history');
  });

  test('returns category budget status for a single category', () => {
    const store = createDiagnosisStore();
    const result = getCategoryBudgetStatus('Groceries', '2026-04', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.actual, 2900);
    assertEquals(result.budget, 2600);
    assertEquals(result.variance, 300);
    assertEquals(result.isOverBudget, true);
  });
});

runner.suite('Savings and obligations', test => {
  function createProgressStore() {
    const store = createStore({
      transactions: [
        { id: 1, date: '2026-01-01', amount: 22000, merchant: 'SU', description: '', type: 'income', category: 'SU', covered: false },
        { id: 2, date: '2026-01-05', amount: -1200, merchant: 'Pension', description: '', type: 'saving', category: 'Pension', covered: false },
        { id: 3, date: '2026-01-12', amount: -800, merchant: 'Nordnet', description: '', type: 'saving', category: 'Investments', covered: false },
        { id: 4, date: '2026-01-15', amount: 3000, merchant: 'SU loan', description: '', type: 'loan', category: '', covered: false },

        { id: 5, date: '2026-02-01', amount: 22000, merchant: 'SU', description: '', type: 'income', category: 'SU', covered: false },
        { id: 6, date: '2026-02-05', amount: -0, merchant: 'Pension', description: '', type: 'saving', category: 'Pension', covered: false },
        { id: 7, date: '2026-02-12', amount: -1500, merchant: 'Nordnet', description: '', type: 'saving', category: 'Investments', covered: false },
        { id: 8, date: '2026-02-15', amount: 3000, merchant: 'SU loan', description: '', type: 'loan', category: '', covered: false },

        { id: 9, date: '2026-03-01', amount: 22000, merchant: 'SU', description: '', type: 'income', category: 'SU', covered: false },
        { id: 10, date: '2026-03-05', amount: -900, merchant: 'Pension', description: '', type: 'saving', category: 'Pension', covered: false },
        { id: 11, date: '2026-03-12', amount: -1100, merchant: 'Nordnet', description: '', type: 'saving', category: 'Investments', covered: false },
        { id: 12, date: '2026-03-20', amount: -600, merchant: 'Covered savings', description: '', type: 'saving', category: 'Pension', covered: true }
      ]
    });
    return store;
  }

  function createRecurringStore() {
    const store = createStore({
      transactions: [
        { id: 1, date: '2026-01-02', amount: -4800, merchant: 'Landlord', description: '', type: 'spending', category: 'Rent + utilities', covered: false },
        { id: 2, date: '2026-02-02', amount: -4820, merchant: 'Landlord', description: '', type: 'spending', category: 'Rent + utilities', covered: false },
        { id: 3, date: '2026-03-02', amount: -4790, merchant: 'Landlord', description: '', type: 'spending', category: 'Rent + utilities', covered: false },
        { id: 4, date: '2026-04-02', amount: -4810, merchant: 'Landlord', description: '', type: 'spending', category: 'Rent + utilities', covered: false },

        { id: 5, date: '2026-01-09', amount: -89, merchant: 'Apple', description: '', type: 'spending', category: 'iCloud', covered: false },
        { id: 6, date: '2026-02-09', amount: -89, merchant: 'Apple', description: '', type: 'spending', category: 'iCloud', covered: false },
        { id: 7, date: '2026-04-09', amount: -89, merchant: 'Apple', description: '', type: 'spending', category: 'iCloud', covered: false },

        { id: 8, date: '2025-04-15', amount: -671, merchant: 'Danmark', description: '', type: 'spending', category: 'Sygesikring Danmark', covered: false },
        { id: 9, date: '2026-04-15', amount: -671, merchant: 'Danmark', description: '', type: 'spending', category: 'Sygesikring Danmark', covered: false },

        { id: 10, date: '2026-01-04', amount: -120, merchant: 'Corner shop', description: '', type: 'spending', category: 'Other', covered: false },
        { id: 11, date: '2026-02-18', amount: -490, merchant: 'Corner shop', description: '', type: 'spending', category: 'Other', covered: false },
        { id: 12, date: '2026-04-25', amount: -180, merchant: 'Corner shop', description: '', type: 'spending', category: 'Other', covered: false }
      ]
    });
    store.categories['Fixed costs'].push('Rent + utilities');
    store.categories['Subscriptions'].push('iCloud');
    store.categories['Insurance'].push('Sygesikring Danmark');
    return store;
  }

  test('returns monthly savings progress with cash and investing separated', () => {
    const store = createProgressStore();
    const result = getSavingsProgressData('2026-03', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.month, '2026-03');
    assertEquals(result.monthly.cashSaved, 900);
    assertEquals(result.monthly.invested, 1100);
    assertEquals(result.monthly.total, 2000);
    assertEquals(result.monthly.loanInflow, 0);
  });

  test('returns ytd savings progress through the requested month', () => {
    const store = createProgressStore();
    const result = getYtdSavingsProgress('2026-03', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.ytd.cashSaved, 2100);
    assertEquals(result.ytd.invested, 3400);
    assertEquals(result.ytd.total, 5500);
    assertEquals(result.ytd.monthCount, 3);
    assertEquals(result.ytd.loanInflow, 6000);
  });

  test('treats investments-only months separately from cash savings', () => {
    const store = createProgressStore();
    const result = getSavingsProgressData('2026-02', {
      store,
      excludeCovered: true,
      ensureYearBudget: year => ensureYearBudget(store, year)
    });

    assertEquals(result.monthly.cashSaved, 0);
    assertEquals(result.monthly.invested, 1500);
  });

  test('detects monthly recurring obligations with slight amount variation', () => {
    const store = createRecurringStore();
    const result = detectRecurringObligations({
      store,
      asOfDate: '2026-05-20',
      excludeCovered: true
    });

    const rent = result.find(item => item.category === 'Rent + utilities');
    assert(rent, 'Rent should be detected as recurring');
    assertEquals(rent.cadence, 'monthly');
    assertEquals(rent.fixed, true);
    assertEquals(rent.typicalAmount, 4805);
    assertEquals(rent.nextExpectedDate, '2026-05-02');
  });

  test('does not show monthly subscriptions that were not active in the last full month', () => {
    const store = createRecurringStore();
    const result = detectRecurringObligations({
      store,
      asOfDate: '2026-04-20',
      excludeCovered: true
    });

    const cloud = result.find(item => item.category === 'iCloud');
    assertEquals(!!cloud, false);
  });

  test('detects annual obligations separately', () => {
    const store = createRecurringStore();
    const result = detectRecurringObligations({
      store,
      asOfDate: '2026-05-20',
      excludeCovered: true
    });

    const annual = result.find(item => item.category === 'Sygesikring Danmark');
    assert(annual, 'Annual insurance should be detected');
    assertEquals(annual.cadence, 'annual');
    assertEquals(annual.fixed, true);
  });

  test('does not over-detect irregular spending as recurring', () => {
    const store = createRecurringStore();
    const result = detectRecurringObligations({
      store,
      asOfDate: '2026-05-20',
      excludeCovered: true
    });

    assertEquals(result.some(item => item.category === 'Other'), false);
  });

  test('does not show stale recurring payments that have stopped', () => {
    const store = createRecurringStore();
    store.transactions.push(
      { id: 13, date: '2025-10-07', amount: -173, merchant: 'OpenAI', description: '', type: 'spending', category: 'OpenAI', covered: false },
      { id: 14, date: '2025-11-07', amount: -173, merchant: 'OpenAI', description: '', type: 'spending', category: 'OpenAI', covered: false },
      { id: 15, date: '2025-12-07', amount: -173, merchant: 'OpenAI', description: '', type: 'spending', category: 'OpenAI', covered: false }
    );

    const result = detectRecurringObligations({
      store,
      asOfDate: '2026-05-20',
      excludeCovered: true
    });

    assertEquals(result.some(item => item.category === 'OpenAI'), false);
  });
});

runner.suite('Yearly dashboard', test => {
  test('forecast loan is numeric and uses annual loan budget', () => {
    const store = createStore({
      loanBudget: { '2026': 24000 },
      transactions: [
        { id: 1, date: '2026-01-15', amount: 5000, type: 'income' },
        { id: 2, date: '2026-01-15', amount: 2000, type: 'loan' },
        { id: 3, date: '2026-01-15', amount: -3000, type: 'spending' },
        { id: 4, date: '2026-02-15', amount: 5000, type: 'income' },
        { id: 5, date: '2026-02-15', amount: 2000, type: 'loan' },
        { id: 6, date: '2026-02-15', amount: -3500, type: 'spending' }
      ]
    });
    const result = getYearlyDashboardData('2026', {
      excludeCovered: false,
      transactions: store.transactions,
      budgets: store.budgets,
      categories: store.categories,
      loanBudget: store.loanBudget,
      currentDate: new Date('2026-02-15')
    });
    assert(Number.isFinite(result.forecast.loan), 'Forecast loan should be finite');
    assertEquals(result.forecast.loan, 24000);
  });

  test('excludeCovered omits covered spending from yearly totals', () => {
    const store = createStore({
      transactions: [
        { id: 1, date: '2026-01-15', amount: -1000, type: 'spending', covered: false },
        { id: 2, date: '2026-01-20', amount: -500, type: 'spending', covered: true }
      ]
    });
    const result = getYearlyDashboardData('2026', {
      excludeCovered: true,
      transactions: store.transactions,
      budgets: store.budgets,
      categories: store.categories,
      loanBudget: store.loanBudget
    });
    assertEquals(result.ytd.spend, 1000);
  });
});

runner.suite('Shared constants', test => {
  test('CHART_COLORS has 12 entries', () => {
    assertEquals(CHART_COLORS.length, 12);
  });

  test('CHART_COLORS are valid hex colors', () => {
    assert(CHART_COLORS.every(color => /^#[0-9a-fA-F]{6}$/.test(color)), 'All colors should be hex');
  });
});

// ── Phase 1: Category resolution and alias system ──

runner.suite('Category resolution', test => {
  test('resolveCategory returns name unchanged when no alias exists', () => {
    const store = createStore();
    assertEquals(resolveCategory('Groceries', store), 'Groceries');
  });

  test('resolveCategory resolves through aliases', () => {
    const store = createStore({ categoryAliases: { 'Transport': 'Commute' } });
    assertEquals(resolveCategory('Transport', store), 'Commute');
  });

  test('resolveCategory returns empty for deleted categories', () => {
    const store = createStore({ deletedCategories: ['Fun'] });
    assertEquals(resolveCategory('Fun', store), '');
  });

  test('resolveCategory returns empty when alias points to deleted category', () => {
    const store = createStore({
      categoryAliases: { 'OldName': 'NewName' },
      deletedCategories: ['NewName']
    });
    assertEquals(resolveCategory('OldName', store), '');
  });

  test('resolveCategory handles empty and null input', () => {
    const store = createStore();
    assertEquals(resolveCategory('', store), '');
    assertEquals(resolveCategory(null, store), '');
    assertEquals(resolveCategory(undefined, store), '');
  });

  test('registerCategory auto-registers unknown spending category as Variable', () => {
    const store = createStore();
    registerCategory('Rent + utilities', 'spending', store);
    assert(store.categories['Variable'].includes('Rent + utilities'), 'Should appear in Variable group');
  });

  test('registerCategory creates budget rows for newly registered categories', () => {
    const store = createStore();
    registerCategory('OpenAI', 'spending', store);
    assert(store.budgets['2026']['OpenAI'], 'Budget row should exist');
    assertEquals(store.budgets['2026']['OpenAI']['01'], 0);
  });

  test('registerCategory does not duplicate existing categories', () => {
    const store = createStore();
    const before = store.categories['Variable'].length;
    registerCategory('Groceries', 'spending', store);
    assertEquals(store.categories['Variable'].length, before);
  });

  test('registerCategory places income categories in Income group', () => {
    const store = createStore();
    registerCategory('SU', 'income', store);
    assert(store.categories['Income'].includes('SU'));
  });

  test('registerCategory places saving categories in Savings group', () => {
    const store = createStore();
    registerCategory('Pension', 'saving', store);
    assert(store.categories['Savings'].includes('Pension'));
  });

  test('resolveCategory resolves renamed default categories that are also tombstoned', () => {
    const store = createStore({
      categoryAliases: { 'Transport': 'Commute' },
      deletedCategories: ['Transport']
    });
    assertEquals(resolveCategory('Transport', store), 'Commute', 'Alias should take priority over tombstone');
  });

  test('normalizeStore adds categoryAliases to v3 stores', () => {
    const store = normalizeStore({
      transactions: [],
      categories: { Variable: ['Groceries'] },
      budgets: {},
      merchantMap: {}
    });
    assertDeepEqual(store.categoryAliases, {});
  });

  test('normalizeStore preserves existing categoryAliases', () => {
    const store = normalizeStore({
      transactions: [],
      categories: { Variable: ['Groceries'] },
      budgets: {},
      merchantMap: {},
      categoryAliases: { 'Transport': 'Commute' }
    });
    assertEquals(store.categoryAliases['Transport'], 'Commute');
  });
});

runner.suite('Budget side effects', test => {
  test('applyBudgetSideEffect calculates Feriepenge as 12.5% of Part-time job', () => {
    const store = createStore();
    ensureYearBudget(store, '2026');
    store.budgets['2026']['Feriepenge'] = {};
    MONTH_KEYS.forEach(m => { store.budgets['2026']['Feriepenge'][m] = 0; });
    applyBudgetSideEffect(store.budgets, '2026', 'Part-time job', '01', 10000);
    assertEquals(store.budgets['2026']['Feriepenge']['01'], 1250);
  });

  test('applyBudgetSideEffect creates Feriepenge row if missing', () => {
    const store = createStore();
    ensureYearBudget(store, '2026');
    delete store.budgets['2026']['Feriepenge'];
    applyBudgetSideEffect(store.budgets, '2026', 'Part-time job', '03', 8000);
    assert(store.budgets['2026']['Feriepenge'], 'Feriepenge row should be created');
    assertEquals(store.budgets['2026']['Feriepenge']['03'], 1000);
  });

  test('applyBudgetSideEffect does nothing for non-Part-time-job categories', () => {
    const store = createStore();
    ensureYearBudget(store, '2026');
    const ferieVal = store.budgets['2026']['Feriepenge']?.['01'] || 0;
    applyBudgetSideEffect(store.budgets, '2026', 'Groceries', '01', 2000);
    assertEquals(store.budgets['2026']['Feriepenge']?.['01'] || 0, ferieVal);
  });
});

runner.suite('autoMatchMerchant with aliases', test => {
  test('autoMatchMerchant resolves pattern categories through aliases', () => {
    const store = createStore({ categoryAliases: { 'Transport': 'Commute' } });
    const match = autoMatchMerchant('DSB', -100, store);
    assertEquals(match.category, 'Commute');
  });

  test('autoMatchMerchant skips patterns for deleted categories', () => {
    const store = createStore({ deletedCategories: ['Fun'] });
    const match = autoMatchMerchant('EVENTIM', -50, store);
    assertEquals(match, null);
  });

  test('autoMatchMerchant resolves merchantMap categories through aliases', () => {
    const store = createStore({
      merchantMap: { 'FOOTEX': { category: 'OldName', type: 'spending' } },
      categoryAliases: { 'OldName': 'NewName' }
    });
    const match = autoMatchMerchant('Foo-tex', -100, store);
    assertEquals(match.category, 'NewName');
  });

  test('autoMatchMerchant skips merchantMap entries for deleted categories', () => {
    const store = createStore({
      merchantMap: { 'FOOTEX': { category: 'Deleted', type: 'spending' } },
      deletedCategories: ['Deleted']
    });
    const match = autoMatchMerchant('Foo-tex', -100, store);
    assertEquals(match, null);
  });
});

// ── Phase 2: Month semantics and yearly math ──

runner.suite('Transaction filtering with salary shift', test => {
  test('getFilteredTransactions respects salary shift for month filtering', () => {
    const store = createStore({
      salaryShiftDay: 25,
      transactions: [
        { id: 1, date: '2026-01-28', amount: 22000, merchant: 'Employer', description: '', type: 'income', category: 'Salary', covered: false }
      ]
    });
    const resultFeb = getFilteredTransactions(
      { month: '2026-02', category: 'all', type: 'all', uncategorizedOnly: false, search: '' },
      store.transactions, store
    );
    assertEquals(resultFeb.filtered.length, 1, 'Salary-shifted income should appear in February');

    const resultJan = getFilteredTransactions(
      { month: '2026-01', category: 'all', type: 'all', uncategorizedOnly: false, search: '' },
      store.transactions, store
    );
    assertEquals(resultJan.filtered.length, 0, 'Salary-shifted income should not appear in January');
  });

  test('getFilteredTransactions does not shift spending transactions', () => {
    const store = createStore({
      salaryShiftDay: 25,
      transactions: [
        { id: 1, date: '2026-01-28', amount: -100, merchant: 'FOETEX', description: '', type: 'spending', category: 'Groceries', covered: false }
      ]
    });
    const resultJan = getFilteredTransactions(
      { month: '2026-01', category: 'all', type: 'all', uncategorizedOnly: false, search: '' },
      store.transactions, store
    );
    assertEquals(resultJan.filtered.length, 1, 'Spending should stay in January');
  });
});

runner.suite('Yearly dashboard sparse month handling', test => {
  test('sparse year with Jan+Mar data includes Feb budget in YTD', () => {
    const transactions = [
      { id: 1, date: '2026-01-05', amount: -1000, merchant: 'A', description: '', type: 'spending', category: 'Groceries', covered: false },
      { id: 2, date: '2026-01-10', amount: 20000, merchant: 'SU', description: '', type: 'income', category: 'Salary', covered: false },
      { id: 3, date: '2026-03-05', amount: -1200, merchant: 'B', description: '', type: 'spending', category: 'Groceries', covered: false },
      { id: 4, date: '2026-03-10', amount: 20000, merchant: 'SU', description: '', type: 'income', category: 'Salary', covered: false }
    ];
    const store = createStore({ transactions });
    ['01', '02', '03'].forEach(m => { store.budgets['2026']['Groceries'][m] = 2000; });

    const result = getYearlyDashboardData('2026', {
      transactions: store.transactions,
      budgets: store.budgets,
      categories: store.categories,
      loanBudget: {},
      currentDate: new Date('2026-03-15'),
      salaryShiftDay: 0,
      excludeCovered: false
    });

    assertEquals(result.ytd.elapsedMonthCount, 3, 'Elapsed months should be 3 (Jan, Feb, Mar)');
    assertEquals(result.ytd.dataMonthCount, 2, 'Data months should be 2 (Jan, Mar)');
    assert(result.ytd.budget >= 6000, 'YTD budget should include all 3 elapsed months');
  });

  test('forecast averages use elapsed month count for conservative estimates', () => {
    const transactions = [
      { id: 1, date: '2026-01-05', amount: 30000, merchant: 'SU', description: '', type: 'income', category: 'Salary', covered: false },
      { id: 2, date: '2026-03-05', amount: 30000, merchant: 'SU', description: '', type: 'income', category: 'Salary', covered: false }
    ];
    const store = createStore({ transactions });

    const result = getYearlyDashboardData('2026', {
      transactions: store.transactions,
      budgets: store.budgets,
      categories: store.categories,
      loanBudget: {},
      currentDate: new Date('2026-03-15'),
      salaryShiftDay: 0,
      excludeCovered: false
    });

    assertEquals(result.annual.avgIncome, 20000, 'Average income should be 60000/3 elapsed months');
  });

  test('past year treats all 12 months as elapsed', () => {
    const transactions = [
      { id: 1, date: '2025-06-15', amount: -500, merchant: 'Test', description: '', type: 'spending', category: 'Groceries', covered: false }
    ];
    const store = createStore({ transactions });
    ensureYearBudget(store, '2025');

    const result = getYearlyDashboardData('2025', {
      transactions: store.transactions,
      budgets: store.budgets,
      categories: store.categories,
      loanBudget: {},
      currentDate: new Date('2026-03-15'),
      salaryShiftDay: 0,
      excludeCovered: false
    });

    assertEquals(result.ytd.elapsedMonthCount, 12, 'Past year should have 12 elapsed months');
    assertEquals(result.ytd.dataMonthCount, 1, 'Only one month has data');
  });
});

// ── Phase 3: Import dedup and split mutation safety ──

runner.suite('Import deduplication', test => {
  test('count-aware dedupe allows legitimate identical transactions', () => {
    const existing = [
      { id: 1, date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries', type: 'spending' }
    ];
    const newRows = [
      { date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries' },
      { date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries' }
    ];
    const result = deduplicateImport(existing, newRows);
    assertEquals(result.duplicates.length, 1, 'First occurrence is a duplicate of existing');
    assertEquals(result.fresh.length, 1, 'Second occurrence is fresh');
  });

  test('all-new transactions pass through as fresh', () => {
    const existing = [];
    const newRows = [
      { date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries' },
      { date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries' }
    ];
    const result = deduplicateImport(existing, newRows);
    assertEquals(result.fresh.length, 2);
    assertEquals(result.duplicates.length, 0);
  });

  test('exact match count blocks all duplicates', () => {
    const existing = [
      { id: 1, date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries', type: 'spending' },
      { id: 2, date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries', type: 'spending' }
    ];
    const newRows = [
      { date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries' },
      { date: '2026-02-15', amount: -100, merchant: 'FOETEX', description: 'Groceries' }
    ];
    const result = deduplicateImport(existing, newRows);
    assertEquals(result.duplicates.length, 2, 'Both should be duplicates');
    assertEquals(result.fresh.length, 0);
  });

  test('split transactions are excluded from existing fingerprint counts', () => {
    const existing = [
      { id: 1, date: '2026-02-15', amount: -300, merchant: 'FOETEX', description: 'Groceries', splitInto: [2, 3] },
      { id: 4, date: '2026-02-15', amount: -300, merchant: 'FOETEX', description: 'Groceries', type: 'spending' }
    ];
    const newRows = [
      { date: '2026-02-15', amount: -300, merchant: 'FOETEX', description: 'Groceries' }
    ];
    const result = deduplicateImport(existing, newRows);
    assertEquals(result.duplicates.length, 1, 'Should match the non-split existing tx');
  });
});

runner.suite('Split mutation safety', test => {
  test('collapseSplitParent uses child amount, not parent amount', () => {
    const parent = { id: 1, amount: -300, category: 'Groceries', type: 'spending' };
    const child = { id: 3, amount: -100, category: 'Transport', type: 'spending', manualCategory: true, covered: false };
    const result = collapseSplitParent(parent, child);
    assertEquals(result.amount, -100, 'Should use child amount');
    assertEquals(result.category, 'Transport', 'Should use child category');
    assertEquals(result.type, 'spending');
    assertEquals(result.manualCategory, true);
  });

  test('collapseSplitParent preserves total after collapse', () => {
    const parent = { id: 1, amount: -300 };
    const childA = { id: 2, amount: -200, category: 'Groceries', type: 'spending', manualCategory: false, covered: false };
    const childB = { id: 3, amount: -100, category: 'Transport', type: 'spending', manualCategory: false, covered: false };
    const collapsed = collapseSplitParent(parent, childB);
    assertEquals(collapsed.amount, -100, 'Collapsed parent should have surviving child amount, not original -300');
  });

  test('collapseSplitParent handles income child', () => {
    const parent = { id: 1, amount: 500 };
    const child = { id: 2, amount: 200, category: 'Reimbursement', type: 'income', manualCategory: false, covered: false };
    const result = collapseSplitParent(parent, child);
    assertEquals(result.amount, 200);
    assertEquals(result.type, 'income');
  });
});

runner.run();
