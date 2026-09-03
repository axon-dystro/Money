const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { createSparkasseMailPoller } = require('./sparkasse-mail');
const { normalizeFrequency } = require('./recurrence');
const { parseSparkasseStatementPdf } = require('./statement-parser');
const {
  appendImportSource,
  extractReferenceTokens,
  findExpenseImportMatch,
  hasKnownSource,
  isCardSource,
  sourceIds
} = require('./transaction-reconcile');
const app = express();
const PORT = process.env.PORT || 9999;
const DB_PATH = path.join(__dirname, 'data.json');

const DEFAULT_BUCKETS = [
  { id: 'bucket_essen', name: 'Essen / Mealprep', amount: 200, mode: 'money', frequency: 'monthly', dueDate: '', periods: 4, active: true },
  { id: 'bucket_tanken', name: 'Tanken', amount: 40, mode: 'money', frequency: 'monthly', dueDate: '', periods: 4, active: true },
  { id: 'bucket_friseur', name: 'Friseur', amount: 64, mode: 'unit', unitAmount: 32, unitCount: 2, frequency: 'monthly', dueDate: '', periods: 4, active: true },
  { id: 'bucket_notfall', name: 'Notfall-Sparen', amount: 50, mode: 'saving', frequency: 'monthly', dueDate: '', periods: 1, active: true },
  { id: 'bucket_frei', name: 'Freie Verwendung', amount: 50, mode: 'money', frequency: 'monthly', dueDate: '', periods: 4, active: true, system: 'free_use' }
];

const defaultData = {
  income: 0,
  fixedCosts: [],
  cancelableCosts: [],
  budgetBuckets: DEFAULT_BUCKETS,
  expenses: [],
  extraIncome: [],
  processedMailIds: [],
  mailImportLog: [],
  statementImportLog: [],
  settings: { hideFreeBalance: true, roundExpensesUp: true, costBufferEnabled: true }
};

