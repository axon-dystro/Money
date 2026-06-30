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
  consumptionCategories: ['Lidl','Aldi','Rewe','Edeka','Aral','Tanken','Essen','Arbeit','Freizeit'],
  expenses: []
};
function load(){
  try { if(!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(defaultData,null,2));
    const raw = JSON.parse(fs.readFileSync(DB_PATH,'utf8'));
    return {...defaultData, ...raw};
  } catch(e){ return defaultData; }
}
function save(data){ fs.writeFileSync(DB_PATH, JSON.stringify(data,null,2)); }
function id(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

app.use(express.json({limit:'200kb'}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/data', (req,res)=> res.json(load()));
app.post('/api/income', (req,res)=> { const d=load(); d.income = Number(req.body.income)||0; save(d); res.json(d); });
app.post('/api/cost', (req,res)=> { const d=load(); const type=req.body.type; if(!['fixedCosts','cancelableCosts'].includes(type)) return res.status(400).json({error:'bad type'}); d[type].push({id:id(), name:String(req.body.name||'').trim(), amount:Number(req.body.amount)||0}); save(d); res.json(d); });
app.delete('/api/cost/:type/:id', (req,res)=> { const d=load(); const type=req.params.type; if(!['fixedCosts','cancelableCosts'].includes(type)) return res.status(400).json({error:'bad type'}); d[type]=d[type].filter(x=>x.id!==req.params.id); save(d); res.json(d); });
app.post('/api/category', (req,res)=> { const d=load(); const name=String(req.body.name||'').trim(); if(name && !d.consumptionCategories.includes(name)) d.consumptionCategories.push(name); d.consumptionCategories.sort((a,b)=>a.localeCompare(b,'de')); save(d); res.json(d); });
app.delete('/api/category/:name', (req,res)=> { const d=load(); d.consumptionCategories=d.consumptionCategories.filter(x=>x!==req.params.name); save(d); res.json(d); });
app.post('/api/expense', (req,res)=> { const d=load(); const now=new Date(); const date=String(req.body.date||now.toISOString().slice(0,10)); d.expenses.push({id:id(), category:String(req.body.category||'Sonstiges').trim(), amount:Number(req.body.amount)||0, note:String(req.body.note||'').trim(), date}); save(d); res.json(d); });
app.delete('/api/expense/:id', (req,res)=> { const d=load(); d.expenses=d.expenses.filter(x=>x.id!==req.params.id); save(d); res.json(d); });
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, '127.0.0.1', ()=> console.log(`Budget Master läuft intern auf http://127.0.0.1:${PORT}`));
