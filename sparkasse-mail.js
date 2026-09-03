const { extractReferenceTokens } = require('./transaction-reconcile');

function normalizeText(v = '') {
  return String(v).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseGermanAmount(value) {
  if (!value) return null;
  const cleaned = String(value)
    .replace(/\s/g, '')
    .replace(/EUR|€/gi, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function parseSignedGermanAmount(value) {
  if (!value) return null;
  const sign = /^\s*-/.test(String(value)) ? -1 : 1;
  const amount = parseGermanAmount(value);
  return amount === null ? null : sign * amount;
}

function parseTransactionDate(value) {
  const text = normalizeText(value);
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{1,2}:\d{2})?\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

const GERMAN_AMOUNT_RE = /([+-]?\d{1,3}(?:\.\d{3})*(?:,\d{2})|[+-]?\d+(?:,\d{2}))/;

function normalizeMerchant(value) {
  return normalizeText(value)
    .replace(/^[.:;\-\s]+/, '')
    .replace(/[.:;\-\s]+$/, '')
    .trim();
}

function transactionCandidateLines(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(line =>
      line &&
      GERMAN_AMOUNT_RE.test(line) &&
      /(?:EUR|€)/i.test(line) &&
      !/neuer\s+saldo|saldo\s*:/i.test(line) &&
      !/betrag\s+ab/i.test(line)
    );
}

function extractTransactionAmountAndMerchant(subject, text, combined) {
  const candidates = [
    ...transactionCandidateLines(text),
    ...transactionCandidateLines(combined)
  ];
  const preferred = candidates.find(line => /[:：]\s*[+-]?\d/.test(line)) || candidates[0] || '';
  if (preferred) {
    const amountSource = GERMAN_AMOUNT_RE.source;
    const colonMatch = preferred.match(new RegExp(`^(.*?)\\s*[:：]\\s*${amountSource}\\s*(?:EUR|€)`, 'i'));
    const looseMatch = preferred.match(new RegExp(`^(.*?)\\s+${amountSource}\\s*(?:EUR|€)`, 'i'));
    const match = colonMatch || looseMatch;
    if (match?.[2]) {
      return {
        rawAmount: match[2],
        amount: parseGermanAmount(match[2]),
        merchant: normalizeMerchant(match[1]),
        signed: /^\s*-/.test(match[2]) ? -1 : 1
      };
    }
  }

  const amountMatches = [...combined.matchAll(/([+-]?\d{1,3}(?:\.\d{3})*(?:,\d{2})|[+-]?\d+(?:,\d{2}))\s*(?:EUR|€)/gi)]
    .filter(match => !/neuer\s+saldo|saldo\s*:/i.test(combined.slice(Math.max(0, match.index - 40), match.index + 20)));
  const rawAmount = amountMatches.length ? amountMatches[0][1] : '';
  return {
    rawAmount,
    amount: parseGermanAmount(rawAmount),
    merchant: '',
    signed: /^\s*-/.test(rawAmount) ? -1 : 1
  };
}

function extractBalance(value) {
  const text = normalizeText(value);
  const match = text.match(/neuer\s+saldo\s*:\s*([+-]?\d{1,3}(?:\.\d{3})*(?:,\d{2})|[+-]?\d+(?:,\d{2}))\s*(?:EUR|€)/i);
  return match ? parseSignedGermanAmount(match[1]) : null;
}

function parseUmsatzweckerMail(mail) {
  const subject = normalizeText(mail.subject || '');
  const rawBody = String(mail.text || mail.html || '');
  const text = normalizeText(rawBody);
  const combined = `${subject} ${text}`;

  if (!/sparkasse|umsatzwecker|kontowecker|kartenwecker/i.test(combined)) return null;

  const parsedTransaction = extractTransactionAmountAndMerchant(subject, rawBody, combined);
  const rawAmount = parsedTransaction.rawAmount;
  const amount = parsedTransaction.amount;
  if (!amount || amount <= 0) return null;

  const incoming = /geldeingang|gutschrift|eingegangen|gutgeschrieben/i.test(combined);
  const outgoing = /geldausgang|abbuchung|belastung|abgebucht|kartenzahlung|zahlung|bezahlt|bezahlen|einkauf|karteneinsatz|kartenwecker/i.test(combined) && !incoming;
  const weckerType = /kartenwecker|sparkassen-card|sparkassen card|karteneinsatz|mit ihrer .*karte|mit ihrer .*card/i.test(combined)
    ? 'card'
    : 'turnover';

  const labelPatterns = [
    /(?:bezahlt bei|bezahlen bei|einkauf bei|kartenzahlung bei|karteneinsatz bei)\s*([^|]{2,100}?)(?=\s+[+-]?\d+[.,]\d{2}\s*(?:EUR|€)|betrag|datum|iban|$)/i,
    /(?:zahlungsempf[aä]nger|empf[aä]nger|h[aä]ndler|zahlung bei|umsatz bei|verwendungszweck)\s*[:\-]\s*([^|]{2,100}?)(?=\s{2,}|betrag|datum|iban|$)/i,
    /(?:bei|an)\s+([A-ZÄÖÜ0-9][A-Za-zÄÖÜäöüß0-9 .,&'\-/]{2,80}?)(?=\s+[+-]?\d+[.,]\d{2}\s*(?:EUR|€)|$)/i
  ];
  let merchant = parsedTransaction.merchant || '';
  for (const re of labelPatterns) {
    if (merchant) break;
    const m = combined.match(re);
    if (m?.[1]) { merchant = normalizeText(m[1]); break; }
  }
  if (!merchant) merchant = subject.replace(/umsatzwecker|kontowecker|sparkasse/gi, '').replace(/[:\-]+/g, ' ').trim() || 'Sparkassen-Umsatz';

  return {
    type: incoming || parsedTransaction.signed > 0 && !outgoing ? 'income' : outgoing || parsedTransaction.signed < 0 ? 'expense' : 'unknown',
    weckerType,
    amount,
    merchant: merchant.slice(0, 120),
    subject,
    rawText: text.slice(0, 4000),
    transactionDate: parseTransactionDate(combined),
    balance: extractBalance(combined),
    sourceRefs: extractReferenceTokens(combined)
  };
}

function createSparkasseMailPoller({ onTransaction, onDebug }) {
  const enabled = String(process.env.SPARKASSE_MAIL_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { start() {}, stop: async () => {} };

  let ImapFlow;
  let simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch (err) {
    console.error('[Sparkasse-Mail] Aktiviert, aber IMAP-Abhängigkeiten fehlen. Bitte npm ci ausführen.');
    return { start() {}, stop: async () => {} };
  }

  const host = process.env.SPARKASSE_IMAP_HOST;
  const port = Number(process.env.SPARKASSE_IMAP_PORT || 993);
  const secure = String(process.env.SPARKASSE_IMAP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SPARKASSE_IMAP_USER;
  const pass = process.env.SPARKASSE_IMAP_PASS;
  const mailbox = process.env.SPARKASSE_IMAP_MAILBOX || 'INBOX';
  const intervalMs = Math.max(60_000, Number(process.env.SPARKASSE_POLL_INTERVAL_MS || 180_000));

  if (!host || !user || !pass) {
    console.error('[Sparkasse-Mail] Aktiviert, aber IMAP-Zugangsdaten fehlen.');
    return { start() {}, stop: async () => {} };
  }

  let timer = null;
  let running = false;
  let client = null;

  async function poll() {
    if (running) return;
    running = true;
    try {
      client = new ImapFlow({ host, port, secure, auth: { user, pass }, logger: false });
      await client.connect();
      const lock = await client.getMailboxLock(mailbox);
      try {
        const uids = await client.search({ seen: false });
        for (const uid of uids) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true, uid: true });
          if (!msg?.source) continue;
          const parsed = await simpleParser(msg.source);
          const tx = parseUmsatzweckerMail(parsed);
          const messageId = parsed.messageId || `${mailbox}:${uid}`;
          if (tx) {
            await onTransaction({ ...tx, messageId, receivedAt: new Date().toISOString() });
          } else if (onDebug) {
            await onDebug({ messageId, subject: parsed.subject || '', reason: 'not-parsed' });
          }
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
      await client.logout();
      client = null;
    } catch (err) {
      console.error('[Sparkasse-Mail] Abruf fehlgeschlagen:', err.message);
      try { if (client) await client.logout(); } catch (_) {}
      client = null;
    } finally {
      running = false;
    }
  }

  return {
    start() {
      poll();
      timer = setInterval(poll, intervalMs);
      timer.unref?.();
      console.log(`[Sparkasse-Mail] IMAP-Abruf aktiv (${host}, alle ${Math.round(intervalMs / 1000)}s)`);
    },
    async stop() {
      if (timer) clearInterval(timer);
      try { if (client) await client.logout(); } catch (_) {}
    }
  };
}

module.exports = { createSparkasseMailPoller, parseUmsatzweckerMail };
