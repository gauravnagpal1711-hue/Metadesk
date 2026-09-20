/**
 * Official WhatsApp Cloud API, per tenant.
 *
 * Every call takes a `cfg` object: { phoneNumberId, token }. cfgFromEnv() keeps
 * the old WA_PHONE_NUMBER_ID / WA_TOKEN env vars working for the first user.
 */
const VERSION = process.env.META_API_VERSION || 'v21.0';
const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // keep base64 rows in Postgres reasonable

export function cfgFromEnv() {
  if (!process.env.WA_PHONE_NUMBER_ID || !process.env.WA_TOKEN) return null;
  return { phoneNumberId: process.env.WA_PHONE_NUMBER_ID, token: process.env.WA_TOKEN };
}

export function cloudConfigured(cfg) {
  return Boolean(cfg && cfg.phoneNumberId && cfg.token);
}

/** Business-profile info for the connected number — verified name, display
 *  number and quality rating — so a tenant can confirm which number is live. */
export async function getPhoneNumberInfo(cfg) {
  if (!cloudConfigured(cfg)) return null;
  const res = await fetch(
    `https://graph.facebook.com/${VERSION}/${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
    { headers: { Authorization: `Bearer ${cfg.token}` } }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Could not read WhatsApp business profile.');
  return {
    displayPhoneNumber: json.display_phone_number || null,
    verifiedName: json.verified_name || null,
    qualityRating: json.quality_rating || null,
    codeVerificationStatus: json.code_verification_status || null
  };
}

export async function sendText(cfg, to, body, { quoted } = {}) {
  if (!cloudConfigured(cfg)) throw new Error('WhatsApp Cloud API is not connected.');
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: true, body },
      ...(quoted?.id ? { context: { message_id: quoted.id } } : {})
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'WhatsApp send failed.');
  return { id: json.messages?.[0]?.id };
}

/** Tap-to-react (or, with emoji: '', remove our reaction) on an earlier message. */
export async function sendReaction(cfg, to, { targetId, emoji }) {
  if (!cloudConfigured(cfg)) throw new Error('WhatsApp Cloud API is not connected.');
  if (!targetId) throw new Error('No WhatsApp message id to react to.');
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'reaction',
      reaction: { message_id: targetId, emoji: emoji || '' }
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'WhatsApp reaction failed.');
  return { id: json.messages?.[0]?.id };
}

const KIND_BY_MIME = (mime) => {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
};

/** mediaData is a base64 data URL. Uploads to Meta first, then sends by the returned media id. */
export async function sendMedia(cfg, to, { mediaData, mimeType, caption, fileName, quoted }) {
  if (!cloudConfigured(cfg)) throw new Error('WhatsApp Cloud API is not connected.');
  const match = /^data:([^;]+);base64,(.*)$/.exec(mediaData || '');
  if (!match) throw new Error('mediaData must be a base64 data URL.');
  const mimetype = mimeType || match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const kind = KIND_BY_MIME(mimetype);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimetype);
  form.append('file', new Blob([buffer], { type: mimetype }), fileName || `upload.${mimetype.split('/')[1] || 'bin'}`);

  const uploadRes = await fetch(`https://graph.facebook.com/${VERSION}/${cfg.phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: form
  });
  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploadJson?.error?.message || 'WhatsApp media upload failed.');

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: kind,
    [kind]: { id: uploadJson.id, ...(kind === 'document' ? { filename: fileName || 'file', caption } : { caption }) },
    ...(quoted?.id ? { context: { message_id: quoted.id } } : {})
  };
  const sendRes = await fetch(`https://graph.facebook.com/${VERSION}/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const sendJson = await sendRes.json();
  if (!sendRes.ok) throw new Error(sendJson?.error?.message || 'WhatsApp send failed.');
  return { id: sendJson.messages?.[0]?.id };
}

/** Fetch a received media item by its Graph API media id, as a base64 data URL. */
export async function downloadCloudMedia(cfg, mediaId) {
  const infoRes = await fetch(`https://graph.facebook.com/${VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${cfg.token}` }
  });
  const info = await infoRes.json();
  if (!infoRes.ok || !info.url) throw new Error(info?.error?.message || 'Could not resolve media URL.');
  if (info.file_size && Number(info.file_size) > MAX_MEDIA_BYTES) return null;

  const fileRes = await fetch(info.url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!fileRes.ok) throw new Error('Could not download media file.');
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const mimetype = info.mime_type || 'application/octet-stream';
  return { media_data: `data:${mimetype};base64,${buffer.toString('base64')}`, media_mime: mimetype };
}

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

/**
 * Flatten a webhook payload into
 * [{ phone_number_id, from, name, body, wa_message_id, ts, media }].
 * phone_number_id identifies which tenant the message belongs to.
 */
export function parseWebhook(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;
      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from);

        // A tap-to-react from the lead's side — targets an earlier message by
        // id, not a bubble of its own.
        if (msg.type === 'reaction') {
          out.push({
            phone_number_id: phoneNumberId,
            from: msg.from,
            reaction: { targetId: msg.reaction?.message_id, targetFromMe: true, emoji: msg.reaction?.emoji || '' },
            fromMe: false,
            ts: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date()
          });
          continue;
        }

        const mediaType = MEDIA_TYPES.find((t) => msg[t]);
        const meta = {};
        if (msg.referral) {
          meta.ad_reply = {
            title: msg.referral.headline || null,
            body: msg.referral.body || null,
            source_url: msg.referral.source_url || null,
            source_id: msg.referral.source_id || msg.referral.ctwa_clid || null,
            thumbnail_url: msg.referral.image_url || null,
            media_type: msg.referral.media_type || null
          };
        }
        if (mediaType && mediaType !== 'text') meta.subtype = mediaType;
        // The webhook only gives us the quoted message's id, not its text — the
        // ingest route resolves it against our own stored copy of that message.
        if (msg.context?.id) meta.reply_to_id = msg.context.id;
        out.push({
          phone_number_id: phoneNumberId,
          from: msg.from,
          name: contact?.profile?.name || null,
          body: msg.text?.body || msg.button?.text || (mediaType ? msg[mediaType]?.caption || null : null),
          wa_message_id: msg.id,
          ts: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
          fromMe: false,
          media: mediaType ? { id: msg[mediaType].id, mime_type: msg[mediaType].mime_type } : null,
          meta: Object.keys(meta).length ? meta : null
        });
      }
    }
  }
  return out;
}
