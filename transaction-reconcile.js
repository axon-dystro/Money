function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function amountCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0;
}

function parseIsoDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(a, b) {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (da === null || db === null) return Infinity;
  return Math.abs(Math.round((da - db) / 86400000));
}

const GENERIC_TOKENS = new Set([
  'kartenzahlung', 'kartenwecker', 'umsatzwecker', 'sparkasse', 'giro', 'guthaben',
  'plus', 'debit', 'debitk', 'zahlung', 'einkauf', 'buchung', 'belastung',
  'lastschrift', 'online', 'ec', 'eur', 'euro', 'datum', 'konto', 'ltd',
  'gmbh', 'sepa', 'mandat', 'rechnung', 'nr', 'nummer', 'luedenscheid',
  'ludenscheid', 'deutschland'
]);

function tokenSet(value = '') {
  const words = normalizeText(value).match(/[a-z0-9]{3,}/g) || [];
  return new Set(words.filter(word => !GENERIC_TOKENS.has(word) && !/^\d+$/.test(word)));
}

function merchantScore(a = '', b = '') {
  const ac = compactText(a);
  const bc = compactText(b);
  if (!ac || !bc) return 0;
  if (ac === bc) return 1;
  if ((ac.length >= 5 && bc.includes(ac)) || (bc.length >= 5 && ac.includes(bc))) return 0.92;

  const at = tokenSet(a);
  const bt = tokenSet(b);
  if (!at.size || !bt.size) return 0;
  let shared = 0;
  for (const token of at) if (bt.has(token)) shared++;
  if (shared && shared === Math.min(at.size, bt.size)) return 0.78;
  return shared / Math.max(at.size, bt.size);
}

function extractReferenceTokens(value = '') {
  const raw = String(value || '').match(/\b[A-Z0-9][A-Z0-9\-]{7,42}\b/gi) || [];
  return Array.from(new Set(raw.map(token => token.replace(/[^A-Z0-9]/gi, '').toUpperCase()).filter(token => {
    if (token.length < 8 || token.length > 42) return false;
    if (/^DE\d{20}$/.test(token)) return false;
    if (/^\d{8}$/.test(token)) return false;
    if (/^\d{4}-?\d{2}-?\d{2}/.test(token)) return false;
    return /[A-Z]/.test(token) && /\d/.test(token);
  })));
}

function sourceIds(item = {}) {
  return Array.from(new Set([
    item.sourceId,
    ...(Array.isArray(item.sourceIds) ? item.sourceIds : [])
  ].filter(Boolean).map(String)));
}

function sourceRefs(item = {}) {
  return Array.from(new Set([
    ...(Array.isArray(item.sourceRefs) ? item.sourceRefs : []),
    ...extractReferenceTokens(`${item.note || ''} ${item.merchant || ''} ${item.details || ''}`)
  ].filter(Boolean).map(ref => String(ref).toUpperCase())));
}

function hasKnownSource(collection, sourceId) {
  if (!sourceId) return null;
  return collection.find(item => sourceIds(item).includes(sourceId)) || null;
}

function isCardSource(source = '') {
  return /kartenwecker|card|karte/i.test(String(source || ''));
}

function isCardExpense(expense = {}) {
  return isCardSource(expense.source) || expense.sourceStatus === 'pending';
}

function importText(item = {}) {
  return `${item.merchant || ''} ${item.note || ''} ${item.category || ''} ${item.bookingType || ''} ${item.details || ''}`;
}

function candidateForExpense(expense, incoming, usedExistingIds = new Set()) {
  if (!expense || usedExistingIds.has(expense.id)) return null;
  if (amountCents(expense.amount) !== amountCents(incoming.amount)) return null;

  const dateGap = daysBetween(expense.date, incoming.date);
  const maxDays = isCardExpense(expense) && !isCardSource(incoming.source) ? 8 : 3;
  if (dateGap > maxDays) return null;

  const refOverlap = sourceRefs(expense).some(ref => sourceRefs(incoming).includes(ref));
  const score = refOverlap ? 1 : merchantScore(importText(expense), importText(incoming));
  if (score < 0.55) return null;

  return { expense, score, dateGap, refOverlap };
}

