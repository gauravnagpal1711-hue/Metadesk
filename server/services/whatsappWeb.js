/**
 * WhatsApp Web pairing via Baileys — scan a QR code with your personal WhatsApp,
 * exactly like web.whatsapp.com. Session files live in WA_SESSION_DIR.
 *
 * Baileys is an optional dependency and is imported lazily, so the server still
 * boots cleanly if it fails to install or you never turn this on.
 *
 * Railway note: the container filesystem resets on redeploy. Attach a volume and
 * point WA_SESSION_DIR at it, otherwise you re-scan the QR after every deploy.
 */
import fs from 'node:fs';
import path from 'node:path';

const SESSION_DIR = process.env.WA_SESSION_DIR || '/data/wa-session';

const state = {
        status: 'disconnected', // disconnected | pairing | connected | error
        qr: null,
        me: null,
        error: null,
        sock: null,
        starting: false
};

let onIncoming = async () => {};
export function onWebMessage(handler) {
        onIncoming = handler;
}

/** Fires once with a batch of historical messages after a fresh QR pairing. */
let onHistory = async () => {};
export function onHistorySync(handler) {
        onHistory = handler;
}

export function webStatus() {
        return {
                  available: true,
                  status: state.status,
                  qr: state.qr,
                  me: state.me,
                  error: state.error,
                  sessionDir: SESSION_DIR
        };
}

/** Some message types just wrap another message inside them. Unwrap until we hit real content. */
function unwrapMessage(msg) {
        let current = msg;
        for (let i = 0; i < 5 && current; i++) {
                  if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
                  else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
                  else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
                  else if (current.viewOnceMessageV2Extension?.message) current = current.viewOnceMessageV2Extension.message;
                  else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
                  else break;
        }
        return current || {};
}

/** Pull whatever text a person typed out of the (possibly wrapped) message payload. */
function extractBody(rawMessage) {
        const msg = unwrapMessage(rawMessage);
        return (
                  msg.conversation ||
                  msg.extendedTextMessage?.text ||
                  msg.imageMessage?.caption ||
                  msg.videoMessage?.caption ||
                  msg.documentMessage?.caption ||
                  msg.buttonsResponseMessage?.selectedDisplayText ||
                  msg.templateButtonReplyMessage?.selectedDisplayText ||
                  msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
                  msg.reactionMessage?.text ||
                  null
                );
}

/** Shared shape-normalizer for both live messages and history-sync messages. Returns null to skip. */
function extractMessage(m) {
        const jid = m.key.remoteJid || '';
        if (jid.endsWith('@g.us')) return null; // skip groups

  // Baileys 7 exposes the real phone number for @lid-addressed chats via
  // remoteJidAlt/participantAlt instead of the old senderPn/participantPn fields.
  const rawFrom =
                  m.key.senderPn ||
                  m.key.participantPn ||
                  m.key.remoteJidAlt ||
                  m.key.participantAlt ||
                  (jid.endsWith('@lid') ? null : jid.split('@')[0]);
        const from = rawFrom ? String(rawFrom).replace(/\D/g, '') : '';
        if (!from) return null;

  const msgKeys = Object.keys(m.message || {});
        if (msgKeys.length === 0) return null; // undecryptable / no content

  const body = extractBody(m.message || {});
        return {
                  from,
                  name: m.pushName || null,
                  body: body || '[media]',
                  wa_message_id: m.key.id,
                  ts: new Date(Number(m.messageTimestamp) * 1000),
                  fromMe: !!m.key.fromMe
        };
}

export async function startWeb() {
        if (state.starting || state.status === 'connected') return webStatus();
        state.starting = true;
        state.error = null;

  let baileys;
        let QRCode;
        try {
                  baileys = await import('@whiskeysockets/baileys');
                  QRCode = (await import('qrcode')).default;
        } catch (err) {
                  state.starting = false;
                  state.status = 'error';
                  state.error = 'Baileys is not installed. Run: npm install @whiskeysockets/baileys qrcode';
                  return webStatus();
        }

  const makeWASocket = baileys.default || baileys.makeWASocket;
        const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

  let sock;
        try {
                  fs.mkdirSync(SESSION_DIR, { recursive: true });
                  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
                  const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({ version, auth: authState, printQRInTerminal: false, syncFullHistory: true });
                  state.sock = sock;
                  state.status = 'pairing';

        sock.ev.on('creds.update', saveCreds);
        } catch (err) {
                  state.starting = false;
                  state.status = 'error';
                  state.error = `Could not start pairing: ${err.message}`;
                  return webStatus();
        }

  sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                        state.qr = await QRCode.toDataURL(qr);
                        state.status = 'pairing';
            }
            if (connection === 'open') {
                        state.status = 'connected';
                        state.qr = null;
                        state.me = sock.user?.id?.split(':')[0] || null;
                        state.starting = false;
                        console.log('WhatsApp Web connected as', state.me);
            }
            if (connection === 'close') {
                        state.starting = false;
                        const code = lastDisconnect?.error?.output?.statusCode;
                        const loggedOut = code === DisconnectReason.loggedOut;
                        state.status = loggedOut ? 'disconnected' : 'error';
                        state.error = loggedOut ? null : 'Connection dropped. Reconnect to continue.';
                        state.sock = null;
                        if (!loggedOut) setTimeout(() => startWeb().catch(() => {}), 5000);
            }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const m of messages) {
                        const extracted = extractMessage(m);
                        if (!extracted) {
                                      console.warn('Skipping WhatsApp message: no phone number or empty/undecryptable payload. key:', JSON.stringify(m.key));
                                      continue;
                        }
              await onIncoming(extracted).catch((e) => console.error('Incoming handler failed:', e.message));
            }
  });

  // Delivered once, in batches, right after a fresh QR pairing (syncFullHistory: true above).
  sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
            const batch = (messages || []).map(extractMessage).filter(Boolean);
            if (batch.length === 0) return;
            console.log(`[WhatsApp] History sync: ${batch.length} messages${isLatest ? ' (final batch)' : ''}`);
            await onHistory(batch).catch((e) => console.error('History sync handler failed:', e.message));
  });

  state.starting = false;
        return webStatus();
}

export async function sendWebText(phone, body) {
        if (state.status !== 'connected' || !state.sock) throw new Error('WhatsApp Web is not connected.');
        const jid = `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`;
        const sent = await state.sock.sendMessage(jid, { text: body });
        return { id: sent?.key?.id };
}

/** Clear every credential file without removing SESSION_DIR itself — on Railway
 * that path is a volume mount point, and rmSync-ing it outright fails with EBUSY. */
function clearSessionFiles() {
        let entries = [];
        try {
                  entries = fs.readdirSync(SESSION_DIR);
        } catch {
                  return;
        }
        for (const entry of entries) {
                  fs.rmSync(path.join(SESSION_DIR, entry), { recursive: true, force: true });
        }
}

export async function logoutWeb() {
        try {
                  await state.sock?.logout();
        } catch {
                  /* already gone */
        }
        state.sock = null;
        state.status = 'disconnected';
        state.qr = null;
        state.me = null;
        state.error = null;
        clearSessionFiles();
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        return webStatus();
}

export function sessionPath() {
        return path.resolve(SESSION_DIR);
}
