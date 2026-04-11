import {
  DEFAULT_CATEGORIES,
  INCOME_GROUP,
  getEffectiveMonth,
  normalizeMerchantName,
  resolveCategory
} from './store.js';

export const MERCHANT_PATTERNS = [
  { p: 'SAMVIRKENDE BOLIGSEL', c: 'Rent + utilities', t: 'spending' },
  { p: 'DSB', c: 'Transport', t: 'spending' },
  { p: 'BUS/MRT', c: 'Transport', t: 'spending' },
  { p: 'GREENMOBILITY', c: 'Transport', t: 'spending' },
  { p: 'YOUSEE', c: 'Mobile', t: 'spending' },
  { p: 'FIBERBY', c: 'Internet', t: 'spending' },
  { p: 'LOUIS NIELSEN', c: 'Contacts', t: 'spending' },
  { p: 'HAFNIA-HALLEN', c: 'Gym', t: 'spending' },
  { p: 'CLASSPASS', c: 'Gym', t: 'spending' },
  { p: 'KAB', c: 'KAB venteliste', t: 'spending', x: true },
  { p: 'APPLE.COM/BILL', c: 'iCloud', t: 'spending' },
  { p: 'OPENAI', c: 'OpenAI', t: 'spending' },
  { p: 'WWW.F1.COM', c: 'F1TV', t: 'spending' },
  { p: 'EA *ELECTRONIC ARTS', c: 'EA Play Pro', t: 'spending' },
  { p: 'MICROSOFT*MICROSOFT 365', c: 'M365', t: 'spending' },
  { p: 'MICROSOFT*M365', c: 'M365', t: 'spending' },
  { p: 'MICROSOFT 365', c: 'M365', t: 'spending' },
  { p: 'Google One', c: 'Google', t: 'spending' },
  { p: 'WHOOP', c: 'WHOOP', t: 'spending' },
  { p: 'TOPDANMARK', c: 'Accident insurance', t: 'spending' },
  { p: 'TRYG FORSIKRING', c: 'Hövding forsikring', t: 'spending' },
  { p: 'SYGEFORSIKRINGEN', c: 'Sygesikring Danmark', t: 'spending' },
  { p: 'FOETEX', c: 'Groceries', t: 'spending' },
  { p: 'FØTEX', c: 'Groceries', t: 'spending' },
  { p: 'COOP', c: 'Groceries', t: 'spending' },
  { p: 'REMA1000', c: 'Groceries', t: 'spending' },
  { p: 'SPAR ', c: 'Groceries', t: 'spending' },
  { p: 'NEMLIG.COM', c: 'Groceries', t: 'spending' },
  { p: 'HAMMELSTRUPVEJ FDB', c: 'Groceries', t: 'spending' },
  { p: 'DAGLI BRUGSEN', c: 'Groceries', t: 'spending' },
  { p: 'NETTO', c: 'Groceries', t: 'spending' },
  { p: 'SUPERBRUGSEN', c: 'Groceries', t: 'spending' },
  { p: 'LABC DEL GUSTO', c: 'Groceries', t: 'spending' },
  { p: 'MARKS&SPENCER', c: 'Groceries', t: 'spending' },
  { p: 'MARKS & SPENCER', c: 'Groceries', t: 'spending' },
  { p: 'M&S SIMPLY FOOD', c: 'Groceries', t: 'spending' },
  { p: 'SAINSBURY', c: 'Groceries', t: 'spending' },
  { p: 'KANTINEN CBS', c: 'Eating out', t: 'spending' },
  { p: 'Wolt', c: 'Eating out', t: 'spending', x: true },
  { p: 'Wolt Savings', c: 'Eating out', t: 'spending' },
  { p: 'MIO', c: 'Eating out', t: 'spending', x: true },
  { p: 'PIZZA OTTO', c: 'Eating out', t: 'spending' },
  { p: 'PITANORDIC', c: 'Eating out', t: 'spending' },
  { p: 'CIBO AMAGER', c: 'Eating out', t: 'spending' },
  { p: 'CAFE GAVLEN', c: 'Eating out', t: 'spending' },
  { p: 'CAFE KOB', c: 'Eating out', t: 'spending' },
  { p: 'CAFE NEXUS', c: 'Eating out', t: 'spending' },
  { p: 'Original Coffee', c: 'Eating out', t: 'spending' },
  { p: 'DELPHINE', c: 'Eating out', t: 'spending' },
  { p: 'GARBANZO', c: 'Eating out', t: 'spending' },
  { p: 'Mr Ramen', c: 'Eating out', t: 'spending' },
  { p: 'Kazuki', c: 'Eating out', t: 'spending' },
  { p: 'DURUM BAR', c: 'Eating out', t: 'spending' },
  { p: 'Durumbar', c: 'Eating out', t: 'spending' },
  { p: 'POELSEVOGN', c: 'Eating out', t: 'spending' },
  { p: 'BAGERDYGTIGT', c: 'Eating out', t: 'spending' },
  { p: 'KALDEREN', c: 'Eating out', t: 'spending' },
  { p: 'KUNG FU NOODLE', c: 'Eating out', t: 'spending' },
  { p: 'BONE DADDIES', c: 'Eating out', t: 'spending' },
  { p: 'SUBWAY', c: 'Eating out', t: 'spending' },
  { p: 'MCDVALBY', c: 'Eating out', t: 'spending' },
  { p: 'MCSVEJK', c: 'Eating out', t: 'spending' },
  { p: 'SUSHI-TEI', c: 'Eating out', t: 'spending' },
  { p: 'SILVER BEACH RESORT', c: 'Eating out', t: 'spending' },
  { p: 'HMSHost', c: 'Eating out', t: 'spending' },
  { p: 'NET*AH TONG', c: 'Eating out', t: 'spending' },
  { p: '7-ELEVEN', c: 'Eating out', t: 'spending' },
  { p: 'PS BAR & GRILL', c: 'Nightlife', t: 'spending' },
  { p: 'JOLENE BAR', c: 'Nightlife', t: 'spending' },
  { p: 'GLOBE IRISH PUB', c: 'Nightlife', t: 'spending' },
  { p: 'Bottega Barlie', c: 'Nightlife', t: 'spending' },
  { p: 'NIGHTPAY', c: 'Nightlife', t: 'spending' },
  { p: 'BLUME', c: 'Nightlife', t: 'spending' },
  { p: 'Soho House', c: 'Nightlife', t: 'spending' },
  { p: 'POOLEN', c: 'Nightlife', t: 'spending' },
  { p: 'BARKOWSKI', c: 'Nightlife', t: 'spending' },
  { p: 'SOUND CLUB', c: 'Nightlife', t: 'spending' },
  { p: 'Cafe Moenten', c: 'Nightlife', t: 'spending' },
  { p: 'CAFE DAN TURELL', c: 'Nightlife', t: 'spending' },
  { p: 'Sigurd CPH', c: 'Nightlife', t: 'spending' },
  { p: 'GOTHERSGADE 35', c: 'Nightlife', t: 'spending' },
  { p: 'LOOMISP', c: 'Nightlife', t: 'spending' },
  { p: 'CHURCHILL ARMS', c: 'Nightlife', t: 'spending' },
  { p: 'NIKKI BEACH', c: 'Nightlife', t: 'spending' },
  { p: 'TAXA 4X35', c: 'Nightlife', t: 'spending' },
  { p: 'H9', c: 'Nightlife', t: 'spending', x: true },
  { p: 'CE LA VI', c: 'Nightlife', t: 'spending' },
  { p: 'DONT TRY PTE', c: 'Nightlife', t: 'spending' },
  { p: 'KILO KITCHEN', c: 'Nightlife', t: 'spending' },
  { p: 'TST-Village', c: 'Nightlife', t: 'spending' },
  { p: 'SQ *VILLAGE', c: 'Nightlife', t: 'spending' },
  { p: 'DINES* TRAF', c: 'Nightlife', t: 'spending' },
  { p: 'The Starman', c: 'Nightlife', t: 'spending' },
  { p: 'EB *BEHIND THE GREEN', c: 'Nightlife', t: 'spending' },
  { p: 'KABABJI', c: 'Nightlife', t: 'spending' },
  { p: 'QDF', c: 'Nightlife', t: 'spending' },
  { p: 'UBER *TRIP', c: 'Nightlife', t: 'spending' },
  { p: 'UBR* PENDING.UBER', c: 'Nightlife', t: 'spending' },
  { p: 'Revolut', c: 'Transfer out', t: 'spending' },
  { p: 'EVENTIM', c: 'Fun', t: 'spending' },
  { p: 'GEBR. HEINEMANN', c: 'Travel', t: 'spending' },
  { p: 'IKEA', c: 'Home', t: 'spending' },
  { p: 'BAUHAUS', c: 'Home', t: 'spending' },
  { p: 'SILVAN', c: 'Home', t: 'spending' },
  { p: 'JYSK', c: 'Home', t: 'spending' },
  { p: 'PROSHOP', c: 'Home', t: 'spending' },
  { p: 'SOSTRENE GRENE', c: 'Home', t: 'spending' },
  { p: 'SOESTRENE GRENE', c: 'Home', t: 'spending' },
  { p: 'STANSTED EXPRESS', c: 'Travel', t: 'spending' },
  { p: 'TFL TRAVEL', c: 'Transport', t: 'spending' },
  { p: 'CPH Airport', c: 'Gift cost', t: 'spending' },
  { p: 'MATAS', c: 'Skincare', t: 'spending' },
  { p: 'WATSONS', c: 'Skincare', t: 'spending' },
  { p: 'CHAROENSUK', c: 'Skincare', t: 'spending' },
  { p: 'LAMPHU THAI', c: 'Vitamins', t: 'spending' },
  { p: 'HOLLAND AND BARRETT', c: 'Vitamins', t: 'spending' },
  { p: 'STENO APOTEK', c: 'Pharmacy', t: 'spending' },
  { p: 'WWW.E-VASKERI', c: 'Laundry', t: 'spending' },
  { p: 'BILLETLUGEN', c: 'Fun', t: 'spending' },
  { p: 'WATERSTONES', c: 'Fun', t: 'spending' },
  { p: 'MATCHi', c: 'Fun', t: 'spending' },
  { p: 'Vue Entertainment', c: 'Fun', t: 'spending' },
  { p: 'LOVABLE', c: 'Fun', t: 'spending' },
  { p: 'Swarovski', c: 'Gift cost', t: 'spending' },
  { p: 'Nordnet', c: 'Investments', t: 'saving' },
  { p: 'ASK invest', c: 'Investments', t: 'saving' },
  { p: 'FK-Feriepenge', c: 'Feriepenge', t: 'income' },
  { p: 'SU', c: 'SU', t: 'income', x: true },
];

