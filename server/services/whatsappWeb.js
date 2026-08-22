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

        sock = makeWASocket({ version, auth: authState, printQRInTerminal: false, syncFullHistory: false });
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
                        if (m.key.fromMe) continue;
                        const jid = m.key.remoteJid || '';
                        if (jid.endsWith('@g.us')) continue; // skip groups

              const rawFrom =
                            m.key.senderPn ||
                            m.key.participantPn ||
                            (jid.endsWith('@lid') ? null : jid.split('@')[0]);
                        const from = rawFrom ? String(rawFrom).replace(/\D/g, '') : '';
                        if (!from) {
                                      console.warn('Skipping WhatsApp message: could not resolve a phone number for jid', jid, 'key:', JSON.stringify(m.key));
                                      continue;
                        }

              const msgKeys = Object.keys(m.message || {});
                        if (msgKeys.length === 0) {
                                      // Payload failed to decrypt (common on first delivery for @lid-addressed chats).
                          // WhatsApp will automatically retry with a working session; skip so we don't
                          // permanently store a fake "[media]" placeholder over what is really text.
                          console.warn('Skipping WhatsApp message: empty/undecryptable payload, awaiting retry. key:', JSON.stringify(m.key));
                                      continue;
                        }

              const body = extractBody(m.message || {});
                        if (!body) {
                                      console.warn('WhatsApp message had no extractable text, saving as [media]. Message keys:', msgKeys, 'unwrapped keys:', Object.keys(unwrapMessage(m.message || {})));
                        }

              await onIncoming({
                            from,
                            name: m.pushName || null,
                            body: body || '[media]',
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
