import {
  CHART_COLORS,
  DEFAULT_CATEGORIES,
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
  getEffectiveMonth,
  getRecentMonths,
  getUniqueMonths,
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