function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function normalizeDate(v) {
  v = String(v || '').trim();
  let m = v.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function cleanText(v, fallback = '') { return String(v || fallback).trim(); }
function safeNumber(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function normalizeName(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
function cleanBucket(body = {}, existing = {}) {
  const mode = ['money', 'unit', 'saving'].includes(body.mode) ? body.mode : (existing.mode || 'money');
  const unitAmount = safeNumber(body.unitAmount, safeNumber(existing.unitAmount, 0));
  const unitCount = safeNumber(body.unitCount, safeNumber(existing.unitCount, 0));
  const amount = mode === 'unit'
    ? unitAmount * unitCount
    : (body.amount === undefined ? safeNumber(existing.amount, 0) : safeNumber(body.amount, 0));

  return {
    ...existing,
    name: cleanText(body.name, existing.name || 'Budget'),
    amount,
    mode,
    unitAmount,
    unitCount,
    frequency: normalizeFrequency(body.frequency, normalizeFrequency(existing.frequency)),
    dueDate: normalizeOptionalDate(body.dueDate === undefined ? existing.dueDate : body.dueDate),
    periods: Math.max(1, Math.min(6, safeNumber(body.periods, safeNumber(existing.periods, 4)) || 4)),
    active: body.active === undefined ? (existing.active !== false) : !!body.active
  };
}
function normalizeOptionalDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw) || /^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}$/.test(raw)) return normalizeDate(raw);
  return '';
}
function cleanCost(item = {}, existing = {}) {
  return {
    ...existing,
    id: item.id || existing.id || id(),
    name: cleanText(item.name, existing.name || 'Kosten'),
    amount: safeNumber(item.amount, safeNumber(existing.amount, 0)),
    frequency: normalizeFrequency(item.frequency, normalizeFrequency(existing.frequency)),
    dueDate: normalizeOptionalDate(item.dueDate === undefined ? existing.dueDate : item.dueDate)
  };
}
function ensureBuckets(rawBuckets) {
  const input = Array.isArray(rawBuckets) && rawBuckets.length ? rawBuckets : DEFAULT_BUCKETS;
  const cleaned = input.map(b => cleanBucket(b, b));

  for (const def of DEFAULT_BUCKETS) {
    const byId = cleaned.find(b => b.id === def.id);
    const byName = cleaned.find(b => normalizeName(b.name) === normalizeName(def.name));
    if (!byId && !byName) cleaned.push({ ...def });
  }

  const free = cleaned.find(b => b.system === 'free_use' || b.id === 'bucket_frei' || normalizeName(b.name) === normalizeName('Freie Verwendung'));
  if (free) {
    free.id = free.id || 'bucket_frei';
    free.name = 'Freie Verwendung';
    free.system = 'free_use';
    free.active = true;
    free.mode = free.mode || 'money';
    free.periods = free.periods || 4;
  }
  return cleaned;
}
function freeBucketId(buckets) {
  return (buckets.find(b => b.system === 'free_use' || b.id === 'bucket_frei') || buckets[0] || {}).id || 'bucket_frei';
}
function findBestBucket(e, buckets) {
  if (e.bucketId && buckets.some(b => b.id === e.bucketId)) return buckets.find(b => b.id === e.bucketId);
  const source = normalizeName(e.category || e.tag || e.name || e.merchant || e.note || '');
  const pairs = [
    ['essen', ['essen', 'mealprep', 'lebensmittel', 'aldi', 'lidl', 'rewe', 'hit', 'kaufland', 'edeka', 'netto', 'penny']],
    ['tanken', ['tanken', 'sprit', 'benzin', 'diesel', 'aral', 'shell', 'jet', 'esso']],
    ['friseur', ['friseur', 'frisur', 'hair', 'barber']],
    ['notfall', ['notfall', 'sparen', 'reserve']]
  ];
  for (const [bucketHint, words] of pairs) {
    if (words.some(w => source.includes(w))) {
      const b = buckets.find(x => normalizeName(x.name).includes(bucketHint));
      if (b) return b;
    }
  }
  return buckets.find(b => b.system === 'free_use' || b.id === 'bucket_frei') || buckets[0];
}
function migrateExpenses(rawExpenses, buckets) {
  return (Array.isArray(rawExpenses) ? rawExpenses : []).map(e => {
    const kind = ['fixedCosts', 'cancelableCosts'].includes(e.kind) ? e.kind : 'budget';
    const bucket = findBestBucket(e, buckets);
    const originalCategory = cleanText(e.category || e.tag || '', '');
    let note = cleanText(e.note, '');
    const movedToFree = kind === 'budget' && bucket && (bucket.system === 'free_use' || bucket.id === 'bucket_frei');
    if (movedToFree && originalCategory && normalizeName(originalCategory) !== normalizeName(bucket.name)) {
      note = note ? `${originalCategory} · ${note}` : originalCategory;
    }
    const existingSourceIds = Array.isArray(e.sourceIds) ? e.sourceIds.filter(Boolean).map(String) : [];
    if (e.sourceId && !existingSourceIds.includes(e.sourceId)) existingSourceIds.unshift(e.sourceId);
    const existingRefs = Array.isArray(e.sourceRefs) ? e.sourceRefs.filter(Boolean).map(String) : [];
    for (const ref of extractReferenceTokens(`${e.note || ''} ${e.merchant || ''} ${e.details || ''}`)) {
      if (!existingRefs.includes(ref)) existingRefs.push(ref);
    }
    const source = cleanText(e.source, '');
    const sourceStatus = cleanText(e.sourceStatus, isCardSource(source) ? 'pending' : (source ? 'cleared' : ''));
    return {
      ...e,
      id: e.id || id(),
      kind,
      costId: kind === 'budget' ? '' : cleanText(e.costId, ''),
      bucketId: kind === 'budget' ? (bucket?.id || freeBucketId(buckets)) : '',
      category: kind === 'budget' ? (bucket?.name || 'Freie Verwendung') : cleanText(e.category, 'Laufende Kosten'),
      amount: safeNumber(e.amount, 0),
      note,
      date: normalizeDate(e.date),
      merchant: cleanText(e.merchant, ''),
      source,
      sourceId: cleanText(e.sourceId, ''),
      sourceIds: existingSourceIds.slice(-12),
      sourceRefs: existingRefs.slice(-20),
      sourceStatus,
      clearingSource: cleanText(e.clearingSource, ''),
      clearedAt: cleanText(e.clearedAt, ''),
      bookedDate: normalizeOptionalDate(e.bookedDate || '')
    };
  });
}
function migrate(raw = {}) {
  const buckets = ensureBuckets(raw.budgetBuckets);
  const d = {
    ...defaultData,
    ...raw,
    fixedCosts: (Array.isArray(raw.fixedCosts) ? raw.fixedCosts : []).map(x => cleanCost(x, x)),
    cancelableCosts: (Array.isArray(raw.cancelableCosts) ? raw.cancelableCosts : []).map(x => cleanCost(x, x)),
    budgetBuckets: buckets,
    expenses: migrateExpenses(raw.expenses, buckets),
    extraIncome: Array.isArray(raw.extraIncome) ? raw.extraIncome.map(x => ({ ...x, id: x.id || id(), name: cleanText(x.name, 'Plusgeld'), amount: safeNumber(x.amount, 0), date: normalizeDate(x.date), note: cleanText(x.note, ''), source: cleanText(x.source, ''), sourceId: cleanText(x.sourceId, '') })) : [],
    processedMailIds: Array.isArray(raw.processedMailIds) ? raw.processedMailIds.slice(-1000) : [],
    mailImportLog: Array.isArray(raw.mailImportLog) ? raw.mailImportLog.slice(-100) : [],
    statementImportLog: Array.isArray(raw.statementImportLog) ? raw.statementImportLog.slice(-100) : [],
    settings: { ...defaultData.settings, ...(raw.settings || {}) }
  };
  delete d.consumptionCategories;
  return d;
}
function load() {
  try {
    if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2));
    return migrate(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
  } catch (e) {
    return migrate(defaultData);
  }
}
function save(data) { fs.writeFileSync(DB_PATH, JSON.stringify(migrate(data), null, 2)); }

