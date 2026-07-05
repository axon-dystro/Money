const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 9999;
const DB_PATH = path.join(__dirname, 'data.json');

const defaultData = {
  income: 0,
  fixedCosts: [],
  cancelableCosts: [],
  consumptionCategories: ['Steam','Restaurant','Kleidung','Technik','Sonstiges'],
  budgetBuckets: [
    { id: 'bucket_essen', name: 'Essen / Mealprep', amount: 200, mode: 'money', periods: 4, active: true },
    { id: 'bucket_tanken', name: 'Tanken', amount: 40, mode: 'money', periods: 4, active: true },
    { id: 'bucket_friseur', name: 'Friseur', amount: 64, mode: 'unit', unitAmount: 32, unitCount: 2, periods: 4, active: true },
    { id: 'bucket_notfall', name: 'Notfall-Sparen', amount: 50, mode: 'saving', periods: 1, active: true }
  ],
  expenses: [],
  extraIncome: [],
  settings: { hideFreeBalance: true, roundExpensesUp: true }
};
function id(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function migrate(raw){
  const d = {...defaultData, ...raw};
  d.fixedCosts = Array.isArray(d.fixedCosts) ? d.fixedCosts : [];
  d.cancelableCosts = Array.isArray(d.cancelableCosts) ? d.cancelableCosts : [];
  d.expenses = Array.isArray(d.expenses) ? d.expenses : [];
  d.extraIncome = Array.isArray(d.extraIncome) ? d.extraIncome : [];
  d.consumptionCategories = Array.isArray(d.consumptionCategories) ? d.consumptionCategories : defaultData.consumptionCategories;
  d.budgetBuckets = Array.isArray(raw.budgetBuckets) ? raw.budgetBuckets : defaultData.budgetBuckets;
  d.settings = {...defaultData.settings, ...(raw.settings || {})};
  d.expenses = d.expenses.map(e => ({
    id: e.id || id(),
    kind: e.kind || 'free',
    bucketId: e.bucketId || '',
    category: String(e.category || 'Sonstiges').trim(),
    amount: Number(e.amount) || 0,
    note: String(e.note || '').trim(),
    date: normalizeDate(e.date)
  }));
  return d;
}
function load(){
  try {
    if(!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(defaultData,null,2));
    return migrate(JSON.parse(fs.readFileSync(DB_PATH,'utf8')));
  } catch(e){ return migrate(defaultData); }
}
function save(data){ fs.writeFileSync(DB_PATH, JSON.stringify(migrate(data),null,2)); }
function normalizeDate(v){
  v=String(v||'').trim();
  let m=v.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function cleanBucket(body, existing={}){
  const mode = ['money','unit','saving'].includes(body.mode) ? body.mode : (existing.mode || 'money');
  const unitAmount = Number(body.unitAmount) || Number(existing.unitAmount) || 0;
  const unitCount = Number(body.unitCount) || Number(existing.unitCount) || 0;
  const amount = mode === 'unit' ? unitAmount * unitCount : (body.amount === undefined ? Number(existing.amount || 0) : (Number(body.amount) || 0));
  return {
    ...existing,
    name: String(body.name || existing.name || '').trim() || 'Budget',
    amount,
    mode,
    unitAmount,
    unitCount,
    periods: Math.max(1, Math.min(6, Number(body.periods) || Number(existing.periods) || 4)),
    active: body.active === undefined ? (existing.active !== false) : !!body.active
  };
}

app.use(express.json({limit:'300kb'}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/data', (req,res)=> res.json(load()));
app.post('/api/income', (req,res)=> { const d=load(); d.income = Number(req.body.income)||0; save(d); res.json(d); });
app.post('/api/settings', (req,res)=> { const d=load(); d.settings = {...d.settings, ...req.body}; save(d); res.json(d); });
app.post('/api/cost', (req,res)=> { const d=load(); const type=req.body.type; if(!['fixedCosts','cancelableCosts'].includes(type)) return res.status(400).json({error:'bad type'}); d[type].push({id:id(), name:String(req.body.name||'').trim(), amount:Number(req.body.amount)||0}); save(d); res.json(d); });
app.patch('/api/cost/:type/:id', (req,res)=> { const d=load(); const type=req.params.type; if(!['fixedCosts','cancelableCosts'].includes(type)) return res.status(400).json({error:'bad type'}); const item=d[type].find(x=>x.id===req.params.id); if(!item) return res.status(404).json({error:'not found'}); item.name=String(req.body.name||'').trim(); item.amount=Number(req.body.amount)||0; save(d); res.json(d); });
app.delete('/api/cost/:type/:id', (req,res)=> { const d=load(); const type=req.params.type; if(!['fixedCosts','cancelableCosts'].includes(type)) return res.status(400).json({error:'bad type'}); d[type]=d[type].filter(x=>x.id!==req.params.id); save(d); res.json(d); });
app.post('/api/bucket', (req,res)=> { const d=load(); d.budgetBuckets.push({id:id(), ...cleanBucket(req.body)}); save(d); res.json(d); });
app.patch('/api/bucket/:id', (req,res)=> { const d=load(); const b=d.budgetBuckets.find(x=>x.id===req.params.id); if(!b) return res.status(404).json({error:'not found'}); Object.assign(b, cleanBucket(req.body, b)); save(d); res.json(d); });
app.delete('/api/bucket/:id', (req,res)=> { const d=load(); d.budgetBuckets=d.budgetBuckets.filter(x=>x.id!==req.params.id); d.expenses=d.expenses.map(e=>e.bucketId===req.params.id?{...e, kind:'free', bucketId:''}:e); save(d); res.json(d); });
app.post('/api/category', (req,res)=> { const d=load(); const name=String(req.body.name||'').trim(); if(name && !d.consumptionCategories.includes(name)) d.consumptionCategories.push(name); d.consumptionCategories.sort((a,b)=>a.localeCompare(b,'de')); save(d); res.json(d); });
app.delete('/api/category/:name', (req,res)=> { const d=load(); d.consumptionCategories=d.consumptionCategories.filter(x=>x!==req.params.name); save(d); res.json(d); });
app.post('/api/expense', (req,res)=> { const d=load(); const date=normalizeDate(req.body.date); const kind=req.body.kind==='budget'?'budget':'free'; const bucket=d.budgetBuckets.find(b=>b.id===req.body.bucketId); let amount=Number(req.body.amount)||0; let category=String(req.body.category||'Sonstiges').trim(); let bucketId=''; if(kind==='budget' && bucket){ bucketId=bucket.id; category=bucket.name; if(!amount && bucket.mode==='unit') amount=Number(bucket.unitAmount)||0; }
  if(d.settings.roundExpensesUp) amount=Math.ceil(amount);
  d.expenses.push({id:id(), kind: bucketId?'budget':'free', bucketId, category, amount, note:String(req.body.note||'').trim(), date}); save(d); res.json(d); });
app.patch('/api/expense/:id', (req,res)=> { const d=load(); const item=d.expenses.find(x=>x.id===req.params.id); if(!item) return res.status(404).json({error:'not found'}); const bucket=d.budgetBuckets.find(b=>b.id===req.body.bucketId); item.kind=req.body.kind==='budget'&&bucket?'budget':'free'; item.bucketId=item.kind==='budget'?bucket.id:''; item.category=item.kind==='budget'?bucket.name:String(req.body.category||item.category||'Sonstiges').trim(); item.amount=Number(req.body.amount)||0; item.note=String(req.body.note||'').trim(); item.date=normalizeDate(req.body.date||item.date); save(d); res.json(d); });
app.delete('/api/expense/:id', (req,res)=> { const d=load(); d.expenses=d.expenses.filter(x=>x.id!==req.params.id); save(d); res.json(d); });
app.post('/api/extra-income', (req,res)=> { const d=load(); const date=normalizeDate(req.body.date); d.extraIncome.push({id:id(), name:String(req.body.name||'Plusgeld').trim(), amount:Number(req.body.amount)||0, date, note:String(req.body.note||'').trim()}); save(d); res.json(d); });
app.delete('/api/extra-income/:id', (req,res)=> { const d=load(); d.extraIncome=d.extraIncome.filter(x=>x.id!==req.params.id); save(d); res.json(d); });
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, '127.0.0.1', ()=> console.log(`Budget Master läuft intern auf http://127.0.0.1:${PORT}`));
