const crypto = require('crypto');
const { extractReferenceTokens } = require('./transaction-reconcile');

function parseGermanAmount(value) {
  const cleaned = String(value || '')
    .replace(/\s/g, '')
    .replace(/EUR|€/gi, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanDetailLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean)
    .filter(line => !/^(?:S\s+)?Sparkasse(?: an Volme und Ruhr)?$/i.test(line))
    .filter(line => !/^Kontoauszug\s+\d+\/\d+/i.test(line))
    .filter(line => !/^Konto-Nr\./i.test(line))
    .filter(line => !/^Datum\s+Erläuterung/i.test(line))
    .filter(line => !/^(?:Vorstand|Telefon|Sparkassen-Karree|Anstalt des öffentlichen Rechts|HR Nr\.|Sparkassen-Finanzgruppe)/i.test(line));
}

function extractMerchant(bookingType, details) {
  const text = normalizeText(details.join(' '));
  const paypalPurchase = text.match(/Ihr Einkauf bei\s+(.+?)(?=\s+\d{10,}|\s+Gläubiger-ID|\s+[A-Z0-9]{10,}\b|$)/i);
  if (paypalPurchase?.[1] && normalizeText(paypalPurchase[1]).length > 1) return normalizeText(paypalPurchase[1]).slice(0, 120);

  if (/Entgeltabrechnung/i.test(bookingType)) return 'Kontoführung';
  if (/entgeltfreie Buchung/i.test(bookingType) && /RÜCKGABE LASTSCHRIFT/i.test(text)) return 'Rücklastschriftgebühr';

  const first = details[0] || bookingType || 'Unbekannte Buchung';
  const beforePath = first.split(/\/\//)[0].split('/')[0];
  const beforeMarkers = beforePath.split(/\s+(?:BIC\s*\/\s*IBAN|DATUM\s+\d|Debitk\.|Gläubiger-ID|Wert:)\b/i)[0];
  return normalizeText(beforeMarkers).slice(0, 120) || normalizeText(bookingType).slice(0, 120);
}

function parseSparkasseStatementText(text) {
  const input = String(text || '').replace(/\f/g, '\n');
  const startPattern = /^[ \t]*(\d{2}\.\d{2}\.\d{4})[ \t]+(.+?)[ \t]+([+-]?\d{1,3}(?:\.\d{3})*,\d{2}|[+-]?\d+,\d{2})[ \t]*$/gm;
  const matches = [...input.matchAll(startPattern)];
  const occurrences = new Map();

  return matches.map((match, index) => {
    const signedAmount = parseGermanAmount(match[3]);
    if (signedAmount === null || signedAmount === 0) return null;
    const segmentEnd = matches[index + 1]?.index ?? input.length;
    const details = cleanDetailLines(input.slice(match.index + match[0].length, segmentEnd));
    const bookingType = normalizeText(match[2]);
    const merchant = extractMerchant(bookingType, details);
    const dateParts = match[1].split('.');
    const date = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    const direction = signedAmount < 0 ? 'expense' : 'income';
    const amount = Math.abs(signedAmount);
    const rawKey = normalizeText(`${date}|${bookingType}|${signedAmount}|${merchant}|${details.join(' ')}`).toLowerCase();
    const occurrence = (occurrences.get(rawKey) || 0) + 1;
    occurrences.set(rawKey, occurrence);
    const sourceId = `pdf:${crypto.createHash('sha256').update(`${rawKey}|${occurrence}`).digest('hex')}`;
    return {
      sourceId,
      date,
      direction,
      amount,
      merchant,
      bookingType,
      details: normalizeText(details.join(' ')).slice(0, 500),
      sourceRefs: extractReferenceTokens(`${bookingType} ${merchant} ${details.join(' ')}`)
    };
  }).filter(Boolean);
}

async function renderPageWithRows(pageData) {
  const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  const rows = [];
  for (const item of content.items) {
    const y = Number(item.transform?.[5]) || 0;
    let row = rows.find(candidate => Math.abs(candidate.y - y) < 1.5);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x: Number(item.transform?.[4]) || 0, width: Number(item.width) || 0, text: item.str || '' });
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let endX = null;
    for (const item of row.items) {
      if (line && endX !== null && item.x - endX > 1) line += ' ';
      line += item.text;
      endX = item.x + item.width;
    }
    return line.trimEnd();
  }).join('\n');
}

async function parseSparkasseStatementPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('Die Datei ist keine gültige PDF.');
  }
  const pdfParse = require('pdf-parse');
  const parsed = await pdfParse(buffer, { pagerender: renderPageWithRows });
  const transactions = parseSparkasseStatementText(parsed.text);
  if (!transactions.length) throw new Error('In dieser PDF wurden keine Sparkassen-Buchungen erkannt.');
  return {
    transactions,
    pages: parsed.numpages || null,
    statementId: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

module.exports = { parseGermanAmount, parseSparkasseStatementText, parseSparkasseStatementPdf, renderPageWithRows };
