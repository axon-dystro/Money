let data = null;
let shownMonth = new Date();
let balanceVisible = false;
let statementPreviewData = null;

const euro = n => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const num = v => Number(String(v || '').replace(',', '.')) || 0;
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const attr = esc;

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDateInput(v) {
  v = String(v || '').trim();
  let m = v.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isoToday();
}
function formatDateInput(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function dateMonth(v) { return parseDateInput(v).slice(0, 7); }
function sum(a) { return a.reduce((s, x) => s + num(x.amount), 0); }
const frequencyLabels = {
  weekly: 'wöchentlich', biweekly: 'alle 2 Wochen', monthly: 'monatlich',
  quarterly: 'vierteljährlich', yearly: 'jährlich', one_time: 'einmalig'
};
function frequencyLabel(value) { return frequencyLabels[value] || frequencyLabels.monthly; }
function monthlyEquivalent(amount, frequency = 'monthly', dueDate = '') {
  const value = num(amount);
  if (frequency === 'weekly') return value * 52 / 12;
  if (frequency === 'biweekly') return value * 26 / 12;
  if (frequency === 'quarterly') return value / 3;
  if (frequency === 'yearly') return value / 12;
  if (frequency === 'one_time') return String(dueDate || '').slice(0, 7) === monthKey(shownMonth) ? value : 0;
  return value;
}
function activeBuckets() { return (data.budgetBuckets || []).filter(b => b.active !== false); }
function monthExpenses() { return (data.expenses || []).filter(e => dateMonth(e.date) === monthKey(shownMonth)); }
function monthExtra() { return (data.extraIncome || []).filter(e => dateMonth(e.date) === monthKey(shownMonth)); }
function bucketBaseAmount(b) { return b.mode === 'unit' ? num(b.unitAmount) * num(b.unitCount) : num(b.amount); }
function bucketBudget(b) { return monthlyEquivalent(bucketBaseAmount(b), b.frequency, b.dueDate); }
function costBudget(c) { return monthlyEquivalent(c.amount, c.frequency, c.dueDate); }
function bucketName(id) { return (data.budgetBuckets || []).find(b => b.id === id)?.name || 'Freie Verwendung'; }
function freeBucketId() { return (data.budgetBuckets || []).find(b => b.system === 'free_use' || b.id === 'bucket_frei')?.id || activeBuckets()[0]?.id || ''; }
function transactionLabel(x) {
  if (x.kind === 'fixedCosts') return (data.fixedCosts || []).find(c => c.id === x.costId)?.name || x.category || 'Fixkosten';
  if (x.kind === 'cancelableCosts') return (data.cancelableCosts || []).find(c => c.id === x.costId)?.name || x.category || 'Kündbare Kosten';
  return bucketName(x.bucketId);
}

async function api(url, opt = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opt });
  data = await r.json();
  render();
}
async function load() {
  const r = await fetch('/api/data');
  data = await r.json();
  balanceVisible = !data.settings?.hideFreeBalance;
  q('#expenseDate').value = formatDateInput(isoToday());
  q('#extraDate').value = formatDateInput(isoToday());
  render();
  applyInitialView();
}

