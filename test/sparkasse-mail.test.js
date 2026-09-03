const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUmsatzweckerMail } = require('../sparkasse-mail');

test('parses Sparkasse Umsatzwecker expense without using the new balance', () => {
  const tx = parseUmsatzweckerMail({
    subject: 'Ihr Umsatzwecker: 1 neuer Umsatz',
    text: `Guten Tag,

auf dem Konto *8600 wurden folgende Umsätze
verbucht:

HIT SAGT .: -2,97 EUR

Neuer Saldo: 1.593,95 EUR

Mit freundlichen Grüßen
Ihre Sparkasse`
  });

  assert.equal(tx.type, 'expense');
  assert.equal(tx.weckerType, 'turnover');
  assert.equal(tx.amount, 2.97);
  assert.equal(tx.merchant, 'HIT SAGT');
});

test('parses another Sparkasse Umsatzwecker line with abbreviated merchant', () => {
  const tx = parseUmsatzweckerMail({
    subject: 'Ihr Umsatzwecker: 1 neuer Umsatz',
    text: `Guten Tag,

auf dem Konto *8600 wurden folgende Umsätze
verbucht:

Mobile To.: -17,48 EUR

Neuer Saldo: 1.576,47 EUR

Mit freundlichen Grüßen
Ihre Sparkasse`
  });

  assert.equal(tx.type, 'expense');
  assert.equal(tx.amount, 17.48);
  assert.equal(tx.merchant, 'Mobile To');
});
