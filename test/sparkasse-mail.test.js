const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUmsatzweckerMail, parseUmsatzweckerTransactions } = require('../sparkasse-mail');

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
  assert.equal(tx.balance, 1593.95);
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

test('parses every transaction line from one Sparkasse Umsatzwecker mail', () => {
  const transactions = parseUmsatzweckerTransactions({
    subject: 'Ihr Umsatzwecker: 6 neue Umsätze',
    text: `Guten Tag,

auf dem Konto *8600 wurden folgende Umsätze verbucht:

stadtwerk.: -60,00 EUR
SCHUFA Ho.: -10,00 EUR
iphone: -50,00 EUR
Telefonic.: -70,00 EUR
PERPARIM .: -635,00 EUR
Michael T.: -50,00 EUR

Neuer Saldo: 659,39 EUR

Mit freundlichen Grüßen
Ihre Sparkasse`
  });

  assert.equal(transactions.length, 6);
  assert.deepEqual(transactions.map(tx => tx.merchant), ['stadtwerk', 'SCHUFA Ho', 'iphone', 'Telefonic', 'PERPARIM', 'Michael T']);
  assert.deepEqual(transactions.map(tx => tx.amount), [60, 10, 50, 70, 635, 50]);
  assert.equal(transactions[0].balance, 659.39);
  assert.equal(transactions[5].transactionIndex, 5);
});