function expensePeriod(e, periods) {
  const day = Number(parseDateInput(e.date).slice(8, 10));
  return Math.min(periods, Math.max(1, Math.ceil(day / (31 / periods))));
}
function currentPeriod(periods) {
  const now = new Date();
  if (monthKey(now) !== monthKey(shownMonth)) return 1;
  return Math.min(periods, Math.max(1, Math.ceil(now.getDate() / (31 / periods))));
}
function expensesForBucket(b) {
  return monthExpenses().filter(e => e.kind !== 'fixedCosts' && e.kind !== 'cancelableCosts').filter(e => e.bucketId === b.id || (!e.bucketId && b.id === freeBucketId()));
}
function bucketStatus(b) {
  const periods = Math.max(1, num(b.periods) || 4);
  const total = bucketBudget(b);
  const items = expensesForBucket(b);
  const spentBy = Array.from({ length: periods }, () => 0);
  for (const e of items) spentBy[expensePeriod(e, periods) - 1] += num(e.amount);

  const p = currentPeriod(periods);
  const spentPast = spentBy.slice(0, p - 1).reduce((a, b) => a + b, 0);
  const availableNow = (total - spentPast) / Math.max(1, periods - p + 1);
  const spentNow = spentBy[p - 1] || 0;
  const spent = sum(items);
  const left = total - spent;
  const spentUntilNow = spentBy.slice(0, p).reduce((a, b) => a + b, 0);
  const nextAllowance = p < periods ? (total - spentUntilNow) / Math.max(1, periods - p) : 0;
  const unitsUsed = b.mode === 'unit' && num(b.unitAmount) > 0 ? Math.round(spent / num(b.unitAmount) * 10) / 10 : null;

  return { periods, total, items, spentBy, p, availableNow, spentNow, spent, left, nextAllowance, unitsUsed };
}
function totals() {
  const fixed = (data.fixedCosts || []).reduce((total, item) => total + costBudget(item), 0);
  const cancel = (data.cancelableCosts || []).reduce((total, item) => total + costBudget(item), 0);
  const extra = sum(monthExtra());
  const totalIncome = num(data.income) + extra;
  const running = fixed + cancel;
  const reserved = activeBuckets().reduce((s, b) => s + bucketBudget(b), 0);
  const expenses = monthExpenses();
  const allSpent = sum(expenses);
  const bucketIds = new Set(activeBuckets().map(b=>b.id));
  const unbucketed = expenses.filter(e => e.kind !== 'fixedCosts' && e.kind !== 'cancelableCosts').filter(e=>!e.bucketId || !bucketIds.has(e.bucketId)).reduce((a,e)=>a+num(e.amount),0);
  const overspend = activeBuckets().reduce((a,b)=>{ const st=bucketStatus(b); return a+Math.max(0,-st.left); },0);
  const unplanned = totalIncome - running - reserved - unbucketed - overspend;
  return { fixed, cancel, extra, totalIncome, running, reserved, allSpent, unplanned };
}
function moneyFlowRows(t) {
  return `
    <div class="flow-row"><span>Einnahmen</span><b>${euro(t.totalIncome)}</b></div>
    <div class="flow-row"><span>Fixkosten</span><b>-${euro(t.fixed)}</b></div>
    <div class="flow-row"><span>Kündbar</span><b>-${euro(t.cancel)}</b></div>
    <div class="flow-row"><span>Budget-Töpfe</span><b>-${euro(t.reserved)}</b></div>
    <div class="flow-row total"><span>Nicht verplant</span><b>${balanceVisible ? euro(t.unplanned) : '•••• €'}</b></div>`;
}
function bucketCardHtml(b, compact = false) {
  const s = bucketStatus(b);
  const pct = s.total ? Math.min(140, Math.max(0, (s.spent / s.total) * 100)) : 0;
  let state = 'good';
  if (s.left < 0) state = 'danger';
  else if (s.spentNow > s.availableNow) state = 'warn';

  const amountLine = b.mode === 'unit'
    ? `${s.unitsUsed || 0} von ${num(b.unitCount)} Einheiten genutzt`
    : `Aktueller Abschnitt: ${euro(s.availableNow - s.spentNow)} übrig`;
  const cadence = `${frequencyLabel(b.frequency)} · Monatsanteil ${euro(s.total)}`;
  const nextLine = s.p < s.periods ? `${cadence} · nächster Abschnitt ca. ${euro(s.nextAllowance)}` : `${cadence} · letzter Abschnitt des Monats`;

  return `<article class="bucket-card ${state}${compact ? ' quick-card' : ''}">
    <div class="bucket-top"><h3>${esc(b.name)}</h3><b>${euro(s.left)} übrig</b></div>
    <div class="meter" aria-label="${Math.round(pct)} Prozent genutzt"><span style="width:${pct}%"></span></div>
    <div class="bucket-meta"><span>${euro(s.spent)} / ${euro(s.total)}</span><span>${s.total ? Math.round((s.spent / s.total) * 100) : 0}% genutzt</span></div>
    <p class="budget-note"><strong>${esc(amountLine)}</strong>${compact ? '' : `<br>${esc(nextLine)}`}</p>
  </article>`;
}
function moneyFlowCardHtml() {
  return `<article class="bucket-card flow-card">
    <div class="bucket-top"><h3>Geldfluss</h3><b>${balanceVisible ? euro(totals().unplanned) : '•••• €'}</b></div>
    <div class="flow compact-flow">${moneyFlowRows(totals())}</div>
  </article>`;
}

function render() {
  if (!data) return;
  const t = totals();
  q('#freeAmount').textContent = balanceVisible ? euro(t.unplanned) : '•••• €';
  q('#toggleBalance').textContent = balanceVisible ? '🙈' : '👁';
  q('#incomeTop').textContent = euro(t.totalIncome);
  q('#reservedTop').textContent = euro(t.reserved);
  q('#runningTop').textContent = euro(t.running);
  q('#spentTop').textContent = euro(t.allSpent);
  q('#incomeInput').value = String(data.income || '').replace('.', ',');
  q('#hideFreeBalance').checked = !!data.settings?.hideFreeBalance;
  q('#roundExpensesUp').checked = !!data.settings?.roundExpensesUp;

  renderOptions();
  renderBuckets();
  renderLists();
  renderMonth();
  renderCalendar();
  renderPrintReport();
}

function renderOptions() {
  q('#expenseBucket').innerHTML = activeBuckets().map(b => `<option value="${attr(b.id)}">${esc(b.name)}</option>`).join('');
}