export { normalizeMerchantName } from './store.js';

export function getIncomeCategories(store) {
  return new Set([
    ...(DEFAULT_CATEGORIES[INCOME_GROUP] || []),
    ...((store.categories && store.categories[INCOME_GROUP]) || [])
  ]);
}

function resolvedMatch(category, type, store) {
  if (type === 'ignore') return { category: '', type: 'ignore' };
  const resolved = resolveCategory(category, store);
  if (!resolved) return null;
  return { category: resolved, type };
}

export function autoMatchMerchant(merchantName, amount, store) {
  const upper = String(merchantName || '').toUpperCase();
  const normalizedKey = normalizeMerchantName(merchantName);
  if (store.merchantMap[normalizedKey]) {
    const mapped = store.merchantMap[normalizedKey];
    const resolved = resolveCategory(mapped.category, store);
    if (resolved) {
      const isIncomeCategory = getIncomeCategories(store).has(resolved) || mapped.type === 'income';
      const isPositive = amount && amount > 0;
      if (isIncomeCategory && !isPositive) {
        // fall through
      } else if (!isIncomeCategory && isPositive && mapped.type === 'spending') {
        // fall through
      } else {
        return { category: resolved, type: mapped.type };
      }
    }
  }
  if (upper.includes('LØNOVERFØRSEL')) return resolvedMatch('Part-time job', 'income', store);
  if (upper === 'SAVINGS ACCOUNT' || upper === 'FROM SAVINGS ACCOUNT' || upper.includes('SAVINGS SU LÅN')) return { category: '', type: 'ignore' };
  if (upper.includes('IVAN BARBER')) return resolvedMatch('Haircut', 'spending', store);
  const knownInstitutions = ['UDBETALING DANMARK', 'SYGESIKRING DANMARK', 'TOPDANMARK'];
  const looksLikePerson = !knownInstitutions.some(inst => upper.includes(inst)) &&
    (upper.includes('MOBILEPAY') || String(merchantName || '').match(/^[A-ZÆØÅ][a-zæøå]+ [A-ZÆØÅ]/));
  if (looksLikePerson && amount) {
    if (amount > 0) return resolvedMatch('Reimbursement', 'income', store);
    if (amount < 0) return resolvedMatch('Transfer out', 'spending', store);
  }
  for (const rule of MERCHANT_PATTERNS) {
    const matched = rule.x ? upper === rule.p.toUpperCase() : upper.includes(rule.p.toUpperCase());
    if (!matched) continue;
    if (amount) {
      if (rule.t === 'income' && amount < 0) continue;
      if (rule.t === 'spending' && amount > 0) continue;
    }
    return resolvedMatch(rule.c, rule.t, store);
  }
  return null;
}

