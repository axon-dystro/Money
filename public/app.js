let data=null; let shownMonth=new Date(); let editCost=null; let pendingConfirm=null;
const euro=n=>(Number(n)||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const num=v=>Number(String(v||'').replace(',','.'))||0;
const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
function isoToday(){const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function formatDateInput(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?`${m[3]}.${m[2]}.${m[1]}`:String(iso||'')}
function parseDateInput(v){v=String(v||'').trim(); let m=v.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/); if(m){return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`} m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(m){return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`} return isoToday();}
async function api(url,opt={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt}); data=await r.json(); render();}
async function load(){const r=await fetch('/api/data'); data=await r.json(); q('#expenseDate').value=formatDateInput(isoToday()); q('#extraDate').value=formatDateInput(isoToday()); render();}
function sum(arr){return arr.reduce((s,x)=>s+num(x.amount),0)}
function monthKey(d){return d.toISOString().slice(0,7)}
function dateKey(v){return parseDateInput(v).slice(0,7)}
function expenseDate(v){return parseDateInput(v)}
function expensesThisMonth(){const k=monthKey(shownMonth); return data.expenses.filter(e=>dateKey(e.date)===k)}
function extraThisMonth(){const k=monthKey(shownMonth); return (data.extraIncome||[]).filter(e=>dateKey(e.date)===k)}
function grouped(){const g={}; for(const e of expensesThisMonth()){g[e.category]=(g[e.category]||0)+num(e.amount)} return Object.entries(g).sort((a,b)=>b[1]-a[1])}
function render(){
 const fixed=sum(data.fixedCosts), cancel=sum(data.cancelableCosts), month=sum(expensesThisMonth()), extra=sum(extraThisMonth()), running=fixed+cancel, totalIncome=(num(data.income)+extra), free=totalIncome-running-month;
 q('#freeAmount').textContent=euro(free); q('#incomeTop').textContent=euro(data.income); q('#extraTop').textContent=euro(extra); q('#runningTop').textContent=euro(running); q('#monthTop').textContent=euro(month);
 q('#incomeOverview').textContent=euro(data.income); q('#extraOverview').textContent=euro(extra); q('#totalIncomeOverview').textContent=euro(totalIncome); q('#fixedTotal').textContent=euro(fixed); q('#cancelTotal').textContent=euro(cancel); q('#runningTotal').textContent=euro(running);
 renderCostList('#fixedList',data.fixedCosts,'fixedCosts'); renderCostList('#cancelList',data.cancelableCosts,'cancelableCosts'); renderCostList('#monthFixed',data.fixedCosts,'fixedCosts',true); renderCostList('#monthCancel',data.cancelableCosts,'cancelableCosts',true); renderExtraIncome();
 q('#expenseCategory').innerHTML=data.consumptionCategories.map(c=>`<option>${esc(c)}</option>`).join('') || '<option>Sonstiges</option>';
 q('#groupedExpenses').innerHTML=grouped().map(([c,a])=>`<div class="row"><div><b>${esc(c)}</b><small>${countCat(c)} Einträge</small></div><b>${euro(a)}</b><button onclick="showCat('${encodeURIComponent(c)}')">Details</button></div>`).join('') || '<p class="muted">Noch keine Konsumkosten in diesem Monat.</p>';
 q('#monthTitle').textContent=shownMonth.toLocaleDateString('de-DE',{month:'long',year:'numeric'}); renderCalendar(); renderCats();
}
function renderExtraIncome(){
 q('#monthExtraIncome').innerHTML=extraThisMonth().map(x=>`<div class="row"><div><b>${esc(x.name)}</b><small>${formatDateInput(x.date)}${x.note?' · '+esc(x.note):''}</small></div><b>${euro(x.amount)}</b><div class="actions"><button title="Löschen" onclick="delExtraIncome('${x.id}','${esc(x.name)}')">X</button></div></div>`).join('') || '<p class="muted">Kein Plusgeld für diesen Monat eingetragen.</p>';
}
function renderCostList(sel,arr,type,compact=false){
 q(sel).innerHTML=arr.map(x=>{
   const isEdit=editCost && editCost.type===type && editCost.id===x.id;
   if(isEdit){return `<form class="row edit-row" onsubmit="saveCostEdit(event,'${type}','${x.id}')"><input name="name" value="${attr(x.name)}"><input name="amount" inputmode="decimal" value="${attr(String(x.amount).replace('.',','))}"><button type="submit">Speichern</button><button type="button" onclick="cancelCostEdit()">Abbrechen</button></form>`}
   return `<div class="row"><div><b>${esc(x.name)}</b></div><b>${euro(x.amount)}</b>${compact?'':`<div class="actions"><button title="Bearbeiten" onclick="startCostEdit('${type}','${x.id}')">✎</button><button title="Löschen" onclick="delCost('${type}','${x.id}','${esc(x.name)}')">X</button></div>`}</div>`
 }).join('') || '<p class="muted">Noch nichts eingetragen.</p>'
}
function startCostEdit(type,id){editCost={type,id}; render();}
function cancelCostEdit(){editCost=null; render();}
async function saveCostEdit(e,type,id){e.preventDefault(); const fd=new FormData(e.target); editCost=null; await api(`/api/cost/${type}/${id}`,{method:'PATCH',body:JSON.stringify({name:fd.get('name'),amount:num(fd.get('amount'))})});}
function renderCats(){q('#categoryList').innerHTML=data.consumptionCategories.map(c=>`<span class="chip">${esc(c)} <button onclick="delCat('${encodeURIComponent(c)}','${esc(c)}')">×</button></span>`).join('')}
function catAbbr(name){
 const raw=String(name||'').trim();
 const map={
  'rechnung ausm vormonat':'RAV','rechnung aus dem vormonat':'RAV','rechnung aus vormonat':'RAV','vormonat':'VM',
  'leihgabe':'LG','lidl':'L','aldi':'A','rewe':'R','edeka':'EDE','aral':'AR','tanken':'T','essen':'E','arbeit':'AB','freizeit':'F'
 };
 const key=raw.toLowerCase().replace(/\s+/g,' ');
 if(map[key]) return map[key];
 const words=raw.split(/\s+/).filter(Boolean);
 if(words.length===1) return words[0].slice(0,3).toUpperCase();
 return words.map(w=>w[0]).join('').slice(0,3).toUpperCase();
}
function weekdayShort(date){return ['SO','MO','DI','MI','DO','FR','SA'][date.getDay()]}
function entriesForDay(date){return expensesThisMonth().filter(e=>parseDateInput(e.date)===date)}
function groupedDayEntries(entries){
 const g={};
 for(const e of entries){
  const c=e.category||'Sonstiges';
  if(!g[c]) g[c]={category:c, amount:0, count:0, notes:[]};
  g[c].amount += num(e.amount); g[c].count += 1;
  if(e.note) g[c].notes.push(e.note);
 }
 return Object.values(g).sort((a,b)=>b.amount-a.amount);
}
function showDay(date){
 const entries=entriesForDay(date);
 const nice=formatDateInput(date);
 if(!entries.length){openNotice(`${nice}\n\nKeine Konsumkosten eingetragen.`); return;}
 const lines=entries.map(e=>`${esc(e.category).replace(/&#039;/g,"'")}: ${euro(e.amount)}${e.note?' - '+e.note:''}`).join('\n');
 openNotice(`${nice}\n\n${lines}`);
}
function renderCalendar(){
 const y=shownMonth.getFullYear(),m=shownMonth.getMonth();
 const first=new Date(y,m,1), days=new Date(y,m+1,0).getDate(), offset=(first.getDay()+6)%7;
 let html='';
 for(let i=0;i<offset;i++) html+='<div class="day empty"></div>';
 for(let d=1;d<=days;d++){
  const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dateObj=new Date(y,m,d);
  const entries=groupedDayEntries(entriesForDay(date));
  const visible=entries.slice(0,3);
  const more=entries.length-visible.length;
  const title=entries.map(e=>`${e.category}: ${euro(e.amount)}`).join('\n');
  html+=`<button type="button" class="day ${entries.length?'hit':''}" title="${attr(title)}" onclick="showDay('${date}')"><span class="day-head"><b>${d}</b><em>${weekdayShort(dateObj)}</em></span><span class="day-items">${visible.map(e=>`<span class="day-entry"><strong>${esc(catAbbr(e.category))}</strong> ${euro(e.amount)}</span>`).join('')}${more?`<span class="day-more">+${more} weitere</span>`:''}</span></button>`;
 }
 q('#calendar').innerHTML=html;
}
function countCat(c){return expensesThisMonth().filter(e=>e.category===c).length}
function showCat(c){c=decodeURIComponent(c); const lines=expensesThisMonth().filter(e=>e.category===c).map(e=>`${formatDateInput(e.date)}: ${euro(e.amount)} ${e.note?'- '+e.note:''}`).join('\n'); openNotice(c+'\n\n'+lines)}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function attr(s){return esc(s)}
function openConfirm(text,onOk){pendingConfirm=onOk; q('#modalText').textContent=text; q('#modal').classList.remove('hidden')}
function openNotice(text){pendingConfirm=null; q('#modalText').textContent=text; q('#modal').classList.remove('hidden'); q('#modalCancel').classList.add('hidden')}
function closeModal(){q('#modal').classList.add('hidden'); q('#modalCancel').classList.remove('hidden'); pendingConfirm=null}
function confirmModal(){const fn=pendingConfirm; closeModal(); if(fn) fn()}
async function delCost(type,id,name){openConfirm(`Eintrag „${name}“ wirklich löschen?`,()=>api(`/api/cost/${type}/${id}`,{method:'DELETE'}));}
async function delCat(c,name){openConfirm(`Kategorie „${name}“ wirklich entfernen?`,()=>api(`/api/category/${decodeURIComponent(c)}`,{method:'DELETE'}));}
async function delExtraIncome(id,name){openConfirm(`Plusgeld „${name}“ wirklich löschen?`,()=>api(`/api/extra-income/${id}`,{method:'DELETE'}));}
qa('[data-view]').forEach(b=>b.addEventListener('click',()=>{qa('.view').forEach(v=>v.classList.remove('active')); q('#'+b.dataset.view).classList.add('active'); window.scrollTo({top:0,behavior:'smooth'});}));
q('#expenseForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/expense',{method:'POST',body:JSON.stringify({category:q('#expenseCategory').value,amount:num(q('#expenseAmount').value),date:parseDateInput(q('#expenseDate').value),note:q('#expenseNote').value})}); q('#expenseAmount').value=''; q('#expenseNote').value='';});
q('#incomeForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/income',{method:'POST',body:JSON.stringify({income:num(q('#incomeInput').value)})});});
q('#extraIncomeForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/extra-income',{method:'POST',body:JSON.stringify({name:q('#extraName').value,amount:num(q('#extraAmount').value),date:parseDateInput(q('#extraDate').value)})}); q('#extraName').value=''; q('#extraAmount').value=''; q('#extraDate').value=formatDateInput(isoToday());});
q('#fixedForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/cost',{method:'POST',body:JSON.stringify({type:'fixedCosts',name:q('#fixedName').value,amount:num(q('#fixedAmount').value)})}); q('#fixedName').value=''; q('#fixedAmount').value='';});
q('#cancelForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/cost',{method:'POST',body:JSON.stringify({type:'cancelableCosts',name:q('#cancelName').value,amount:num(q('#cancelAmount').value)})}); q('#cancelName').value=''; q('#cancelAmount').value='';});
q('#categoryForm').addEventListener('submit',e=>{e.preventDefault(); api('/api/category',{method:'POST',body:JSON.stringify({name:q('#categoryName').value})}); q('#categoryName').value='';});
q('#prevMonth').onclick=()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1); render()}; q('#nextMonth').onclick=()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1); render()};
q('#modalOk').onclick=confirmModal; q('#modalCancel').onclick=closeModal;
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}); load();
