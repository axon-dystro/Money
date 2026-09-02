const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

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

function parseUmsatzweckerMail(mail) {
  const subject = normalizeText(mail.subject || '');
  const text = normalizeText(mail.text || mail.html || '');
  const combined = `${subject} ${text}`;

  if (!/sparkasse|umsatzwecker|kontowecker/i.test(combined)) return null;

  const amountMatches = [...combined.matchAll(/([+-]?\d{1,3}(?:\.\d{3})*(?:,\d{2})|[+-]?\d+(?:,\d{2}))\s*(?:EUR|€)/gi)];
  const rawAmount = amountMatches.length ? amountMatches[amountMatches.length - 1][1] : '';
  const amount = parseGermanAmount(rawAmount);
  if (!amount || amount <= 0) return null;

  const incoming = /geldeingang|gutschrift|eingegangen|gutgeschrieben/i.test(combined);
  const outgoing = /geldausgang|abbuchung|belastung|abgebucht|kartenzahlung|zahlung/i.test(combined) && !incoming;

  const labelPatterns = [
    /(?:zahlungsempf[aä]nger|empf[aä]nger|h[aä]ndler|zahlung bei|umsatz bei|verwendungszweck)\s*[:\-]\s*([^|]{2,100}?)(?=\s{2,}|betrag|datum|iban|$)/i,
    /(?:bei|an)\s+([A-ZÄÖÜ0-9][A-Za-zÄÖÜäöüß0-9 .,&'\-/]{2,80}?)(?=\s+[+-]?\d+[.,]\d{2}\s*(?:EUR|€)|$)/i
  ];
  let merchant = '';
  for (const re of labelPatterns) {
    const m = combined.match(re);
    if (m?.[1]) { merchant = normalizeText(m[1]); break; }
  }
  if (!merchant) merchant = subject.replace(/umsatzwecker|kontowecker|sparkasse/gi, '').replace(/[:\-]+/g, ' ').trim() || 'Sparkassen-Umsatz';

  return {
    type: incoming ? 'income' : outgoing || /^\s*-/.test(rawAmount) ? 'expense' : 'unknown',
    amount,
    merchant: merchant.slice(0, 120),
    subject,
    rawText: text.slice(0, 4000)
  };
}

function createSparkasseMailPoller({ onTransaction, onDebug }) {
  const enabled = String(process.env.SPARKASSE_MAIL_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { start() {}, stop: async () => {} };

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