export function computeMerchantStats(transactions) {
  const stats = {};
  transactions.forEach(tx => {
    if (!tx.category || tx.type === 'ignore' || tx.splitInto) return;
    const key = normalizeMerchantName(tx.merchant);
    if (!stats[key]) stats[key] = { count: 0, categories: {}, amounts: [], dates: [] };
    const s = stats[key];
    s.count++;
    s.categories[tx.category] = (s.categories[tx.category] || 0) + 1;
    s.amounts.push(tx.amount);
    s.dates.push(tx.date);
  });
  Object.values(stats).forEach(s => {
    const sum = s.amounts.reduce((a, b) => a + b, 0);
    s.meanAmount = sum / s.amounts.length;
    const variance = s.amounts.reduce((a, v) => a + (v - s.meanAmount) ** 2, 0) / s.amounts.length;
    s.stddevAmount = Math.sqrt(variance);
    let maxCount = 0;
    s.primaryCategory = '';
    s.primaryCategoryCount = 0;
    Object.entries(s.categories).forEach(([cat, cnt]) => {
      if (cnt > maxCount) {
        maxCount = cnt;
        s.primaryCategory = cat;
        s.primaryCategoryCount = cnt;
      }
    });
  });
  return stats;
}

export function detectRecurringMerchants(merchantStats) {
  const recurring = {};
  Object.entries(merchantStats).forEach(([merchant, stats]) => {
    if (stats.count < 3) return;
    const sortedDates = stats.dates.slice().sort();
    const gaps = [];
    for (let i = 1; i < sortedDates.length; i++) {
      const d1 = new Date(sortedDates[i - 1]);
      const d2 = new Date(sortedDates[i]);
      gaps.push((d2 - d1) / (1000 * 60 * 60 * 24));
    }
    if (gaps.length === 0) return;
    const sortedGaps = gaps.slice().sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    if (medianGap < 25 || medianGap > 38) return;
    const absAmounts = stats.amounts.map(Math.abs);
    const mean = absAmounts.reduce((a, b) => a + b, 0) / absAmounts.length;
    if (mean === 0) return;
    const variance = absAmounts.reduce((a, v) => a + (v - mean) ** 2, 0) / absAmounts.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv >= 0.15) return;
    const firstDate = new Date(sortedDates[0]);
    const lastDate = new Date(sortedDates[sortedDates.length - 1]);
    const monthsCovered = Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24 * 30.44)) + 1;
    recurring[merchant] = { cadenceDays: Math.round(medianGap), typicalAmount: mean, monthsCovered };
  });
  return recurring;
}