function renderBuckets() {
  const cards = activeBuckets().map(b => bucketCardHtml(b)).join('');
  q('#bucketCards').innerHTML = cards ? `${cards}${moneyFlowCardHtml()}` : '<p class="empty-note">Noch keine Budget-Töpfe angelegt.</p>';
  renderQuickBudgetOverview();

  q('#bucketSettings').innerHTML = (data.budgetBuckets || []).map(b => {
    const details = b.mode === 'unit' ? `${num(b.unitCount)} × ${euro(b.unitAmount)}` : `${euro(bucketBaseAmount(b))}`;
    const monthly = bucketBudget(b);
    const isFree = b.system === 'free_use' || b.id === 'bucket_frei';
    const deleteDisabled = isFree ? 'disabled title="Freie Verwendung kann nicht gelöscht werden"' : '';
    const stateButton = isFree
      ? '<button class="state-btn" type="button" disabled>Standard</button>'
      : `<button class="state-btn" type="button" onclick="toggleBucket('${b.id}',${b.active !== false ? 'false' : 'true'})">${b.active !== false ? 'Pause' : 'Aktiv'}</button>`;
    return `<div class="row settings-row">
      <div><b>${esc(b.name)}</b><small>${b.active === false ? 'inaktiv · ' : ''}${details} ${frequencyLabel(b.frequency)} · Monatsanteil ${euro(monthly)} · ${b.periods || 4} Abschnitt(e)</small></div>
      ${stateButton}
      <button class="edit-btn" type="button" onclick="editBucket('${b.id}')" aria-label="Budget-Topf bearbeiten">✎</button>
      <button class="delete-btn" type="button" ${deleteDisabled} onclick="delBucket('${b.id}','${attr(b.name)}')" aria-label="Budget-Topf löschen">×</button>
    </div>`;
  }).join('');
}
function renderQuickBudgetOverview() {
  const target = q('#quickBudgetOverview');
  if (!target) return;
  const buckets = activeBuckets();
  target.innerHTML = buckets.length ? `
    <div class="quick-budget-head"><span>Budgetstatus</span><button type="button" onclick="setView('dashboard')">Details</button></div>
    <div class="quick-budget-grid">${buckets.map(b => bucketCardHtml(b, true)).join('')}</div>` : '';
}

function renderLists() {
  const latest = [...monthExpenses()].sort((a, b) => parseDateInput(b.date).localeCompare(parseDateInput(a.date))).slice(0, 8);
  q('#recentList').innerHTML = latest.map(expenseRow).join('') || '<p class="empty-note">Noch keine Buchungen in diesem Monat.</p>';
  q('#fixedList').innerHTML = costRows(data.fixedCosts || [], 'fixedCosts');
  q('#cancelList').innerHTML = costRows(data.cancelableCosts || [], 'cancelableCosts');
  q('#monthExtraIncome').innerHTML = monthExtra().map(x => `<div class="row"><div><b>${esc(x.name)}</b><small>${formatDateInput(x.date)}</small></div><b>${euro(x.amount)}</b><button class="edit-btn" type="button" onclick="editExtraIncome('${x.id}')" aria-label="Plusgeld bearbeiten">✎</button><button class="delete-btn" type="button" onclick="delExtraIncome('${x.id}')" aria-label="Plusgeld löschen">×</button></div>`).join('') || '<p class="empty-note">Kein Plusgeld in diesem Monat.</p>';
}
function costRows(arr, type) {
  return arr.map(x => `<div class="row"><div><b>${esc(x.name)}</b><small>${euro(x.amount)} ${frequencyLabel(x.frequency)} · Monatsanteil ${euro(costBudget(x))}${x.frequency === 'one_time' && x.dueDate ? ` · fällig ${formatDateInput(x.dueDate)}` : ''}</small></div><b>${euro(costBudget(x))}</b><button class="edit-btn" type="button" onclick="editCost('${type}','${x.id}')" aria-label="Kosten bearbeiten">✎</button><button class="delete-btn" type="button" onclick="delCost('${type}','${x.id}','${attr(x.name)}')" aria-label="Kosten löschen">×</button></div>`).join('') || '<p class="empty-note">Noch nichts eingetragen.</p>';
}
function expenseRow(x) {
  const bucket = transactionLabel(x);
  const note = x.note ? esc(x.note) : 'ohne Notiz';
  return `<div class="row expense-row"><div><b>${esc(bucket)}</b><small>${formatDateInput(x.date)} · ${note}</small></div><b>${euro(x.amount)}</b><button class="edit-btn" type="button" onclick="editExpense('${x.id}')" aria-label="Ausgabe bearbeiten">✎</button><button class="delete-btn" type="button" onclick="delExpense('${x.id}','${attr(bucket)}')" aria-label="Ausgabe löschen">×</button></div>`;
}

