import express from 'express';
import { q, getSetting, setSetting } from '../db.js';
import { cloudConfigured, parseWebhook, downloadCloudMedia } from '../services/whatsappCloud.js';
import { startWeb, logoutWeb, webStatus, onWebMessage, onHistorySync } from '../services/whatsappWeb.js';
import { normalisePhone } from '../services/meta.js';

export const whatsappRouter = express.Router();

// The exact prefilled greeting Meta hands someone who clicks a Click-to-WhatsApp
// ad varies per campaign, so this is a list, editable via /api/whatsapp/settings.
const DEFAULT_AD_GREETING_PATTERNS = [
  'I filled in your form and would like to know more about your business',
  'Hello! Can I get more info on this?'
];

// Inbound WhatsApp (Baileys listener / Cloud webhook) has no logged-in user.
// Today there is one global WhatsApp connection, so it belongs to the first
// user. Stage 4 replaces this with per-session tenant routing.
let _ownerId = null;
async function ownerUserId() {
  if (_ownerId) return _ownerId;
  const { rows } = await q('SELECT id FROM users ORDER BY id LIMIT 1');
  _ownerId = rows[0]?.id || null;
  return _ownerId;
}

/** True if the message text looks like a Meta ad-click greeting, not an ordinary reply. */
function looksLikeAdGreeting(body, patterns) {
  if (!body) return false;
  const text = body.toLowerCase();
  return patterns.some((p) => p && text.includes(String(p).toLowerCase()));
}

/** True if this wa_message_id is already stored for this user. */
async function alreadyStored(userId, wa_message_id) {
  if (!wa_message_id) return false;
  const { rows } = await q('SELECT 1 FROM messages WHERE wa_message_id = $1 AND user_id = $2 LIMIT 1', [wa_message_id, userId]);
  return rows.length > 0;
}

/**
 * Attach an incoming message to a lead, creating a PENDING lead if this number
 * is new. Only stores messages for Meta-verified leads. Shared by the Cloud API
 * webhook and the WhatsApp Web listener.
 */