export function computeCategoryCertainty(tx, suggestion, merchantStats, recurringMerchants, store) {
  if (!suggestion || !suggestion.category) return 0;
  const key = normalizeMerchantName(tx.merchant);
  const stats = merchantStats[key];
  let historyScore = 0;
  if (stats && stats.categories[suggestion.category]) {
    const count = stats.categories[suggestion.category];
    if (count >= 5) historyScore = 1.0;
    else if (count >= 3) historyScore = 0.7;
    else if (count >= 2) historyScore = 0.5;
    else historyScore = 0.3;
  }
  let amountScore = 0.2;
  if (stats && stats.stddevAmount !== undefined && stats.count >= 2) {
    const deviation = Math.abs(tx.amount - stats.meanAmount);
    if (stats.stddevAmount === 0) amountScore = deviation === 0 ? 1.0 : 0.2;
    else if (deviation <= stats.stddevAmount) amountScore = 1.0;
    else if (deviation <= 2 * stats.stddevAmount) amountScore = 0.5;
    else amountScore = 0.2;
  }
  const merchantMapKey = normalizeMerchantName(tx.merchant);
  const isFromMerchantMap = !!(store.merchantMap && store.merchantMap[merchantMapKey]);
  const sourceScore = isFromMerchantMap ? 1.0 : 0.6;
  const recurringScore = recurringMerchants[key] ? 1.0 : 0.0;
  return historyScore * 0.35 + amountScore * 0.25 + sourceScore * 0.25 + recurringScore * 0.15;
}

