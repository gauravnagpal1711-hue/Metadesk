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
const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // keep base64 rows in Postgres reasonable

const state = {
        status: 'disconnected', // disconnected | pairing | connected | error
        qr: null,
        me: null,
        error: null,
        sock: null,
        starting: false
};

// Set once Baileys is dynamically imported in startWeb() — extractMessage() needs it.
let downloadMediaMessageFn = null;

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

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'];

/** Download and base64-encode any media attached to the (unwrapped) message. Returns null if none, or on failure. */
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

/**
 * Resolve the phone number of the *lead* a message belongs to — i.e. the chat's
 * counterparty, never us. For a 1:1 chat that's the chat JID itself; when the
 * chat is addressed by a privacy @lid, Baileys 7 carries the real number in
 * remoteJidAlt/participantAlt.
 *
 * senderPn/participantPn identify the *sender*. For an inbound message that's the
 * lead (useful fallback), but for our own outbound replies (key.fromMe) it's our
 * own number — so consulting them there resolved every phone-sent reply to us,
 * matched no lead, and the reply was dropped. Only use them for inbound.
 */
function resolveCounterpartyPhone(m) {
        const jid = m.key.remoteJid || '';
        if (
                  jid.endsWith('@g.us') ||        // groups
                  jid.endsWith('@newsletter') ||  // channels
                  jid === 'status@broadcast' ||   // status updates
                  jid.endsWith('@broadcast')      // broadcast lists
        ) {
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

/** Shared shape-normalizer for both live messages and history-sync messages. Returns null to skip. */
async function extractMessage(m) {
        const from = resolveCounterpartyPhone(m);
        if (!from) return null;

  const msgKeys = Object.keys(m.message || {});
        if (msgKeys.length === 0) return null; // undecryptable / no content

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
        const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = baileys;
        downloadMediaMessageFn = downloadMediaMessage;

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
            // 'notify'  — a freshly arrived message (inbound, or WhatsApp waking us for it)
            // 'append'  — a message tacked onto a chat without a notification: this is how
            //             replies you send from the *phone* itself typically reach a
            //             companion device. Dropping it lost every phone-sent reply.
            // Anything else (e.g. 'prepend' backfill) we ignore — history sync handles bulk.
            if (type !== 'notify' && type !== 'append') return;
            for (const m of messages) {
                        const extracted = await extractMessage(m);
                        if (!extracted) {
                                      console.warn(
                                                    `[WhatsApp] Skipping message (type=${type}): no lead phone or empty/undecryptable payload. key:`,
                                                    JSON.stringify(m.key)
                                      );
                                      continue;
                        }
              await onIncoming(extracted).catch((e) => console.error('Incoming handler failed:', e.message));
            }
  });

  // Delivered once, in batches, right after a fresh QR pairing (syncFullHistory: true above).
  sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
            const batch = (await Promise.all((messages || []).map(extractMessage))).filter(Boolean);
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

/** mediaData is a base64 data URL (data:<mime>;base64,<...>). */
export async function sendWebMedia(phone, { mediaData, mimeType, caption, fileName }) {
        if (state.status !== 'connected' || !state.sock) throw new Error('WhatsApp Web is not connected.');
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

  const sent = await state.sock.sendMessage(jid, payload);
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
