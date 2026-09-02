const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSparkasseStatementText } = require('../statement-parser');
const { monthlyEquivalent } = require('../recurrence');

test('parses Sparkasse debits and credits without balances', () => {
  const text = `
  Datum Erläuterung Betrag EUR
  03.08.2026 Kartenzahlung -13,34
          HIT 4067 Luedenscheid//Luedenscheid /DE 2026-07-31T14:44 Debitk.10
  03.08.2026 Lohn, Gehalt, Rente 152,97
          Carl Berghöfer GmbH Lohn - Gehalt Abrechnung 07/2026
          Kontostand am 31.08.2026 um 20:04 Uhr 6,74
  `;
  const rows = parseSparkasseStatementText(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(x => [x.direction, x.amount]), [['expense', 13.34], ['income', 152.97]]);
  assert.match(rows[0].merchant, /^HIT 4067/);
  assert.equal(rows[0].sourceId, parseSparkasseStatementText(text)[0].sourceId);
});

test('converts recurring amounts to a monthly planning share', () => {
  assert.equal(monthlyEquivalent(120, 'yearly', '', new Date('2026-08-01')), 10);
  assert.equal(monthlyEquivalent(90, 'quarterly', '', new Date('2026-08-01')), 30);
  assert.equal(monthlyEquivalent(50, 'one_time', '2026-08-15', new Date('2026-08-01')), 50);
  assert.equal(monthlyEquivalent(50, 'one_time', '2026-08-15', new Date('2026-09-01')), 0);
});