export function certaintyBand(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

export function detectConflicts(merchantStats) {
  const groups = {};
  Object.entries(merchantStats).forEach(([merchant, stats]) => {
    const normalized = normalizeMerchantName(merchant);
    if (!groups[normalized]) groups[normalized] = { merchants: [], categories: {} };
    groups[normalized].merchants.push(merchant);
    Object.entries(stats.categories).forEach(([cat, cnt]) => {
      groups[normalized].categories[cat] = (groups[normalized].categories[cat] || 0) + cnt;
    });
  });
  const conflicts = {};
  Object.entries(groups).forEach(([normalized, group]) => {
    if (Object.keys(group.categories).length >= 2) conflicts[normalized] = group;
  });
  return conflicts;
}

export function parseNordeaCSV(text, todayIso = new Date().toISOString().slice(0, 10)) {
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 6) continue;
    const dateRaw = cols[0].trim();
    const amount = Number.parseFloat(cols[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isNaN(amount)) continue;
    const name = cols[4].trim();
    const desc = cols[5].trim();
    const saldo = cols[6] ? cols[6].trim() : '';
    if (dateRaw === 'Reserveret') continue;
    const date = dateRaw.replace(/\//g, '-');
    const merchant = resolveMerchant(name, desc);
    rows.push({ date, amount, merchant, description: desc, originalName: name, balance: saldo });
  }
  return rows;
}

export function txFingerprint(tx) {
  return `${tx.date}|${tx.amount}|${tx.merchant}|${tx.description}|${tx.balance || ''}`;
}

export function resolveMerchant(name, desc) {
  const n = String(name || '').trim();
  const d = String(desc || '').trim();
  const upper = n.toUpperCase();
  const dUpper = d.toUpperCase();
  if (upper.includes('VIPPS') || upper.includes('MOBILEPAY') || dUpper.startsWith('MOBILEPAY ')) {
    return d.replace(/^MobilePay\s+/i, '').trim() || n || 'Unknown';
  }
  if (dUpper.includes('OVERFØRSEL MOBILEPAY ')) {
    return d.replace(/^Overførsel MobilePay\s+/i, '').trim() || 'Unknown';
  }
  if (dUpper.includes('NORDEAPAY') || dUpper.startsWith('NORDEA PAY')) {
    let merchant = d.replace(/^Nordea\s*pay\s*(køb)?\s*,?\s*\.?\s*/i, '').trim();
    merchant = merchant.replace(/\s*Den \d{2}\.\d{2}$/, '').trim();
    return merchant || n || d || 'Unknown';
  }
  if (dUpper.startsWith('PAY MODPOST')) {
    let merchant = d.replace(/^Pay modpost\.\s*,?\s*\.?\s*/i, '').trim();
    merchant = merchant.replace(/\s*Den \d{2}\.\d{2}$/, '').trim();
    return merchant || 'Unknown';
  }
  let result = n || d || 'Unknown';
  result = result.replace(/\s?Den \d{2}\.\d{2}$/, '').trim();
  result = result.replace(/^[A-Z]{3} [\d.,]+\s{2,}/, '').trim();
  result = result.replace(/^Bs betaling\s+/i, '').trim();
  return result || 'Unknown';
}

export function getFilteredTransactions(filters, transactions, store) {
  const search = (filters.search || '').toLowerCase();
  const shiftDay = store.salaryShiftDay || 0;
  const txs = transactions.filter(tx => {
    if (filters.month !== 'all' && getEffectiveMonth(tx, shiftDay) !== filters.month) return false;
    if (filters.category !== 'all' && tx.category !== filters.category) return false;
    if (filters.type !== 'all' && tx.type !== filters.type) return false;
    if (filters.uncategorizedOnly && (tx.category || tx.type === 'ignore')) return false;
    if (search && !tx.merchant.toLowerCase().includes(search) && !tx.description.toLowerCase().includes(search)) return false;
    return true;
  });
  const totalSpending = Math.abs(txs.filter(t => t.amount < 0 && t.type === 'spending').reduce((s, t) => s + t.amount, 0));
  const totalIncome = txs.filter(t => t.amount > 0 && t.type !== 'loan').reduce((s, t) => s + t.amount, 0);
  const duplicateFingerprints = {};
  transactions.forEach(tx => {
    if (tx.splitInto || tx.splitFrom) return;
    const fp = txFingerprint(tx);
    if (!duplicateFingerprints[fp]) duplicateFingerprints[fp] = { count: 0, minId: tx.id };
    duplicateFingerprints[fp].count++;
    if (tx.id < duplicateFingerprints[fp].minId) duplicateFingerprints[fp].minId = tx.id;
  });
  const filtered = txs.filter(tx => !tx.splitInto).sort((a, b) => {
    return b.date.localeCompare(a.date) || b.id - a.id;
  });
  return { filtered, totalSpending, totalIncome, duplicateFingerprints };
}

export function flagDuplicates(existingTransactions, newRows) {
  const existingFps = new Set();
  existingTransactions.forEach(tx => {
    if (tx.splitInto || tx.splitFrom) return;
    existingFps.add(txFingerprint(tx));
  });
  return newRows.map(row => ({
    ...row,
    possibleDuplicate: existingFps.has(txFingerprint(row))
  }));
}

export function collapseSplitParent(parent, remainingChild) {
  return {
    amount: remainingChild.amount,
    category: remainingChild.category || '',
    type: remainingChild.type || (remainingChild.amount > 0 ? 'income' : 'spending'),
    manualCategory: remainingChild.manualCategory || false,
    covered: remainingChild.covered || false
  };
}

export function sanitizeTransactions(store) {
  let fixed = 0;
  const incomeCats = getIncomeCategories(store);
  store.transactions.forEach(tx => {
    if (!tx.category || tx.type === 'ignore' || tx.manualCategory) return;
    const isPositive = tx.amount > 0;
    const isIncomeCat = incomeCats.has(tx.category);
    if (isPositive && !isIncomeCat) {
      tx.category = '';
      fixed++;
    } else if (!isPositive && isIncomeCat) {
      tx.category = '';
      fixed++;
    }
  });
  return fixed;
}
