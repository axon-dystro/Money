const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 9999;
const DB_PATH = path.join(__dirname, 'data.json');

const DEFAULT_BUCKETS = [
  { id: 'bucket_essen', name: 'Essen / Mealprep', amount: 200, mode: 'money', periods: 4, active: true },
  { id: 'bucket_tanken', name: 'Tanken', amount: 40, mode: 'money', periods: 4, active: true },
  { id: 'bucket_friseur', name: 'Friseur', amount: 64, mode: 'unit', unitAmount: 32, unitCount: 2, periods: 4, active: true },
  { id: 'bucket_notfall', name: 'Notfall-Sparen', amount: 50, mode: 'saving', periods: 1, active: true },
  { id: 'bucket_frei', name: 'Freie Verwendung', amount: 50, mode: 'money', periods: 4, active: true, system: 'free_use' }
];

const defaultData = {
  income: 0,
  fixedCosts: [],
  cancelableCosts: [],
  budgetBuckets: DEFAULT_BUCKETS,
  expenses: [],
  extraIncome: [],
  settings: { hideFreeBalance: true, roundExpensesUp: true }
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
    periods: Math.max(1, Math.min(6, safeNumber(body.periods, safeNumber(existing.periods, 4)) || 4)),
    active: body.active === undefined ? (existing.active !== false) : !!body.active
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
  const source = normalizeName(e.category || e.tag || e.name || '');
  const pairs = [
    ['essen', ['essen', 'mealprep', 'lebensmittel', 'aldi', 'lidl', 'rewe']],
    ['tanken', ['tanken', 'sprit', 'benzin', 'roller']],
    ['friseur', ['friseur', 'frisur', 'hair']],
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
    const bucket = findBestBucket(e, buckets);
    const originalCategory = cleanText(e.category || e.tag || '', '');
    let note = cleanText(e.note, '');
    const movedToFree = bucket && (bucket.system === 'free_use' || bucket.id === 'bucket_frei');
    if (movedToFree && originalCategory && normalizeName(originalCategory) !== normalizeName(bucket.name)) {
      note = note ? `${originalCategory} · ${note}` : originalCategory;
    }
    return {
      id: e.id || id(),
      kind: 'budget',
      bucketId: bucket?.id || freeBucketId(buckets),
      category: bucket?.name || 'Freie Verwendung',
      amount: safeNumber(e.amount, 0),
      note,
      date: normalizeDate(e.date)
    };
  });
}
function migrate(raw = {}) {
  const buckets = ensureBuckets(raw.budgetBuckets);
  const d = {
    ...defaultData,
    ...raw,
    fixedCosts: Array.isArray(raw.fixedCosts) ? raw.fixedCosts : [],
    cancelableCosts: Array.isArray(raw.cancelableCosts) ? raw.cancelableCosts : [],
    budgetBuckets: buckets,
    expenses: migrateExpenses(raw.expenses, buckets),
    extraIncome: Array.isArray(raw.extraIncome) ? raw.extraIncome.map(x => ({ id: x.id || id(), name: cleanText(x.name, 'Plusgeld'), amount: safeNumber(x.amount, 0), date: normalizeDate(x.date), note: cleanText(x.note, '') })) : [],
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

app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (req, res) => res.json(load()));
app.post('/api/income', (req, res) => { const d = load(); d.income = safeNumber(req.body.income, 0); save(d); res.json(d); });
app.post('/api/settings', (req, res) => { const d = load(); d.settings = { ...d.settings, ...req.body }; save(d); res.json(d); });

app.post('/api/cost', (req, res) => {
  const d = load();
  const type = req.body.type;
  if (!['fixedCosts', 'cancelableCosts'].includes(type)) return res.status(400).json({ error: 'bad type' });
  d[type].push({ id: id(), name: cleanText(req.body.name, 'Kosten'), amount: safeNumber(req.body.amount, 0) });
  save(d); res.json(d);
});
app.patch('/api/cost/:type/:id', (req, res) => {
  const d = load();
  const type = req.params.type;
  if (!['fixedCosts', 'cancelableCosts'].includes(type)) return res.status(400).json({ error: 'bad type' });
  const item = d[type].find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.name = cleanText(req.body.name, item.name);
  item.amount = safeNumber(req.body.amount, item.amount);
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

// Old category endpoints are intentionally kept as harmless no-ops for older browsers/service workers.
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
  d.expenses.push({ id: id(), kind: 'budget', bucketId: bucket.id, category: bucket.name, amount, note: cleanText(req.body.note, ''), date });
  save(d); res.json(d);
});
app.patch('/api/expense/:id', (req, res) => {
  const d = load();
  const item = d.expenses.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const bucket = d.budgetBuckets.find(b => b.id === req.body.bucketId) || d.budgetBuckets.find(b => b.system === 'free_use' || b.id === 'bucket_frei') || d.budgetBuckets[0];
  item.kind = 'budget';
  item.bucketId = bucket.id;
  item.category = bucket.name;
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '127.0.0.1', () => console.log(`Budget Master läuft intern auf http://127.0.0.1:${PORT}`));