function renderMonth() {
  q('#monthTitle').textContent = shownMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const rows = activeBuckets().map(b => {
    const s = bucketStatus(b);
    const diff = s.total - s.spent;
    const cls = diff < 0 ? 'bad-text' : diff === 0 ? 'warn-text' : 'good-text';
    const note = b.mode === 'unit' ? `${s.unitsUsed || 0} / ${num(b.unitCount)} Einheiten` : `${s.total ? Math.round((s.spent / s.total) * 100) : 0}% genutzt`;
    return `<tr><td><b>${esc(b.name)}</b></td><td>${euro(s.total)}</td><td>${euro(s.spent)}</td><td class="${cls}">${diff >= 0 ? '+' : ''}${euro(diff)}</td><td>${esc(note)}</td></tr>`;
  }).join('');
  q('#reportSummary').innerHTML = `<table class="report-table"><thead><tr><th>Topf</th><th>Budget</th><th>Ausgegeben</th><th>Differenz</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  q('#monthExpenses').innerHTML = [...monthExpenses()].sort((a, b) => parseDateInput(a.date).localeCompare(parseDateInput(b.date))).map(expenseRow).join('') || '<p class="empty-note">Noch keine Ausgaben.</p>';
}
function catAbbr(name) { return String(name || 'T').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase(); }
function renderCalendar() {
  const y = shownMonth.getFullYear();
  const m = shownMonth.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div class="day empty"></div>';
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entries = monthExpenses().filter(e => parseDateInput(e.date) === date);
    html += `<button class="day ${entries.length ? 'hit' : ''}" type="button" onclick="showDay('${date}')"><b>${d}</b>${entries.slice(0, 3).map(e => `<span>${catAbbr(transactionLabel(e))} ${euro(e.amount)}</span>`).join('')}${entries.length > 3 ? `<em>+${entries.length - 3}</em>` : ''}</button>`;
  }
  q('#calendar').innerHTML = html;
}
function renderPrintReport() {
  const t = totals();
  const title = shownMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const generated = new Date().toLocaleString('de-DE');
  const bucketRows = activeBuckets().map(b => {
    const s = bucketStatus(b);
    const diff = s.total - s.spent;
    const cls = diff < 0 ? 'print-bad' : 'print-good';
    return `<tr><td>${esc(b.name)}</td><td class="num">${euro(s.total)}</td><td class="num">${euro(s.spent)}</td><td class="num ${cls}">${diff >= 0 ? '+' : ''}${euro(diff)}</td><td>${s.total ? Math.round((s.spent / s.total) * 100) : 0}%</td></tr>`;
  }).join('');
  const expenseRows = [...monthExpenses()].sort((a, b) => parseDateInput(a.date).localeCompare(parseDateInput(b.date))).map(e => `<tr><td>${formatDateInput(e.date)}</td><td>${esc(transactionLabel(e))}</td><td>${esc(e.note || '')}</td><td class="num">${euro(e.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="print-muted">Keine Ausgaben.</td></tr>';
  const cal = printCalendarHtml();
  q('#printReportTemplate').innerHTML = `<div class="print-doc">
    <header class="print-head"><div><h1>Monatsbericht Budget Master</h1><p>${esc(title)}</p></div><div><p>Erstellt: ${esc(generated)}</p><p>Dokument: Kosten- und Budgetübersicht</p></div></header>
    <section class="print-kpis">
      <div class="print-kpi"><span>Einnahmen</span><strong>${euro(t.totalIncome)}</strong></div>
      <div class="print-kpi"><span>Fix + kündbar</span><strong>${euro(t.running)}</strong></div>
      <div class="print-kpi"><span>Reserviert</span><strong>${euro(t.reserved)}</strong></div>
      <div class="print-kpi"><span>Nicht verplant</span><strong>${euro(t.unplanned)}</strong></div>
    </section>
    <section class="print-section"><h2>Budget-Töpfe</h2><table class="print-table"><thead><tr><th>Topf</th><th>Budget</th><th>Ausgegeben</th><th>Differenz</th><th>Nutzung</th></tr></thead><tbody>${bucketRows}</tbody></table></section>
    <section class="print-section"><h2>Ausgabenliste</h2><table class="print-table"><thead><tr><th>Datum</th><th>Budget-Topf</th><th>Notiz</th><th>Betrag</th></tr></thead><tbody>${expenseRows}</tbody></table></section>
    <section class="print-section"><h2>Kalender</h2>${cal}</section>
  </div>`;
}
function printCalendarHtml() {
  const y = shownMonth.getFullYear();
  const m = shownMonth.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  let html = '<div class="print-calendar">';
  for (let i = 0; i < offset; i++) html += '<div class="print-day"></div>';
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entries = monthExpenses().filter(e => parseDateInput(e.date) === date);
    html += `<div class="print-day"><b>${d}</b>${entries.slice(0, 2).map(e => `<span>${catAbbr(transactionLabel(e))} ${euro(e.amount)}</span>`).join('')}${entries.length > 2 ? `<span>+${entries.length - 2} weitere</span>` : ''}</div>`;
  }
  html += '</div>';
  return html;
}

function applyInitialView() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('view');
  if (requested && q(`#${requested}`)) {
    setView(requested);
    if (requested === 'addExpense') setTimeout(() => q('#expenseAmount')?.focus(), 250);
    return;
  }
  document.body.dataset.view = q('.view.active')?.id || 'dashboard';
}

