let data=null, shownMonth=new Date(), balanceVisible=false;
const euro=n=>(Number(n)||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const num=v=>Number(String(v||'').replace(',','.'))||0;
const q=s=>document.querySelector(s); const qa=s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const attr=esc;
function isoToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function parseDateInput(v){v=String(v||'').trim();let m=v.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return isoToday()}
function formatDateInput(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}.${m[2]}.${m[1]}`:String(iso||'')}
function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function dateMonth(v){return parseDateInput(v).slice(0,7)}
function sum(a){return a.reduce((s,x)=>s+num(x.amount),0)}
async function api(url,opt={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt});data=await r.json();render()}
async function load(){const r=await fetch('/api/data');data=await r.json();balanceVisible=!data.settings?.hideFreeBalance;q('#expenseDate').value=formatDateInput(isoToday());q('#extraDate').value=formatDateInput(isoToday());render();}
const monthExpenses=()=>data.expenses.filter(e=>dateMonth(e.date)===monthKey(shownMonth));
const monthExtra=()=>data.extraIncome.filter(e=>dateMonth(e.date)===monthKey(shownMonth));
const activeBuckets=()=>data.budgetBuckets.filter(b=>b.active!==false);
function bucketBudget(b){return b.mode==='unit' ? num(b.unitAmount)*num(b.unitCount) : num(b.amount)}
function expensePeriod(e, periods){const day=Number(parseDateInput(e.date).slice(8,10));return Math.min(periods, Math.max(1, Math.ceil(day/(31/periods))))}
function currentPeriod(periods){const now=new Date();if(monthKey(now)!==monthKey(shownMonth))return 1;return Math.min(periods, Math.max(1, Math.ceil(now.getDate()/(31/periods))))}
function bucketStatus(b){
 const periods=Math.max(1, num(b.periods)||4), total=bucketBudget(b), items=monthExpenses().filter(e=>e.kind==='budget'&&e.bucketId===b.id);
 const spentBy=Array.from({length:periods},()=>0); for(const e of items) spentBy[expensePeriod(e,periods)-1]+=num(e.amount);
 const p=currentPeriod(periods); const spentPast=spentBy.slice(0,p-1).reduce((a,b)=>a+b,0); const availableNow=(total-spentPast)/(periods-p+1); const spentNow=spentBy[p-1]||0;
 const spent=sum(items), left=total-spent, nextAllowance=p<periods?(total-spentBy.slice(0,p).reduce((a,b)=>a+b,0))/(periods-p):0;
 const unitsUsed=b.mode==='unit'&&num(b.unitAmount)>0 ? Math.round(spent/num(b.unitAmount)*10)/10 : null;
 return {periods,total,items,spentBy,p,availableNow,spentNow,spent,left,nextAllowance,unitsUsed};
}
function totals(){
 const fixed=sum(data.fixedCosts), cancel=sum(data.cancelableCosts), extra=sum(monthExtra()), totalIncome=num(data.income)+extra, running=fixed+cancel;
 const reserved=activeBuckets().reduce((s,b)=>s+bucketBudget(b),0), budgetSpent=sum(monthExpenses().filter(e=>e.kind==='budget')), freeSpent=sum(monthExpenses().filter(e=>e.kind!=='budget'));
 return {fixed,cancel,extra,totalIncome,running,reserved,budgetSpent,freeSpent,free:totalIncome-running-reserved-freeSpent};
}
function render(){if(!data)return; const t=totals();
 q('#freeAmount').textContent=balanceVisible?euro(t.free):'•••• €'; q('#toggleBalance').textContent=balanceVisible?'🙈':'👁';
 q('#incomeTop').textContent=euro(t.totalIncome); q('#reservedTop').textContent=euro(t.reserved); q('#runningTop').textContent=euro(t.running); q('#spentTop').textContent=euro(t.budgetSpent+t.freeSpent);
 q('#incomeInput').value=String(data.income||'').replace('.',','); q('#hideFreeBalance').checked=!!data.settings.hideFreeBalance; q('#roundExpensesUp').checked=!!data.settings.roundExpensesUp;
 renderOptions(); renderBuckets(); renderLists(); renderMonth(); renderCalendar();
}
function renderOptions(){
 q('#expenseBucket').innerHTML=activeBuckets().map(b=>`<option value="${attr(b.id)}">${esc(b.name)}</option>`).join('');
 q('#expenseCategory').innerHTML=(data.consumptionCategories||['Sonstiges']).map(c=>`<option>${esc(c)}</option>`).join('');
 q('#categoryList').innerHTML=(data.consumptionCategories||[]).map(c=>`<span class="chip">${esc(c)} <button onclick="delCat('${encodeURIComponent(c)}')">×</button></span>`).join('');
}
function renderBuckets(){
 const cards=activeBuckets().map(b=>{const s=bucketStatus(b), pct=s.total?Math.min(140,Math.max(0,(s.spent/s.total)*100)):0, danger=s.left<0?'danger':s.spentNow>s.availableNow?'warn':'';
 const sub=b.mode==='unit'?`${s.unitsUsed||0} von ${num(b.unitCount)} Einheiten genutzt`:`Woche ${s.p}: ${euro(s.availableNow-s.spentNow)} übrig`;
 return `<article class="bucket-card ${danger}"><div class="bucket-top"><h3>${esc(b.name)}</h3><b>${euro(s.left)} übrig</b></div><div class="meter"><span style="width:${pct}%"></span></div><small>${sub}</small><div class="mini">Monat: ${euro(s.spent)} / ${euro(s.total)}${s.p<s.periods?` · nächste Woche ca. ${euro(s.nextAllowance)}`:''}</div></article>`}).join('');
 q('#bucketCards').innerHTML=cards || '<p class="muted">Noch keine Budget-Töpfe angelegt.</p>';
 q('#bucketSettings').innerHTML=data.budgetBuckets.map(b=>`<div class="row"><div><b>${esc(b.name)}</b><small>${b.active===false?'inaktiv · ':''}${b.mode==='unit'?`${num(b.unitCount)} × ${euro(b.unitAmount)}`:euro(bucketBudget(b))} · ${b.periods||4} Abschnitte</small></div><button onclick="toggleBucket('${b.id}',${b.active!==false?'false':'true'})">${b.active!==false?'Pause':'Aktiv'}</button><button onclick="delBucket('${b.id}','${esc(b.name)}')">X</button></div>`).join('');
}
function renderLists(){
 const t=totals(); q('#moneyFlow').innerHTML=`<div><span>Einnahmen</span><b>${euro(t.totalIncome)}</b></div><div><span>Fix + kündbar</span><b>-${euro(t.running)}</b></div><div><span>Budget-Töpfe reserviert</span><b>-${euro(t.reserved)}</b></div><div><span>freie Ausgaben</span><b>-${euro(t.freeSpent)}</b></div><div class="total"><span>frei verfügbar</span><b>${balanceVisible?euro(t.free):'•••• €'}</b></div>`;
 q('#freeList').innerHTML=monthExpenses().filter(e=>e.kind!=='budget').map(expenseRow).join('')||'<p class="muted">Keine freien Ausgaben in diesem Monat.</p>';
 q('#fixedList').innerHTML=costRows(data.fixedCosts,'fixedCosts'); q('#cancelList').innerHTML=costRows(data.cancelableCosts,'cancelableCosts');
 q('#monthExtraIncome').innerHTML=monthExtra().map(x=>`<div class="row"><div><b>${esc(x.name)}</b><small>${formatDateInput(x.date)}</small></div><b>${euro(x.amount)}</b><button onclick="delExtraIncome('${x.id}')">X</button></div>`).join('')||'<p class="muted">Kein Plusgeld.</p>';
}
function costRows(arr,type){return arr.map(x=>`<div class="row"><div><b>${esc(x.name)}</b></div><b>${euro(x.amount)}</b><button onclick="delCost('${type}','${x.id}','${esc(x.name)}')">X</button></div>`).join('')||'<p class="muted">Noch nichts eingetragen.</p>'}
function expenseRow(x){return `<div class="row expense-row"><div><b>${esc(x.category)}</b><small>${formatDateInput(x.date)}${x.note?' · '+esc(x.note):''}${x.kind==='budget'?' · Budget':' · frei'}</small></div><b>${euro(x.amount)}</b><button onclick="delExpense('${x.id}','${esc(x.category)}')">X</button></div>`}
function renderMonth(){
 q('#monthTitle').textContent=shownMonth.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
 const bucketReports=activeBuckets().map(b=>{const s=bucketStatus(b), diff=s.total-s.spent, cls=diff<0?'bad':'good';return `<article class="report ${cls}"><b>${esc(b.name)}</b><span>Budget ${euro(s.total)}</span><span>Ausgegeben ${euro(s.spent)}</span><strong>${diff>=0?'+':''}${euro(diff)}</strong><small>${s.total?Math.round((s.spent/s.total)*100):0}% genutzt</small></article>`}).join('');
 q('#reportSummary').innerHTML=bucketReports; q('#monthExpenses').innerHTML=monthExpenses().sort((a,b)=>parseDateInput(a.date).localeCompare(parseDateInput(b.date))).map(expenseRow).join('')||'<p class="muted">Noch keine Ausgaben.</p>';
}
function catAbbr(name){return String(name||'S').split(/\s+/).map(w=>w[0]).join('').slice(0,3).toUpperCase()}
function renderCalendar(){const y=shownMonth.getFullYear(),m=shownMonth.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),offset=(first.getDay()+6)%7;let html='';for(let i=0;i<offset;i++)html+='<div class="day empty"></div>';for(let d=1;d<=days;d++){const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const entries=monthExpenses().filter(e=>parseDateInput(e.date)===date);html+=`<button class="day ${entries.length?'hit':''}" onclick="showDay('${date}')"><b>${d}</b>${entries.slice(0,3).map(e=>`<span>${catAbbr(e.category)} ${euro(e.amount)}</span>`).join('')}${entries.length>3?`<em>+${entries.length-3}</em>`:''}</button>`}q('#calendar').innerHTML=html}
function showDay(date){const entries=monthExpenses().filter(e=>parseDateInput(e.date)===date);openHtml(`<h3>${formatDateInput(date)}</h3>${entries.map(expenseRow).join('')||'<p class="muted">Keine Ausgaben.</p>'}`,false)}
function setView(id){qa('.view').forEach(v=>v.classList.toggle('active',v.id===id));qa('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));}
function openHtml(html,confirm=false){q('#modalText').innerHTML=html;q('#modal').classList.remove('hidden');q('#modalCancel').style.display=confirm?'inline-flex':'none';return new Promise(res=>{q('#modalOk').onclick=()=>{q('#modal').classList.add('hidden');res(true)};q('#modalCancel').onclick=()=>{q('#modal').classList.add('hidden');res(false)}})}
async function ask(txt){return await openHtml(`<p>${esc(txt)}</p>`,true)}
async function delCost(type,id,name){if(await ask(`${name} löschen?`))api(`/api/cost/${type}/${id}`,{method:'DELETE'})}
async function delBucket(id,name){if(await ask(`${name} löschen? Alte Ausgaben bleiben als freie Ausgaben erhalten.`))api(`/api/bucket/${id}`,{method:'DELETE'})}
async function toggleBucket(id,active){api(`/api/bucket/${id}`,{method:'PATCH',body:JSON.stringify({active})})}
async function delExpense(id,name){if(await ask(`${name} löschen?`))api(`/api/expense/${id}`,{method:'DELETE'})}
async function delExtraIncome(id){api(`/api/extra-income/${id}`,{method:'DELETE'})}
async function delCat(c){api(`/api/category/${decodeURIComponent(c)}`,{method:'DELETE'})}
function csv(){const rows=[['Datum','Art','Kategorie','Notiz','Betrag']];for(const e of monthExpenses())rows.push([formatDateInput(e.date),e.kind==='budget'?'Budget':'Frei',e.category,e.note,e.amount]);const text=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=`budget-${monthKey(shownMonth)}.csv`;a.click();}
function printReport(){window.print()}
function wire(){
 qa('.nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view)); q('#goAdd').onclick=()=>setView('addExpense'); q('#toggleBalance').onclick=()=>{balanceVisible=!balanceVisible;render()};
 q('#expenseKind').onchange=()=>{const free=q('#expenseKind').value==='free';q('#bucketWrap').classList.toggle('hidden',free);q('#categoryWrap').classList.toggle('hidden',!free)};
 q('#bucketMode').onchange=()=>{const u=q('#bucketMode').value==='unit';q('#bucketUnitAmount').classList.toggle('hidden',!u);q('#bucketUnitCount').classList.toggle('hidden',!u);q('#bucketAmount').classList.toggle('hidden',u)};
 q('#prevMonth').onclick=()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1);render()}; q('#nextMonth').onclick=()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1);render()};
 q('#exportCsv').onclick=csv; q('#printReport').onclick=printReport;
 q('#hideFreeBalance').onchange=e=>api('/api/settings',{method:'POST',body:JSON.stringify({hideFreeBalance:e.target.checked})}); q('#roundExpensesUp').onchange=e=>api('/api/settings',{method:'POST',body:JSON.stringify({roundExpensesUp:e.target.checked})});
 q('#incomeForm').onsubmit=e=>{e.preventDefault();api('/api/income',{method:'POST',body:JSON.stringify({income:num(q('#incomeInput').value)})})};
 q('#expenseForm').onsubmit=e=>{e.preventDefault();api('/api/expense',{method:'POST',body:JSON.stringify({kind:q('#expenseKind').value,bucketId:q('#expenseBucket').value,category:q('#expenseCategory').value,amount:num(q('#expenseAmount').value),date:q('#expenseDate').value,note:q('#expenseNote').value})});q('#expenseAmount').value='';q('#expenseNote').value=''};
 q('#bucketForm').onsubmit=e=>{e.preventDefault();api('/api/bucket',{method:'POST',body:JSON.stringify({name:q('#bucketName').value,mode:q('#bucketMode').value,amount:num(q('#bucketAmount').value),unitAmount:num(q('#bucketUnitAmount').value),unitCount:num(q('#bucketUnitCount').value),periods:num(q('#bucketPeriods').value)||4})});['#bucketName','#bucketAmount','#bucketUnitAmount','#bucketUnitCount','#bucketPeriods'].forEach(s=>q(s).value='')};
 q('#fixedForm').onsubmit=e=>{e.preventDefault();api('/api/cost',{method:'POST',body:JSON.stringify({type:'fixedCosts',name:q('#fixedName').value,amount:num(q('#fixedAmount').value)})});q('#fixedName').value=q('#fixedAmount').value=''};
 q('#cancelForm').onsubmit=e=>{e.preventDefault();api('/api/cost',{method:'POST',body:JSON.stringify({type:'cancelableCosts',name:q('#cancelName').value,amount:num(q('#cancelAmount').value)})});q('#cancelName').value=q('#cancelAmount').value=''};
 q('#extraIncomeForm').onsubmit=e=>{e.preventDefault();api('/api/extra-income',{method:'POST',body:JSON.stringify({name:q('#extraName').value,amount:num(q('#extraAmount').value),date:q('#extraDate').value})});q('#extraName').value=q('#extraAmount').value=''};
 q('#categoryForm').onsubmit=e=>{e.preventDefault();api('/api/category',{method:'POST',body:JSON.stringify({name:q('#categoryName').value})});q('#categoryName').value=''};
}
wire();load();
