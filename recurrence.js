const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'one_time'];

function normalizeFrequency(value, fallback = 'monthly') {
  return FREQUENCIES.includes(value) ? value : fallback;
}

function monthKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthlyEquivalent(amount, frequency = 'monthly', dueDate = '', forMonth = new Date()) {
  const value = Number(amount) || 0;
  switch (normalizeFrequency(frequency)) {
    case 'weekly': return value * 52 / 12;
    case 'biweekly': return value * 26 / 12;
    case 'quarterly': return value / 3;
    case 'yearly': return value / 12;
    case 'one_time': return String(dueDate || '').slice(0, 7) === monthKey(forMonth) ? value : 0;
    default: return value;
  }
}

module.exports = { FREQUENCIES, normalizeFrequency, monthKey, monthlyEquivalent };
