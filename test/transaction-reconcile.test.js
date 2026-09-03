const test = require('node:test');
const assert = require('node:assert/strict');
const { appendImportSource, findExpenseImportMatch } = require('../transaction-reconcile');

test('reconciles a booked transaction with one pending card expense', () => {
  const expenses = [{
    id: 'card-1',
    amount: 2.97,
    date: '2026-09-02',
    merchant: 'HIT Handelsgruppe Luedenscheid',
    note: 'HIT Handelsgruppe',
    source: 'sparkasse-kartenwecker',
    sourceId: 'mail-card-1',
    sourceStatus: 'pending'
  }];
  const incoming = {
    amount: 2.97,
    date: '2026-09-04',
    merchant: 'HIT 4067 Luedenscheid',
    source: 'sparkasse-umsatzwecker',
    sourceId: 'mail-turnover-1'
  };

  const match = findExpenseImportMatch(expenses, incoming);
  assert.equal(match.action, 'reconcile');
  assert.equal(match.existing.id, 'card-1');

  appendImportSource(match.existing, incoming);
  assert.equal(expenses[0].sourceStatus, 'cleared');
  assert.equal(expenses[0].bookedDate, '2026-09-04');
  assert.deepEqual(expenses[0].sourceIds, ['mail-card-1', 'mail-turnover-1']);
});

test('does not collapse two equal pending card expenses into one booked expense', () => {
  const expenses = [
    { id: 'card-1', amount: 3, date: '2026-09-02', merchant: 'HIT', note: 'HIT', source: 'sparkasse-kartenwecker', sourceId: 'mail-card-1', sourceStatus: 'pending' },
    { id: 'card-2', amount: 3, date: '2026-09-02', merchant: 'HIT', note: 'HIT', source: 'sparkasse-kartenwecker', sourceId: 'mail-card-2', sourceStatus: 'pending' }
  ];
  const incoming = { amount: 3, date: '2026-09-04', merchant: 'HIT 4067', source: 'sparkasse-pdf', sourceId: 'pdf-1' };

  const match = findExpenseImportMatch(expenses, incoming);
  assert.equal(match.action, 'ambiguous');
});

test('reconciles a card mail with one matching manual entry', () => {
  const expenses = [{ id: 'manual-1', amount: 12.99, date: '2026-09-02', note: 'Crunchyroll', source: '', sourceId: '' }];
  const incoming = { amount: 12.99, date: '2026-09-02', merchant: 'Crunchyroll', source: 'sparkasse-kartenwecker', sourceId: 'mail-card-3' };

  const match = findExpenseImportMatch(expenses, incoming);
  assert.equal(match.action, 'reconcile');
  assert.equal(match.reason, 'manual-entry');
});

test('does not reconcile a new booked transaction with a cleared similar expense', () => {
  const expenses = [{
    id: 'cleared-1',
    amount: 3,
    date: '2026-09-02',
    merchant: 'HIT 4067',
    note: 'HIT 4067',
    source: 'sparkasse-pdf',
    sourceId: 'pdf-old',
    sourceStatus: 'cleared'
  }];
  const incoming = { amount: 3, date: '2026-09-03', merchant: 'HIT 4067', source: 'sparkasse-pdf', sourceId: 'pdf-new' };

  const match = findExpenseImportMatch(expenses, incoming);
  assert.equal(match.action, 'none');
});