function namedCostMatch(source, d) {
  const rules = [
    { all: ['ergo', 'rechtsschutz'], target: 'rechtsschutz' },
    { all: ['ergo', 'hausrat'], target: 'hausrat' },
    { all: ['ergo', 'unfall'], target: 'umfallversicherung' },
    { all: ['ergo', 'haftpflicht'], target: 'privatversicherung' },
    { any: ['latifaj', 'miete'], target: 'miete' },
    { any: ['stadtwerke', 'gas'], target: 'gas' },
    { any: ['telefonica', 'o2'], target: 'handyinternet' },
    { any: ['ard', 'zdf', 'deutschlandradio', 'rundfunkbeitrag', 'beitragsservice'], target: 'ard' },
    { any: ['schufa'], target: 'schufa' },
    { any: ['cleverfit', 'cleverfitgmbh'], target: 'cleverfit' },
    { any: ['discord'], target: 'discordnitro' },
    { any: ['openai', 'chatgpt'], target: 'chatgpt' },
    { any: ['googleone', 'gmail'], target: 'gmail' },
    { any: ['crunchyroll', 'crunchy'], target: 'chrunchyrole' },
    { any: ['spotify'], target: 'spotify' },
    { any: ['iphone'], target: 'iphoneschulden' }
  ];
  const collections = ['fixedCosts', 'cancelableCosts'];
  for (const rule of rules) {
    const matches = rule.all ? rule.all.every(word => source.includes(word)) : rule.any.some(word => source.includes(word));
    if (!matches) continue;
    for (const type of collections) {
      const item = d[type].find(x => normalizeName(x.name).includes(rule.target));
      if (item) return { targetType: type, targetId: item.id, targetName: item.name };
    }
  }
  for (const type of collections) {
    const item = d[type].find(cost => {
      const tokens = String(cost.name || '').toLowerCase().match(/[a-zäöüß0-9]{4,}/g) || [];
      return tokens.some(token => source.includes(normalizeName(token)));
    });
    if (item) return { targetType: type, targetId: item.id, targetName: item.name };
  }
  return null;
}