export async function ingestIncoming({ from, name, body, wa_message_id, ts, fromMe, media_data, media_mime }) {
  const userId = await ownerUserId();
  if (!userId) return null;
  const phone = normalisePhone(from);
  const { rows } = await q('SELECT * FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1', [phone, userId]);
  let lead = rows[0];

  if (fromMe) {
    if (!lead || !lead.is_meta_verified) return lead || null;
    if (await alreadyStored(userId, wa_message_id)) return lead;
    await q(
      `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, created_at, user_id)
      VALUES ($1,'out','whatsapp',$2,$3,$4,$5,$6,$7)`,
      [lead.id, body, wa_message_id, media_data || null, media_mime || null, ts || new Date(), userId]
    );
    await q('UPDATE leads SET last_contacted_at = now(), updated_at = now() WHERE id = $1', [lead.id]);
    console.log(`[WhatsApp] Recorded phone-sent reply for lead ${lead.id} (${phone})`);
    return lead;
  }

  if (!lead) {
    const onlyExistingLeads = await getSetting(userId, 'wa_only_existing_leads', false);
    const patterns = await getSetting(userId, 'wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS);
    const isAdGreeting = looksLikeAdGreeting(body, patterns);

    if (onlyExistingLeads || !isAdGreeting) {
      await q(
        `INSERT INTO pending_messages (phone, body, channel, created_at, user_id) VALUES ($1, $2, 'whatsapp', $3, $4)`,
        [phone, body, ts || new Date(), userId]
      );
      console.log(`[WhatsApp] Message from unknown number ${phone} queued`);
      return null;
    }
    const { rows: firstStage } = await q('SELECT id FROM stages WHERE user_id = $1 ORDER BY position LIMIT 1', [userId]);
    const inserted = await q(
      `INSERT INTO leads (full_name, phone, source, wants_whatsapp, stage_id, is_meta_verified, user_id)
      VALUES ($1,$2,'whatsapp',true,$3,true,$4) RETURNING *`,
      [name || phone, phone, firstStage[0]?.id, userId]
    );
    lead = inserted.rows[0];
    console.log(`[WhatsApp] Created verified lead for phone ${phone} from ad conversation`);
  }

  if (lead.is_meta_verified) {
    if (await alreadyStored(userId, wa_message_id)) return lead;
    await q(
      `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, created_at, user_id)
      VALUES ($1,'in','whatsapp',$2,$3,$4,$5,$6,$7)`,
      [lead.id, body, wa_message_id, media_data || null, media_mime || null, ts || new Date(), userId]
    );
    await q('UPDATE leads SET wants_whatsapp = true, updated_at = now() WHERE id = $1', [lead.id]);
    console.log(`[WhatsApp] Message attached to verified lead ${lead.id}`);
    return lead;
  }

  await q(
    `INSERT INTO pending_messages (phone, body, channel, created_at, user_id) VALUES ($1, $2, 'whatsapp', $3, $4)`,
    [phone, body, ts || new Date(), userId]
  );
  console.log(`[WhatsApp] Message queued in pending_messages for phone ${phone}`);
  return lead || null;
}

/** Backfills conversation history delivered right after a fresh WhatsApp Web pairing. */
async function ingestHistoryBatch(items) {
  const userId = await ownerUserId();
  if (!userId) return;
  let attached = 0;
  for (const item of items) {
    try {
      const phone = normalisePhone(item.from);
      const { rows } = await q('SELECT * FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1', [phone, userId]);
      const lead = rows[0];
      if (!lead || !lead.is_meta_verified) continue;
      if (await alreadyStored(userId, item.wa_message_id)) continue;
      await q(
        `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, created_at, user_id)
        VALUES ($1,$2,'whatsapp',$3,$4,$5,$6,$7,$8)`,
        [lead.id, item.fromMe ? 'out' : 'in', item.body, item.wa_message_id, item.media_data || null, item.media_mime || null, item.ts, userId]
      );
      attached++;
    } catch (e) {
      console.error('History backfill failed for one message:', e.message);
    }
  }
  if (attached > 0) console.log(`[WhatsApp] History sync: attached ${attached} message(s) to existing leads`);
}

onWebMessage(ingestIncoming);
onHistorySync(ingestHistoryBatch);

whatsappRouter.get('/status', (req, res) => {
  res.json({
    cloud: {
      connected: cloudConfigured(),
      phoneNumberId: process.env.WA_PHONE_NUMBER_ID || null,
      webhookPath: '/api/whatsapp/webhook'
    },
    web: webStatus()
  });
});

whatsappRouter.get('/settings', async (req, res, next) => {
  try {
    res.json({
      onlyExistingLeads: await getSetting(req.user.id, 'wa_only_existing_leads', false),
      adGreetingPatterns: await getSetting(req.user.id, 'wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS)
    });
  } catch (e) {
    next(e);
  }
});

whatsappRouter.patch('/settings', async (req, res, next) => {
  try {
    const { onlyExistingLeads, adGreetingPatterns } = req.body || {};
    if (onlyExistingLeads !== undefined) await setSetting(req.user.id, 'wa_only_existing_leads', !!onlyExistingLeads);
    if (Array.isArray(adGreetingPatterns)) {
      await setSetting(req.user.id, 'wa_ad_greeting_patterns', adGreetingPatterns.map((p) => String(p).trim()).filter(Boolean));
    }
    res.json({
      onlyExistingLeads: await getSetting(req.user.id, 'wa_only_existing_leads', false),
      adGreetingPatterns: await getSetting(req.user.id, 'wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS)
    });
  } catch (e) {
    next(e);
  }
});

/* ---------- quick-reply message templates ----------
 * Saved WhatsApp replies, one list per user. Stored as a settings blob
 * [{ id, label, body }]; bodies may contain {name} / {first_name} / {phone} /
 * {city} placeholders, filled in by the client on insert.
 */

function cleanTemplate(t) {
  return {
    id: t.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    label: String(t.label || '').trim().slice(0, 80),
    body: String(t.body || '').trim().slice(0, 4000)
  };
}

whatsappRouter.get('/templates', async (req, res, next) => {
  try {
    res.json(await getSetting(req.user.id, 'wa_message_templates', []));
  } catch (e) {
    next(e);
  }
});

whatsappRouter.post('/templates', async (req, res, next) => {
  try {
    if (!String(req.body?.body || '').trim()) return res.status(400).json({ error: 'Template text is required.' });
    const list = await getSetting(req.user.id, 'wa_message_templates', []);
    const updated = [...list, cleanTemplate(req.body)];
    await setSetting(req.user.id, 'wa_message_templates', updated);
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

whatsappRouter.patch('/templates/:id', async (req, res, next) => {
  try {
    const list = await getSetting(req.user.id, 'wa_message_templates', []);
    let found = false;
    const updated = list.map((t) => {
      if (t.id !== req.params.id) return t;
      found = true;
      return cleanTemplate({
        id: t.id,
        label: req.body?.label !== undefined ? req.body.label : t.label,
        body: req.body?.body !== undefined ? req.body.body : t.body
      });
    });
    if (!found) return res.status(404).json({ error: 'Template not found.' });
    await setSetting(req.user.id, 'wa_message_templates', updated);
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

whatsappRouter.delete('/templates/:id', async (req, res, next) => {
  try {
    const list = await getSetting(req.user.id, 'wa_message_templates', []);
    const updated = list.filter((t) => t.id !== req.params.id);
    await setSetting(req.user.id, 'wa_message_templates', updated);
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/** Start pairing — poll /status until it flips to connected. */
whatsappRouter.post('/web/connect', async (req, res, next) => {
  try {
    res.json(await startWeb());
  } catch (e) {
    next(e);
  }
});

whatsappRouter.post('/web/logout', async (req, res, next) => {
  try {
    res.json(await logoutWeb());
  } catch (e) {
    next(e);
  }
});

/* ---------- Meta Cloud API webhook ---------- */

whatsappRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

whatsappRouter.post('/webhook', async (req, res) => {
  res.sendStatus(200); // acknowledge fast, then process
  try {
    for (const msg of parseWebhook(req.body)) {
      if (msg.media?.id) {
        try {
          const downloaded = await downloadCloudMedia(msg.media.id);
          if (downloaded) Object.assign(msg, downloaded);
        } catch (e) {
          console.error('WhatsApp Cloud media download failed:', e.message);
        }
      }
      await ingestIncoming(msg);
    }
  } catch (e) {
    console.error('Webhook processing failed:', e.message);
  }
});
