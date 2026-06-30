let data=null; let shownMonth=new Date();
const euro=n=>(Number(n)||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const num=v=>Number(String(v||'').replace(',','.'))||0;
const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
async function api(url,opt){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt}); data=await r.json(); render();}
async function load(){const r=await fetch('/api/data'); data=await r.json(); q('#expenseDate').value=new Date().toISOString().slice(0,10); render();}
function sum(arr){return arr.reduce((s,x)=>s+num(x.amount),0)}
function monthKey(d){return d.toISOString().slice(0,7)}
function expensesThisMonth(){const k=monthKey(shownMonth); return data.expenses.filter(e=>String(e.date).slice(0,7)===k)}
function grouped(){const g={}; for(const e of expensesThisMonth()){g[e.category]=(g[e.category]||0)+num(e.amount)} return Object.entries(g).sort((a,b)=>b[1]-a[1])}
function render(){
 const fixed=sum(data.fixedCosts), cancel=sum(data.cancelableCosts), month=sum(expensesThisMonth()), running=fixed+cancel, free=data.income-running-month;
 q('#freeAmount').textContent=euro(free); q('#incomeTop').textContent=euro(data.income); q('#runningTop').textContent=euro(running); q('#monthTop').textContent=euro(month);
 q('#incomeOverview').textContent=euro(data.income); q('#fixedTotal').textContent=euro(fixed); q('#cancelTotal').textContent=euro(cancel); q('#runningTotal').textContent=euro(running);
 renderCostList('#fixedList',data.fixedCosts,'fixedCosts'); renderCostList('#cancelList',data.cancelableCosts,'cancelableCosts'); renderCostList('#monthFixed',data.fixedCosts,'fixedCosts',true); renderCostList('#monthCancel',data.cancelableCosts,'cancelableCosts',true);
 q('#expenseCategory').innerHTML=data.consumptionCategories.map(c=>`<option>${esc(c)}</option>`).join('') || '<option>Sonstiges</option>';
 q('#groupedExpenses').innerHTML=grouped().map(([c,a])=>`<div class="row"><div><b>${esc(c)}</b><small>${countCat(c)} Einträge</small></div><b>${euro(a)}</b><button onclick="showCat('${encodeURIComponent(c)}')">Details</button></div>`).join('') || '<p class="muted">Noch keine Konsumkosten in diesem Monat.</p>';
 q('#monthTitle').textContent=shownMonth.toLocaleDateString('de-DE',{month:'long',year:'numeric'}); renderCalendar(); renderCats();
}
function renderCostList(sel,arr,type,compact=false){q(sel).innerHTML=arr.map(x=>`<div class="row"><div><b>${esc(x.name)}</b><small>${euro(x.amount)}</small></div><b>${euro(x.amount)}</b>${compact?'':`<button onclick="delCost('${type}','${x.id}')">X</button>`}</div>`).join('') || '<p class="muted">Noch nichts eingetragen.</p>'}
function renderCats(){q('#categoryList').innerHTML=data.consumptionCategories.map(c=>`<span class="chip">${esc(c)} <button onclick="delCat('${encodeURIComponent(c)}')">×</button></span>`).join('')}
function renderCalendar(){const y=shownMonth.getFullYear(),m=shownMonth.getMonth(); const first=new Date(y,m,1); const days=new Date(y,m+1,0).getDate(); const offset=(first.getDay()+6)%7; let html=''; for(let i=0;i<offset;i++) html+='<div></div>'; for(let d=1;d<=days;d++){const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; const es=expensesThisMonth().filter(e=>e.date===date); html+=`<div class="day ${es.length?'hit':''}"><b>${d}</b>${es.map(e=>`<div>${esc(e.category)} ${euro(e.amount)}</div>`).join('')}</div>`} q('#calendar').innerHTML=html}
function countCat(c){return expensesThisMonth().filter(e=>e.category===c).length}
function showCat(c){c=decodeURIComponent(c); const lines=expensesThisMonth().filter(e=>e.category===c).map(e=>`${new Date(e.date).toLocaleDateString('de-DE')}: ${euro(e.amount)} ${e.note?'- '+e.note:''}`).join('\n'); alert(c+'\n\n'+lines)}
function esc(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
async function delCost(type,id){if(confirm('Eintrag löschen?')) await api(`/api/cost/${type}/${id}`,{method:'DELETE'});} async function delCat(c){if(confirm('Kategorie entfernen?')) await api(`/api/category/${decodeURIComponent(c)}`,{method:'DELETE'});} 
qa('[data-view]').forEach(b=>b.addEventListener('click',()=>{qa('.view').forEach(v=>v.classList.remove('active')); q('#'+b.dataset.view).classList.add('active'); window.scrollTo({top:0,behavior:'smooth'});}));
q('#expenseForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/expense',{method:'POST',body:JSON.stringify({category:q('#expenseCategory').value,amount:num(q('#expenseAmount').value),date:q('#expenseDate').value,note:q('#expenseNote').value})}); q('#expenseAmount').value=''; q('#expenseNote').value='';});
q('#incomeForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/income',{method:'POST',body:JSON.stringify({income:num(q('#incomeInput').value)})});});
q('#fixedForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/cost',{method:'POST',body:JSON.stringify({type:'fixedCosts',name:q('#fixedName').value,amount:num(q('#fixedAmount').value)})}); q('#fixedName').value=''; q('#fixedAmount').value='';});
q('#cancelForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/cost',{method:'POST',body:JSON.stringify({type:'cancelableCosts',name:q('#cancelName').value,amount:num(q('#cancelAmount').value)})}); q('#cancelName').value=''; q('#cancelAmount').value='';});
q('#categoryForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/category',{method:'POST',body:JSON.stringify({name:q('#categoryName').value})}); q('#categoryName').value='';});
q('#prevMonth').onclick=()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1); render()}; q('#nextMonth').onclick=()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1); render()}; q('#toggleCalendar').onclick=()=>q('#calendar').classList.toggle('hidden');
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}); load();