function suggestTransactionTarget(tx, d) {
  const source = normalizeName(`${tx.merchant || ''} ${tx.bookingType || ''} ${tx.details || ''}`);
  const cost = namedCostMatch(source, d);
  if (cost) return cost;
  const bucket = findBestBucket({ merchant: tx.merchant, name: tx.merchant, note: tx.details }, d.budgetBuckets);
  return { targetType: 'budget', targetId: bucket?.id || freeBucketId(d.budgetBuckets), targetName: bucket?.name || 'Freie Verwendung' };
}

function resolveExpenseTarget(targetType, targetId, tx, d) {
  if (targetType === 'budget') {
    const bucket = d.budgetBuckets.find(x => x.id === targetId);
    if (bucket) return { kind: 'budget', bucketId: bucket.id, costId: '', category: bucket.name };
  }
  if (['fixedCosts', 'cancelableCosts'].includes(targetType)) {
    const cost = d[targetType].find(x => x.id === targetId);
    if (cost) return { kind: targetType, bucketId: '', costId: cost.id, category: cost.name };
  }
  const suggestion = suggestTransactionTarget(tx, d);
  return resolveExpenseTarget(suggestion.targetType, suggestion.targetId, tx, d);
}

function mailImportSource(tx = {}) {
  return tx.weckerType === 'card' ? 'sparkasse-kartenwecker' : 'sparkasse-umsatzwecker';
}

function importDate(tx = {}) {
  return normalizeOptionalDate(tx.transactionDate || tx.date || tx.bookingDate || '') || normalizeDate(tx.receivedAt);
}

function importedExpensePayload(tx = {}, source) {
  return {
    amount: safeNumber(tx.amount, 0),
    merchant: cleanText(tx.merchant, ''),
    note: cleanText(tx.merchant || tx.subject || 'Sparkassen-Umsatz', 'Sparkassen-Umsatz'),
    date: importDate(tx),
    source,
    sourceId: cleanText(tx.messageId, ''),
    sourceRefs: Array.isArray(tx.sourceRefs) ? tx.sourceRefs : extractReferenceTokens(`${tx.rawText || ''} ${tx.subject || ''}`)
  };
}

function importedExpenseRowPayload(row = {}, source = 'sparkasse-pdf') {
  const merchant = cleanText(row.merchant, 'Unbekannte Buchung').slice(0, 160);
  return {
    amount: Math.abs(safeNumber(row.amount, 0)),
    merchant,
    note: merchant,
    date: normalizeOptionalDate(row.date),
    source,
    sourceId: cleanText(row.sourceId, ''),
    sourceRefs: Array.isArray(row.sourceRefs) ? row.sourceRefs : extractReferenceTokens(`${row.bookingType || ''} ${row.details || ''} ${merchant}`)
  };
}

function importMatchSummary(match) {
  if (!match || match.action === 'none') return { duplicate: false, matchStatus: 'new', matchReason: '' };
  if (match.action === 'duplicate') return { duplicate: true, matchStatus: 'duplicate', matchReason: match.reason || 'duplicate', matchedExpenseId: match.existing?.id || '' };
  if (match.action === 'reconcile') return { duplicate: false, matchStatus: 'reconcile', matchReason: match.reason || 'match', matchedExpenseId: match.existing?.id || '' };
  return { duplicate: true, matchStatus: 'ambiguous', matchReason: match.reason || 'ambiguous' };
}