function findExpenseImportMatch(expenses = [], incoming = {}, options = {}) {
  const usedExistingIds = options.usedExistingIds || new Set();
  const existingBySource = hasKnownSource(expenses, incoming.sourceId);
  if (existingBySource) return { action: 'duplicate', reason: 'source-id', existing: existingBySource };

  const refMatches = sourceRefs(incoming).length
    ? expenses
      .filter(expense => !usedExistingIds.has(expense.id))
      .filter(expense => amountCents(expense.amount) === amountCents(incoming.amount))
      .filter(expense => sourceRefs(expense).some(ref => sourceRefs(incoming).includes(ref)))
    : [];
  if (refMatches.length === 1) return { action: isCardSource(incoming.source) ? 'duplicate' : 'reconcile', reason: 'reference', existing: refMatches[0] };
  if (refMatches.length > 1) return { action: 'ambiguous', reason: 'reference', candidates: refMatches };

  const candidates = expenses
    .map(expense => candidateForExpense(expense, incoming, usedExistingIds))
    .filter(Boolean)
    .sort((a, b) => (b.refOverlap - a.refOverlap) || (b.score - a.score) || (a.dateGap - b.dateGap));

  if (isCardSource(incoming.source)) {
    const cardCandidates = candidates.filter(candidate => isCardExpense(candidate.expense));
    if (cardCandidates.length === 1) return { action: 'duplicate', reason: 'pending-card-duplicate', existing: cardCandidates[0].expense, match: cardCandidates[0] };
    if (cardCandidates.length > 1) return { action: 'ambiguous', reason: 'pending-card-duplicate', candidates: cardCandidates.map(x => x.expense) };

    const manualCandidates = candidates.filter(candidate => !candidate.expense.source && candidate.score >= 0.72 && candidate.dateGap <= 1);
    if (manualCandidates.length === 1) return { action: 'reconcile', reason: 'manual-entry', existing: manualCandidates[0].expense, match: manualCandidates[0] };
    if (manualCandidates.length > 1) return { action: 'ambiguous', reason: 'manual-entry', candidates: manualCandidates.map(x => x.expense) };
    return { action: 'none' };
  }

  const cardCandidates = candidates.filter(candidate => isCardExpense(candidate.expense));
  if (cardCandidates.length === 1) return { action: 'reconcile', reason: 'pending-card', existing: cardCandidates[0].expense, match: cardCandidates[0] };
  if (cardCandidates.length > 1) return { action: 'ambiguous', reason: 'pending-card', candidates: cardCandidates.map(x => x.expense) };

  const manualCandidates = candidates.filter(candidate => !candidate.expense.source && candidate.score >= 0.85 && candidate.dateGap === 0);
  if (manualCandidates.length === 1) return { action: 'reconcile', reason: 'manual-entry', existing: manualCandidates[0].expense, match: manualCandidates[0] };
  if (manualCandidates.length > 1) return { action: 'ambiguous', reason: 'manual-entry', candidates: manualCandidates.map(x => x.expense) };

  return { action: 'none' };
}

function appendImportSource(expense, incoming = {}) {
  const ids = sourceIds(expense);
  if (incoming.sourceId && !ids.includes(incoming.sourceId)) ids.push(incoming.sourceId);
  expense.sourceIds = ids.slice(-12);
  if (!expense.sourceId && incoming.sourceId) expense.sourceId = incoming.sourceId;

  const refs = sourceRefs(expense);
  for (const ref of sourceRefs(incoming)) if (!refs.includes(ref)) refs.push(ref);
  expense.sourceRefs = refs.slice(-20);

  if (isCardSource(incoming.source)) {
    if (!expense.source) expense.source = incoming.source;
    if (!expense.sourceStatus) expense.sourceStatus = 'pending';
  } else {
    expense.sourceStatus = 'cleared';
    expense.clearedAt = new Date().toISOString();
    expense.clearingSource = incoming.source || expense.clearingSource || '';
    expense.bookedDate = incoming.date || expense.bookedDate || '';
  }
  return expense;
}

module.exports = {
  amountCents,
  appendImportSource,
  compactText,
  daysBetween,
  extractReferenceTokens,
  findExpenseImportMatch,
  hasKnownSource,
  isCardSource,
  merchantScore,
  normalizeText,
  sourceIds,
  sourceRefs
};
