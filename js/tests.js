import {
  CHART_COLORS,
  DEFAULT_CATEGORIES,
  ensureYearBudget,
  normalizeStore,
  getDefaultYearBudget,
  exportPayload
} from './store.js';
import {
  autoMatchMerchant,
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
      categories: { Variable: ['Groceries'], Income: ['SU'] },
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
    assert(store.categories['Income'].includes('SU'), 'Default income categories should be restored');
    assert(store.budgets['2026']['Transport'], 'Missing budget rows should be added');
    assert(store.merchantMap['FOOTEX'], 'Merchant map key should be normalized');
  });

  test('exportPayload includes current schema version', () => {
    const payload = exportPayload(createStore());
    assertEquals(payload.version, 3, 'Export should include schema version');
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

  test('getFilteredTransactions sorts uncategorized suggestions first', () => {
    const store = createStore({
      transactions: [
        { id: 1, date: '2026-02-10', amount: -50, merchant: 'Unknown', description: '', type: 'spending', category: '' },
        { id: 2, date: '2026-02-09', amount: -75, merchant: 'DSB', description: '', type: 'spending', category: '' },
        { id: 3, date: '2026-02-08', amount: -100, merchant: 'FOETEX', description: '', type: 'spending', category: '' }
      ]
    });
    const result = getFilteredTransactions({ month: 'all', category: 'all', type: 'all', uncategorizedOnly: true, search: '' }, store.transactions, store);
    assertEquals(result.filtered[0].merchant, 'DSB');
    assertEquals(result.filtered[1].merchant, 'FOETEX');
    assertEquals(result.filtered[2].merchant, 'Unknown');
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

runner.run();