function showDay(date) {
  const entries = monthExpenses().filter(e => parseDateInput(e.date) === date);
  openHtml(`<h3>${formatDateInput(date)}</h3><div class="list" style="margin-top:12px">${entries.map(expenseRow).join('') || '<p class="empty-note">Keine Ausgaben.</p>'}</div>`, false);
}
function setView(id) {
  document.body.dataset.view = id;
  qa('.view').forEach(v => v.classList.toggle('active', v.id === id));
  qa('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function openHtml(html, confirm = false) {
  q('#modalOk').textContent = 'OK';
  q('#modalCancel').textContent = 'Abbrechen';
  q('#modalText').innerHTML = html;
  q('#modal').classList.remove('hidden');
  q('#modalCancel').style.display = confirm ? 'inline-flex' : 'none';
  return new Promise(res => {
    q('#modalOk').onclick = () => { q('#modal').classList.add('hidden'); res(true); };
    q('#modalCancel').onclick = () => { q('#modal').classList.add('hidden'); res(false); };
  });
}
async function ask(txt) { return await openHtml(`<p>${esc(txt)}</p>`, true); }
function closeModal() {
  q('#modal').classList.add('hidden');
  q('#modalOk').textContent = 'OK';
  q('#modalCancel').textContent = 'Abbrechen';
  q('#modalCancel').style.display = 'inline-flex';
}
function fieldValue(id) { return q(id)?.value ?? ''; }
function bucketOptionHtml(selected = '') {
  return activeBuckets().map(b => `<option value="${attr(b.id)}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
}
function frequencyOptionHtml(selected = 'monthly') {
  return Object.entries(frequencyLabels).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(label[0].toUpperCase() + label.slice(1))}</option>`).join('');
}
function targetOptionHtml(selected = '') {
  const groups = [
    ['Budget-Töpfe', activeBuckets().map(x => [`budget:${x.id}`, x.name])],
    ['Fixkosten', (data.fixedCosts || []).map(x => [`fixedCosts:${x.id}`, x.name])],
    ['Kündbare Kosten', (data.cancelableCosts || []).map(x => [`cancelableCosts:${x.id}`, x.name])]
  ];
  return groups.filter(([, entries]) => entries.length).map(([label, entries]) => `<optgroup label="${esc(label)}">${entries.map(([value, name]) => `<option value="${attr(value)}" ${value === selected ? 'selected' : ''}>${esc(name)}</option>`).join('')}</optgroup>`).join('');
}
function openEditor(title, html, onSave) {
  q('#modalText').innerHTML = `<h3>${esc(title)}</h3><form id="modalForm" class="modal-form">${html}</form>`;
  q('#modal').classList.remove('hidden');
  q('#modalOk').textContent = 'Speichern';
  q('#modalCancel').textContent = 'Abbrechen';
  q('#modalCancel').style.display = 'inline-flex';
  q('#modalCancel').onclick = closeModal;
  q('#modalOk').onclick = async () => {
    const ok = await onSave();
    if (ok !== false) closeModal();
  };
  q('#modalForm').onsubmit = e => { e.preventDefault(); q('#modalOk').click(); };
  setTimeout(() => q('#modalForm input, #modalForm select')?.focus(), 50);
}
function editCost(type, id) {
  const arr = data[type] || [];
  const item = arr.find(x => x.id === id);
  if (!item) return;
  openEditor('Kosten bearbeiten', `
    <label>Name<input id="editName" value="${attr(item.name)}"></label>
    <label>Betrag<input id="editAmount" inputmode="decimal" value="${String(item.amount || '').replace('.', ',')}"></label>
    <label>Wiederholung<select id="editFrequency">${frequencyOptionHtml(item.frequency)}</select></label>
    <label>Fällig am (nur einmalig)<input id="editDueDate" type="date" value="${attr(item.dueDate || '')}"></label>
  `, () => api(`/api/cost/${type}/${id}`, { method: 'PATCH', body: JSON.stringify({ name: fieldValue('#editName'), amount: num(fieldValue('#editAmount')), frequency: fieldValue('#editFrequency'), dueDate: fieldValue('#editDueDate') }) }));
}
function editExtraIncome(id) {
  const item = (data.extraIncome || []).find(x => x.id === id);
  if (!item) return;
  openEditor('Plusgeld bearbeiten', `
    <label>Name<input id="editName" value="${attr(item.name)}"></label>
    <label>Betrag<input id="editAmount" inputmode="decimal" value="${String(item.amount || '').replace('.', ',')}"></label>
    <label>Datum<input id="editDate" inputmode="numeric" value="${formatDateInput(item.date)}"></label>
  `, () => api(`/api/extra-income/${id}`, { method: 'PATCH', body: JSON.stringify({ name: fieldValue('#editName'), amount: num(fieldValue('#editAmount')), date: fieldValue('#editDate') }) }));
}
function editExpense(id) {
  const item = (data.expenses || []).find(x => x.id === id);
  if (!item) return;
  const selectedTarget = item.kind === 'fixedCosts' || item.kind === 'cancelableCosts' ? `${item.kind}:${item.costId}` : `budget:${item.bucketId}`;
  openEditor('Ausgabe bearbeiten', `
    <label>Zuordnung<select id="editTarget">${targetOptionHtml(selectedTarget)}</select></label>
    <label>Betrag<input id="editAmount" inputmode="decimal" value="${String(item.amount || '').replace('.', ',')}"></label>
    <label>Datum<input id="editDate" inputmode="numeric" value="${formatDateInput(item.date)}"></label>
    <label>Notiz<input id="editNote" value="${attr(item.note || '')}"></label>
  `, () => {
    const [targetType, targetId] = fieldValue('#editTarget').split(':');
    return api(`/api/expense/${id}`, { method: 'PATCH', body: JSON.stringify({ targetType, targetId, amount: num(fieldValue('#editAmount')), date: fieldValue('#editDate'), note: fieldValue('#editNote') }) });
  });
}
function editBucket(id) {
  const b = (data.budgetBuckets || []).find(x => x.id === id);
  if (!b) return;
  const isFree = b.system === 'free_use' || b.id === 'bucket_frei';
  openEditor('Budget-Topf bearbeiten', `
    <label>Name<input id="editBucketName" value="${attr(b.name)}" ${isFree ? 'disabled' : ''}></label>
    <label>Art<select id="editBucketMode" ${isFree ? '' : ''}>
      <option value="money" ${b.mode === 'money' ? 'selected' : ''}>Geldbudget</option>
      <option value="unit" ${b.mode === 'unit' ? 'selected' : ''}>Einheitenbudget</option>
      <option value="saving" ${b.mode === 'saving' ? 'selected' : ''}>Spar-/Notfalltopf</option>
    </select></label>
    <label>Wiederholung<select id="editBucketFrequency">${frequencyOptionHtml(b.frequency)}</select></label>
    <label>Fällig am (nur einmalig)<input id="editBucketDueDate" type="date" value="${attr(b.dueDate || '')}"></label>
    <label>Betrag pro Zeitraum<input id="editBucketAmount" inputmode="decimal" value="${String(bucketBaseAmount(b) || '').replace('.', ',')}"></label>
    <label>Preis pro Einheit<input id="editBucketUnitAmount" inputmode="decimal" value="${String(b.unitAmount || '').replace('.', ',')}"></label>
    <label>Einheiten pro Monat<input id="editBucketUnitCount" inputmode="numeric" value="${String(b.unitCount || '')}"></label>
    <label>Abschnitte pro Monat<input id="editBucketPeriods" inputmode="numeric" value="${String(b.periods || 4)}"></label>
  `, () => {
    const mode = fieldValue('#editBucketMode');
    return api(`/api/bucket/${id}`, { method: 'PATCH', body: JSON.stringify({
      name: isFree ? b.name : fieldValue('#editBucketName'),
      mode,
      amount: num(fieldValue('#editBucketAmount')),
      unitAmount: num(fieldValue('#editBucketUnitAmount')),
      unitCount: num(fieldValue('#editBucketUnitCount')),
      frequency: fieldValue('#editBucketFrequency'),
      dueDate: fieldValue('#editBucketDueDate'),
      periods: num(fieldValue('#editBucketPeriods')) || 4,
      active: b.active !== false
    }) });
  });
}
async function delCost(type, id, name) { if (await ask(`${name} löschen?`)) api(`/api/cost/${type}/${id}`, { method: 'DELETE' }); }
async function delBucket(id, name) { if (await ask(`${name} löschen? Alte Ausgaben werden in Freie Verwendung verschoben.`)) api(`/api/bucket/${id}`, { method: 'DELETE' }); }
async function toggleBucket(id, active) { api(`/api/bucket/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); }
async function delExpense(id, name) { if (await ask(`${name} löschen?`)) api(`/api/expense/${id}`, { method: 'DELETE' }); }
async function delExtraIncome(id) { api(`/api/extra-income/${id}`, { method: 'DELETE' }); }
function csv() {
  const rows = [['Datum', 'Budget-Topf', 'Notiz', 'Betrag']];
  for (const e of monthExpenses()) rows.push([formatDateInput(e.date), transactionLabel(e), e.note || '', e.amount]);
  const text = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `budget-${monthKey(shownMonth)}.csv`;
  a.click();
}
function printReport() { renderPrintReport(); window.print(); }

function setImportStatus(message, state = '') {
  const target = q('#statementImportStatus');
  target.textContent = message;
  target.className = `import-status ${state}`.trim();
}
function updateImportTarget(index) {
  const row = q(`[data-import-index="${index}"]`);
  if (!row) return;
  const isIncome = row.querySelector('.import-direction').value === 'income';
  row.querySelector('.import-target').disabled = isIncome;
  row.classList.toggle('income-row', isIncome);
}
function renderStatementPreview() {
  const target = q('#statementPreview');
  const preview = statementPreviewData;
  if (!preview) { target.classList.add('hidden'); target.innerHTML = ''; return; }
  const rows = preview.transactions.map((tx, index) => {
    const selected = `${tx.targetType}:${tx.targetId}`;
    return `<tr data-import-index="${index}" class="${tx.duplicate ? 'duplicate-row' : ''}">
      <td><input class="import-include" type="checkbox" ${tx.duplicate ? 'disabled' : 'checked'} aria-label="Buchung importieren"></td>
      <td><input class="import-date" type="date" value="${attr(tx.date)}"></td>
      <td><input class="import-merchant" value="${attr(tx.merchant)}"><small>${esc(tx.bookingType)}</small></td>
      <td><input class="import-amount" inputmode="decimal" value="${String(tx.amount).replace('.', ',')}"></td>
      <td><select class="import-direction" onchange="updateImportTarget(${index})"><option value="expense" ${tx.direction === 'expense' ? 'selected' : ''}>Ausgabe</option><option value="income" ${tx.direction === 'income' ? 'selected' : ''}>Einnahme</option></select></td>
      <td><select class="import-target" ${tx.direction === 'income' ? 'disabled' : ''}>${targetOptionHtml(selected)}</select>${tx.duplicate ? '<small>Schon importiert</small>' : ''}</td>
    </tr>`;
  }).join('');
  target.innerHTML = `
    <div class="import-summary"><b>${preview.transactions.length} Buchungen erkannt</b><span>${preview.pages || '?'} Seiten · ${preview.summary.duplicates} bereits vorhanden</span></div>
    <div class="import-table-wrap"><table class="import-table"><thead><tr><th>✓</th><th>Datum</th><th>Händler / Beschreibung</th><th>Betrag</th><th>Art</th><th>Zuordnung</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="import-actions"><button id="cancelStatementImport" type="button">Verwerfen</button><button id="confirmStatementImport" class="primary" type="button">Ausgewählte übernehmen</button></div>`;
  target.classList.remove('hidden');
  q('#cancelStatementImport').onclick = () => { statementPreviewData = null; renderStatementPreview(); setImportStatus('Vorschau verworfen.'); };
  q('#confirmStatementImport').onclick = confirmStatementImport;
}
async function uploadStatement(event) {
  event.preventDefault();
  const file = q('#statementFile').files[0];
  if (!file) return setImportStatus('Bitte zuerst eine PDF auswählen.', 'error');
  const form = new FormData();
  form.append('statement', file);
  setImportStatus('Kontoauszug wird gelesen …', 'loading');
  q('#statementUploadForm button').disabled = true;
  try {
    const response = await fetch('/api/import/pdf/preview', { method: 'POST', body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'PDF konnte nicht gelesen werden.');
    statementPreviewData = result;
    renderStatementPreview();
    setImportStatus(`${result.transactions.length} Buchungen erkannt. Bitte Zuordnungen prüfen.`, 'success');
  } catch (error) {
    statementPreviewData = null;
    renderStatementPreview();
    setImportStatus(error.message, 'error');
  } finally {
    q('#statementUploadForm button').disabled = false;
  }
}
async function confirmStatementImport() {
  if (!statementPreviewData) return;
  const transactions = statementPreviewData.transactions.map((tx, index) => {
    const row = q(`[data-import-index="${index}"]`);
    if (!row || !row.querySelector('.import-include').checked) return null;
    const direction = row.querySelector('.import-direction').value;
    const [targetType, targetId] = (row.querySelector('.import-target').value || 'budget:').split(':');
    return {
      sourceId: tx.sourceId, bookingType: tx.bookingType, details: tx.details,
      date: row.querySelector('.import-date').value,
      merchant: row.querySelector('.import-merchant').value,
      amount: num(row.querySelector('.import-amount').value), direction, targetType, targetId
    };
  }).filter(Boolean);
  if (!transactions.length) return setImportStatus('Es ist keine neue Buchung ausgewählt.', 'error');
  q('#confirmStatementImport').disabled = true;
  setImportStatus('Buchungen werden übernommen …', 'loading');
  try {
    const response = await fetch('/api/import/pdf/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statementId: statementPreviewData.statementId, filename: statementPreviewData.filename, transactions }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Import fehlgeschlagen.');
    data = result.data;
    statementPreviewData = null;
    render();
    renderStatementPreview();
    q('#statementFile').value = '';
    setImportStatus(`${result.imported} Buchungen importiert${result.skipped ? `, ${result.skipped} übersprungen` : ''}.`, 'success');
  } catch (error) {
    setImportStatus(error.message, 'error');
    q('#confirmStatementImport').disabled = false;
  }
}

function wire() {
  qa('.nav button').forEach(b => b.onclick = () => setView(b.dataset.view));
  q('#goAdd').onclick = () => setView('addExpense');
  q('#goMonthFromRecent').onclick = () => setView('month');
  q('#toggleBalance').onclick = () => { balanceVisible = !balanceVisible; render(); };
  q('#bucketMode').onchange = () => {
    const u = q('#bucketMode').value === 'unit';
    q('#bucketUnitAmount').classList.toggle('hidden', !u);
    q('#bucketUnitCount').classList.toggle('hidden', !u);
    q('#bucketAmount').classList.toggle('hidden', u);
  };
  q('#bucketFrequency').onchange = e => q('#bucketDueDate').classList.toggle('hidden', e.target.value !== 'one_time');
  q('#fixedFrequency').onchange = e => q('#fixedDueDate').classList.toggle('hidden', e.target.value !== 'one_time');
  q('#cancelFrequency').onchange = e => q('#cancelDueDate').classList.toggle('hidden', e.target.value !== 'one_time');
  q('#prevMonth').onclick = () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1); render(); };
  q('#nextMonth').onclick = () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1); render(); };
  q('#exportCsv').onclick = csv;
  q('#printReport').onclick = printReport;
  q('#statementUploadForm').onsubmit = uploadStatement;
  q('#hideFreeBalance').onchange = e => api('/api/settings', { method: 'POST', body: JSON.stringify({ hideFreeBalance: e.target.checked }) });
  q('#roundExpensesUp').onchange = e => api('/api/settings', { method: 'POST', body: JSON.stringify({ roundExpensesUp: e.target.checked }) });
  q('#incomeForm').onsubmit = e => { e.preventDefault(); api('/api/income', { method: 'POST', body: JSON.stringify({ income: num(q('#incomeInput').value) }) }); };
  q('#expenseForm').onsubmit = e => {
    e.preventDefault();
    api('/api/expense', { method: 'POST', body: JSON.stringify({ bucketId: q('#expenseBucket').value || freeBucketId(), amount: num(q('#expenseAmount').value), date: q('#expenseDate').value, note: q('#expenseNote').value }) });
    q('#expenseAmount').value = '';
    q('#expenseNote').value = '';
    setTimeout(() => q('#expenseAmount')?.focus(), 200);
  };
  q('#bucketForm').onsubmit = e => {
    e.preventDefault();
    api('/api/bucket', { method: 'POST', body: JSON.stringify({ name: q('#bucketName').value, mode: q('#bucketMode').value, frequency: q('#bucketFrequency').value, dueDate: q('#bucketDueDate').value, amount: num(q('#bucketAmount').value), unitAmount: num(q('#bucketUnitAmount').value), unitCount: num(q('#bucketUnitCount').value), periods: num(q('#bucketPeriods').value) || 4 }) });
    ['#bucketName', '#bucketAmount', '#bucketUnitAmount', '#bucketUnitCount', '#bucketPeriods', '#bucketDueDate'].forEach(s => q(s).value = '');
  };
  q('#fixedForm').onsubmit = e => { e.preventDefault(); api('/api/cost', { method: 'POST', body: JSON.stringify({ type: 'fixedCosts', name: q('#fixedName').value, amount: num(q('#fixedAmount').value), frequency: q('#fixedFrequency').value, dueDate: q('#fixedDueDate').value }) }); q('#fixedName').value = q('#fixedAmount').value = q('#fixedDueDate').value = ''; };
  q('#cancelForm').onsubmit = e => { e.preventDefault(); api('/api/cost', { method: 'POST', body: JSON.stringify({ type: 'cancelableCosts', name: q('#cancelName').value, amount: num(q('#cancelAmount').value), frequency: q('#cancelFrequency').value, dueDate: q('#cancelDueDate').value }) }); q('#cancelName').value = q('#cancelAmount').value = q('#cancelDueDate').value = ''; };
  q('#extraIncomeForm').onsubmit = e => { e.preventDefault(); api('/api/extra-income', { method: 'POST', body: JSON.stringify({ name: q('#extraName').value, amount: num(q('#extraAmount').value), date: q('#extraDate').value }) }); q('#extraName').value = q('#extraAmount').value = ''; };
}
wire();
load();
