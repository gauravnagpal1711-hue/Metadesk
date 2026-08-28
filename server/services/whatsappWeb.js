/**
 * WhatsApp Web pairing via Baileys — per tenant. Each user pairs their own phone
 * (scan a QR) and gets their own socket. Session files live at
 * <WA_SESSION_DIR>/<userId>/.
 *
 * Baileys is an optional dependency, imported lazily, so the server still boots
 * if it isn't installed.
 *
 * Railway note: the container filesystem resets on redeploy — attach a volume and
 * point WA_SESSION_DIR at it, or every tenant re-scans after each deploy.
 */
import fs from 'node:fs';
import path from 'node:path';

const SESSION_ROOT = process.env.WA_SESSION_DIR || '/data/wa-session';
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

/** userId -> { status, qr, me, error, sock, starting } */
const sessions = new Map();

function blankSession() {
  return { status: 'disconnected', qr: null, me: null, error: null, sock: null, starting: false };
}
function sessionFor(userId) {
  let s = sessions.get(userId);
  if (!s) { s = blankSession(); sessions.set(userId, s); }
  return s;
}
function sessionDir(userId) {
  return path.join(SESSION_ROOT, String(userId));
}

// Set once Baileys is imported — extractMessage() needs it.
let downloadMediaMessageFn = null;

// handler(userId, extracted)
let onIncoming = async () => {};
export function onWebMessage(handler) { onIncoming = handler; }

// handler(userId, batch)
let onHistory = async () => {};
export function onHistorySync(handler) { onHistory = handler; }

export function webStatus(userId) {
  const s = sessions.get(userId) || blankSession();
  return {
    available: true,
    status: s.status,
    qr: s.qr,
    me: s.me,
    error: s.error,
    sessionDir: sessionDir(userId)
  };
}

/* ---------- message shape helpers (pure) ---------- */

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

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'];

async function extractMedia(rawMessage, fullMessage) {
  const msg = unwrapMessage(rawMessage);
  const key = MEDIA_KEYS.find((k) => msg[k]);
  if (!key || !downloadMediaMessageFn) return null;
  const mimetype = msg[key].mimetype || 'application/octet-stream';
  try {
    const buffer = await downloadMediaMessageFn(fullMessage, 'buffer', {});
    if (!buffer || buffer.length > MAX_MEDIA_BYTES) return null;
    return { media_data: `data:${mimetype};base64,${buffer.toString('base64')}`, media_mime: mimetype };
  } catch (e) {
    console.warn('WhatsApp media download failed:', e.message);
    return null;
  }
}

function resolveCounterpartyPhone(m) {
  const jid = m.key.remoteJid || '';
  if (jid.endsWith('@g.us') || jid.endsWith('@newsletter') || jid === 'status@broadcast' || jid.endsWith('@broadcast')) {
    return null;
  }
  const jidNumber = jid.endsWith('@lid') ? null : jid.split('@')[0];
  const candidates = m.key.fromMe
    ? [m.key.remoteJidAlt, jidNumber, m.key.participantAlt]
    : [m.key.senderPn, m.key.participantPn, m.key.remoteJidAlt, m.key.participantAlt, jidNumber];
  const raw = candidates.find(Boolean);
  const digits = raw ? String(raw).replace(/\D/g, '') : '';
  return digits || null;
}

async function extractMessage(m) {
  const from = resolveCounterpartyPhone(m);
  if (!from) return null;
  if (Object.keys(m.message || {}).length === 0) return null; // undecryptable / no content
  const body = extractBody(m.message || {});
  const media = await extractMedia(m.message || {}, m);
  return {
    from,
    name: m.pushName || null,
    body: body || (media ? null : '[media]'),
    wa_message_id: m.key.id,
    ts: new Date(Number(m.messageTimestamp) * 1000),
    fromMe: !!m.key.fromMe,
    media_data: media?.media_data || null,
    media_mime: media?.media_mime || null
  };
}

/* ---------- per-user socket lifecycle ---------- */