function importSparkasseTransaction(tx) {
  const d = load();
  if (!tx?.messageId || d.processedMailIds.includes(tx.messageId)) return false;

  d.processedMailIds.push(tx.messageId);
  d.processedMailIds = d.processedMailIds.slice(-1000);

  if (tx.type === 'income') {
    const amount = safeNumber(tx.amount, 0);
    const knownIncome = hasKnownSource(d.extraIncome || [], tx.messageId);
    if (knownIncome) {
      d.mailImportLog.push({ at: new Date().toISOString(), messageId: tx.messageId, status: 'duplicate', direction: 'income', merchant: tx.merchant || '', amount });
      d.mailImportLog = d.mailImportLog.slice(-100);
      save(d);
      return false;
    }
    d.extraIncome.push({ id: id(), name: tx.merchant || 'Sparkassen-Geldeingang', amount, date: importDate(tx), note: tx.subject || '', source: mailImportSource(tx), sourceId: tx.messageId, sourceIds: [tx.messageId], sourceRefs: Array.isArray(tx.sourceRefs) ? tx.sourceRefs : [] });
    d.mailImportLog.push({ at: new Date().toISOString(), messageId: tx.messageId, status: 'imported', direction: 'income', merchant: tx.merchant || '', amount });
    d.mailImportLog = d.mailImportLog.slice(-100);
    save(d);
    console.log(`[Sparkasse-Mail] Eingang importiert: ${tx.merchant || 'Geldeingang'} ${amount.toFixed(2)} EUR`);
    return true;
  }

  if (tx.type !== 'expense') {
    d.mailImportLog.push({ at: new Date().toISOString(), messageId: tx.messageId, status: 'ignored', subject: tx.subject || '', reason: 'not-expense' });
    d.mailImportLog = d.mailImportLog.slice(-100);
    save(d);
    return false;
  }

  const source = mailImportSource(tx);
  const incoming = importedExpensePayload(tx, source);
  const match = findExpenseImportMatch(d.expenses, incoming);
  const amount = safeNumber(tx.amount, 0);

  if (match.action === 'duplicate') {
    d.mailImportLog.push({ at: new Date().toISOString(), messageId: tx.messageId, status: 'duplicate', merchant: tx.merchant || '', amount, reason: match.reason || 'duplicate' });
    d.mailImportLog = d.mailImportLog.slice(-100);
    save(d);
    console.log(`[Sparkasse-Mail] Duplikat übersprungen: ${tx.merchant || 'Umsatz'} ${amount.toFixed(2)} EUR`);
    return false;
  }

  if (match.action === 'reconcile' && match.existing) {
    appendImportSource(match.existing, incoming);
    d.mailImportLog.push({ at: new Date().toISOString(), messageId: tx.messageId, status: 'reconciled', merchant: tx.merchant || '', amount, existingExpenseId: match.existing.id, reason: match.reason || 'match' });
    d.mailImportLog = d.mailImportLog.slice(-100);
    save(d);
    console.log(`[Sparkasse-Mail] Mit bestehender Buchung abgeglichen: ${tx.merchant || 'Umsatz'} ${amount.toFixed(2)} EUR`);
    return false;
  }

  if (match.action === 'ambiguous') {
    d.mailImportLog.push({ at: new Date().toISOString(), messageId: tx.messageId, status: 'ambiguous', merchant: tx.merchant || '', amount, reason: match.reason || 'ambiguous' });
    d.mailImportLog = d.mailImportLog.slice(-100);
    save(d);
    console.warn(`[Sparkasse-Mail] Mehrdeutiger Abgleich, nicht automatisch importiert: ${tx.merchant || 'Umsatz'} ${amount.toFixed(2)} EUR`);
    return false;
  }

  const suggestion = suggestTransactionTarget(tx, d);
  const target = resolveExpenseTarget(suggestion.targetType, suggestion.targetId, tx, d);

  d.expenses.push({
    id: id(),
    ...target,
    amount,
    note: incoming.note,
    merchant: incoming.merchant,
    date: incoming.date,
    source,
    sourceId: tx.messageId,
    sourceIds: sourceIds(incoming),
    sourceRefs: incoming.sourceRefs || [],
    sourceStatus: isCardSource(source) ? 'pending' : 'cleared'
  });
  d.mailImportLog.push({ at: new Date().toISOString(), messageId: tx.messageId, status: 'imported', merchant: tx.merchant || '', amount, target: target.category, source });
  d.mailImportLog = d.mailImportLog.slice(-100);
  save(d);
  console.log(`[Sparkasse-Mail] Importiert: ${tx.merchant || 'Umsatz'} ${amount.toFixed(2)} EUR -> ${target.category}`);
  return true;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

app.get('/api/data', (req, res) => res.json(load()));
app.get('/api/mail-import-log', (req, res) => res.json(load().mailImportLog || []));
app.get('/api/statement-import-log', (req, res) => res.json(load().statementImportLog || []));
app.post('/api/income', (req, res) => { const d = load(); d.income = safeNumber(req.body.income, 0); save(d); res.json(d); });
app.post('/api/settings', (req, res) => { const d = load(); d.settings = { ...d.settings, ...req.body }; save(d); res.json(d); });

app.post('/api/cost', (req, res) => {
  const d = load();
  const type = req.body.type;
  if (!['fixedCosts', 'cancelableCosts'].includes(type)) return res.status(400).json({ error: 'bad type' });
  d[type].push(cleanCost({ id: id(), ...req.body }));
  save(d); res.json(d);
});
app.patch('/api/cost/:type/:id', (req, res) => {
  const d = load();
  const type = req.params.type;
  if (!['fixedCosts', 'cancelableCosts'].includes(type)) return res.status(400).json({ error: 'bad type' });
  const item = d[type].find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  Object.assign(item, cleanCost(req.body, item));
  save(d); res.json(d);
});
app.delete('/api/cost/:type/:id', (req, res) => {
  const d = load();
  const type = req.params.type;
  if (!['fixedCosts', 'cancelableCosts'].includes(type)) return res.status(400).json({ error: 'bad type' });
  d[type] = d[type].filter(x => x.id !== req.params.id);
  save(d); res.json(d);
});

app.post('/api/bucket', (req, res) => { const d = load(); d.budgetBuckets.push({ id: id(), ...cleanBucket(req.body) }); save(d); res.json(d); });
app.patch('/api/bucket/:id', (req, res) => {
  const d = load();
  const b = d.budgetBuckets.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  Object.assign(b, cleanBucket(req.body, b));
  if (b.system === 'free_use') { b.name = 'Freie Verwendung'; b.active = true; }
  save(d); res.json(d);
});
app.delete('/api/bucket/:id', (req, res) => {
  const d = load();
  const b = d.budgetBuckets.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  if (b.system === 'free_use' || b.id === 'bucket_frei') return res.status(400).json({ error: 'free bucket cannot be deleted' });
  const freeId = freeBucketId(d.budgetBuckets);
  d.budgetBuckets = d.budgetBuckets.filter(x => x.id !== req.params.id);
  d.expenses = d.expenses.map(e => e.bucketId === req.params.id ? { ...e, bucketId: freeId, category: 'Freie Verwendung', note: e.note ? `${b.name} · ${e.note}` : b.name } : e);
  save(d); res.json(d);
});

app.post('/api/category', (req, res) => res.json(load()));
app.delete('/api/category/:name', (req, res) => res.json(load()));

app.post('/api/expense', (req, res) => {
  const d = load();
  const date = normalizeDate(req.body.date);
  let bucket = d.budgetBuckets.find(b => b.id === req.body.bucketId);
  if (!bucket) bucket = d.budgetBuckets.find(b => b.system === 'free_use' || b.id === 'bucket_frei') || d.budgetBuckets[0];
  let amount = safeNumber(req.body.amount, 0);
  if (!amount && bucket?.mode === 'unit') amount = safeNumber(bucket.unitAmount, 0);
  if (d.settings.roundExpensesUp) amount = Math.ceil(amount);
  d.expenses.push({ id: id(), kind: 'budget', bucketId: bucket.id, category: bucket.name, amount, note: cleanText(req.body.note, ''), date, merchant: '', source: '', sourceId: '' });
  save(d); res.json(d);
});
app.patch('/api/expense/:id', (req, res) => {
  const d = load();
  const item = d.expenses.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const targetType = req.body.targetType || 'budget';
  const targetId = req.body.targetId || req.body.bucketId;
  Object.assign(item, resolveExpenseTarget(targetType, targetId, item, d));
  item.amount = d.settings.roundExpensesUp ? Math.ceil(safeNumber(req.body.amount, item.amount)) : safeNumber(req.body.amount, item.amount);
  item.note = cleanText(req.body.note, item.note);
  item.date = normalizeDate(req.body.date || item.date);
  save(d); res.json(d);
});
app.delete('/api/expense/:id', (req, res) => { const d = load(); d.expenses = d.expenses.filter(x => x.id !== req.params.id); save(d); res.json(d); });

app.post('/api/extra-income', (req, res) => {
  const d = load();
  d.extraIncome.push({ id: id(), name: cleanText(req.body.name, 'Plusgeld'), amount: safeNumber(req.body.amount, 0), date: normalizeDate(req.body.date), note: cleanText(req.body.note, '') });
  save(d); res.json(d);
});
app.patch('/api/extra-income/:id', (req, res) => {
  const d = load();
  const item = d.extraIncome.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.name = cleanText(req.body.name, item.name);
  item.amount = safeNumber(req.body.amount, item.amount);
  item.date = normalizeDate(req.body.date || item.date);
  item.note = cleanText(req.body.note, item.note || '');
  save(d); res.json(d);
});
app.delete('/api/extra-income/:id', (req, res) => { const d = load(); d.extraIncome = d.extraIncome.filter(x => x.id !== req.params.id); save(d); res.json(d); });

app.post('/api/import/pdf/preview', statementUpload.single('statement'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Bitte eine Kontoauszug-PDF auswählen.' });
    if (req.file.mimetype && req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Es sind nur PDF-Dateien erlaubt.' });
    const parsed = await parseSparkasseStatementPdf(req.file.buffer);
    const d = load();
    const usedExpenseIds = new Set();
    const transactions = parsed.transactions.map(tx => {
      const suggestion = tx.direction === 'expense' ? suggestTransactionTarget(tx, d) : { targetType: 'income', targetId: '', targetName: 'Einnahme' };
      if (tx.direction !== 'expense') {
        const duplicate = !!hasKnownSource(d.extraIncome || [], tx.sourceId);
        return { ...tx, ...suggestion, duplicate, matchStatus: duplicate ? 'duplicate' : 'new', matchReason: duplicate ? 'source-id' : '' };
      }
      const match = findExpenseImportMatch(d.expenses, importedExpenseRowPayload(tx), { usedExistingIds: usedExpenseIds });
      if (match.action === 'reconcile' && match.existing?.id) usedExpenseIds.add(match.existing.id);
      return { ...tx, ...suggestion, ...importMatchSummary(match) };
    });
    res.json({
      statementId: parsed.statementId,
      filename: req.file.originalname,
      pages: parsed.pages,
      transactions,
      summary: {
        expenses: transactions.filter(x => x.direction === 'expense').length,
        income: transactions.filter(x => x.direction === 'income').length,
        duplicates: transactions.filter(x => x.duplicate).length,
        reconciled: transactions.filter(x => x.matchStatus === 'reconcile').length,
        ambiguous: transactions.filter(x => x.matchStatus === 'ambiguous').length
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Die Kontoauszug-PDF konnte nicht gelesen werden.' });
  }
});

app.post('/api/import/pdf/confirm', (req, res) => {
  const rows = Array.isArray(req.body.transactions) ? req.body.transactions.slice(0, 500) : [];
  if (!rows.length) return res.status(400).json({ error: 'Keine Buchungen zum Import ausgewählt.' });
  const d = load();
  const knownIncomeIds = new Set([
    ...d.extraIncome.map(x => x.sourceId).filter(Boolean),
    ...d.extraIncome.flatMap(x => Array.isArray(x.sourceIds) ? x.sourceIds : []).filter(Boolean)
  ]);
  const usedExpenseIds = new Set();
  let imported = 0;
  let skipped = 0;
  let reconciled = 0;
  let ambiguous = 0;
  for (const row of rows) {
    const incoming = importedExpenseRowPayload(row);
    const sourceId = incoming.sourceId;
    const amount = incoming.amount;
    const date = incoming.date;
    const merchant = incoming.merchant;
    const direction = row.direction === 'income' ? 'income' : 'expense';
    if (!sourceId.startsWith('pdf:') || !amount || !date) { skipped++; continue; }
    if (direction === 'income') {
      if (knownIncomeIds.has(sourceId)) { skipped++; continue; }
      d.extraIncome.push({ id: id(), name: merchant, amount, date, note: cleanText(row.bookingType, ''), source: 'sparkasse-pdf', sourceId });
      knownIncomeIds.add(sourceId);
    } else {
      const match = findExpenseImportMatch(d.expenses, incoming, { usedExistingIds: usedExpenseIds });
      if (match.action === 'duplicate') { skipped++; continue; }
      if (match.action === 'ambiguous') { ambiguous++; skipped++; continue; }
      if (match.action === 'reconcile' && match.existing) {
        appendImportSource(match.existing, incoming);
        usedExpenseIds.add(match.existing.id);
        reconciled++;
        continue;
      }
      const target = resolveExpenseTarget(row.targetType, cleanText(row.targetId, ''), row, d);
      const expenseId = id();
      d.expenses.push({ id: expenseId, ...target, amount, note: merchant, merchant, date, source: 'sparkasse-pdf', sourceId, sourceIds: [sourceId], sourceRefs: incoming.sourceRefs || [], sourceStatus: 'cleared' });
      usedExpenseIds.add(expenseId);
    }
    imported++;
  }
  d.statementImportLog.push({ at: new Date().toISOString(), statementId: cleanText(req.body.statementId, ''), filename: cleanText(req.body.filename, ''), imported, reconciled, skipped, ambiguous });
  d.statementImportLog = d.statementImportLog.slice(-100);
  save(d);
  res.json({ data: load(), imported, reconciled, skipped, ambiguous });
});

const sparkassePoller = createSparkasseMailPoller({
  onTransaction: async tx => importSparkasseTransaction(tx),
  onDebug: async info => {
    const d = load();
    if (info?.messageId && !d.processedMailIds.includes(info.messageId)) {
      d.processedMailIds.push(info.messageId);
      d.processedMailIds = d.processedMailIds.slice(-1000);
      d.mailImportLog.push({ at: new Date().toISOString(), status: 'unparsed', ...info });
      d.mailImportLog = d.mailImportLog.slice(-100);
      save(d);
    }
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Die Kontoauszug-PDF darf höchstens 10 MB groß sein.'
      : 'Der PDF-Upload ist fehlgeschlagen.';
    return res.status(400).json({ error: message });
  }
  next(error);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Budget Master läuft intern auf http://127.0.0.1:${PORT}`);
  sparkassePoller.start();
});

async function shutdown() {
  await sparkassePoller.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
