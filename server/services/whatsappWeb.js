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

  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({ version, auth: authState, printQRInTerminal: false, syncFullHistory: false });
  state.sock = sock;
  state.status = 'pairing';

  sock.ev.on('creds.update', saveCreds);

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
      if (m.key.fromMe) continue;
      const jid = m.key.remoteJid || '';
      if (jid.endsWith('@g.us')) continue; // skip groups
      const body =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        '[media]';
      await onIncoming({
        from: jid.split('@')[0],
        name: m.pushName || null,
        body,
        wa_message_id: m.key.id,
        ts: new Date(Number(m.messageTimestamp) * 1000)
      }).catch((e) => console.error('Incoming handler failed:', e.message));
    }
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
  fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  return webStatus();
}

export function sessionPath() {
  return path.resolve(SESSION_DIR);
}