export async function startWeb(userId) {
  const s = sessionFor(userId);
  if (s.starting || s.status === 'connected') return webStatus(userId);
  s.starting = true;
  s.error = null;

  let baileys;
  let QRCode;
  try {
    baileys = await import('@whiskeysockets/baileys');
    QRCode = (await import('qrcode')).default;
  } catch {
    s.starting = false;
    s.status = 'error';
    s.error = 'Baileys is not installed. Run: npm install @whiskeysockets/baileys qrcode';
    return webStatus(userId);
  }

  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = baileys;
  downloadMediaMessageFn = downloadMediaMessage;

  let sock;
  try {
    fs.mkdirSync(sessionDir(userId), { recursive: true });
    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir(userId));
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, auth: authState, printQRInTerminal: false, syncFullHistory: true });
    s.sock = sock;
    s.status = 'pairing';
    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    s.starting = false;
    s.status = 'error';
    s.error = `Could not start pairing: ${err.message}`;
    return webStatus(userId);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      s.qr = await QRCode.toDataURL(qr);
      s.status = 'pairing';
    }
    if (connection === 'open') {
      s.status = 'connected';
      s.qr = null;
      s.me = sock.user?.id?.split(':')[0] || null;
      s.starting = false;
      console.log(`WhatsApp Web connected for user ${userId} as ${s.me}`);
    }
    if (connection === 'close') {
      s.starting = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      s.status = loggedOut ? 'disconnected' : 'error';
      s.error = loggedOut ? null : 'Connection dropped. Reconnect to continue.';
      s.sock = null;
      if (!loggedOut) setTimeout(() => startWeb(userId).catch(() => {}), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      const extracted = await extractMessage(m);
      if (!extracted) {
        console.warn(`[WhatsApp u${userId}] Skipping message (type=${type}): no lead phone / empty payload. key:`, JSON.stringify(m.key));
        continue;
      }
      await onIncoming(userId, extracted).catch((e) => console.error('Incoming handler failed:', e.message));
    }
  });

  sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
    const batch = (await Promise.all((messages || []).map(extractMessage))).filter(Boolean);
    if (batch.length === 0) return;
    console.log(`[WhatsApp u${userId}] History sync: ${batch.length} messages${isLatest ? ' (final)' : ''}`);
    await onHistory(userId, batch).catch((e) => console.error('History sync handler failed:', e.message));
  });

  s.starting = false;
  return webStatus(userId);
}

/** Start a socket for every user id that already has paired session files. */
export async function startAllWebSessions(userIds) {
  for (const uid of userIds) {
    try {
      if (fs.existsSync(path.join(sessionDir(uid), 'creds.json'))) {
        await startWeb(uid);
      }
    } catch (e) {
      console.error(`WhatsApp autostart failed for user ${uid}:`, e.message);
    }
  }
}

export async function sendWebText(userId, phone, body) {
  const s = sessions.get(userId);
  if (!s || s.status !== 'connected' || !s.sock) throw new Error('WhatsApp Web is not connected.');
  const jid = `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`;
  const sent = await s.sock.sendMessage(jid, { text: body });
  return { id: sent?.key?.id };
}

export async function sendWebMedia(userId, phone, { mediaData, mimeType, caption, fileName }) {
  const s = sessions.get(userId);
  if (!s || s.status !== 'connected' || !s.sock) throw new Error('WhatsApp Web is not connected.');
  const jid = `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`;
  const match = /^data:([^;]+);base64,(.*)$/.exec(mediaData || '');
  if (!match) throw new Error('mediaData must be a base64 data URL.');
  const mimetype = mimeType || match[1];
  const buffer = Buffer.from(match[2], 'base64');

  let payload;
  if (mimetype.startsWith('image/')) payload = { image: buffer, caption, mimetype };
  else if (mimetype.startsWith('video/')) payload = { video: buffer, caption, mimetype };
  else if (mimetype.startsWith('audio/')) payload = { audio: buffer, mimetype };
  else payload = { document: buffer, mimetype, fileName: fileName || 'file', caption };

  const sent = await s.sock.sendMessage(jid, payload);
  return { id: sent?.key?.id };
}

/** Clear one user's credential files without removing the dir (Railway volume). */
function clearSessionFiles(userId) {
  let entries = [];
  try { entries = fs.readdirSync(sessionDir(userId)); } catch { return; }
  for (const entry of entries) {
    fs.rmSync(path.join(sessionDir(userId), entry), { recursive: true, force: true });
  }
}

export async function logoutWeb(userId) {
  const s = sessionFor(userId);
  try { await s.sock?.logout(); } catch { /* already gone */ }
  s.sock = null;
  s.status = 'disconnected';
  s.qr = null;
  s.me = null;
  s.error = null;
  clearSessionFiles(userId);
  fs.mkdirSync(sessionDir(userId), { recursive: true });
  return webStatus(userId);
}

export function sessionPath(userId) {
  return path.resolve(sessionDir(userId));
}
