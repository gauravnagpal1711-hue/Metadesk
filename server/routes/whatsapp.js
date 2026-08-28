import express from 'express';
import { q, getSetting, setSetting } from '../db.js';
import { parseWebhook, downloadCloudMedia } from '../services/whatsappCloud.js';
import { startWeb, logoutWeb, webStatus, onWebMessage, onHistorySync } from '../services/whatsappWeb.js';
import { normalisePhone } from '../services/meta.js';
import {
  loadWaConnection, saveWaConnection, userIdForPhoneNumberId, verifyTokenMatches
} from '../services/waConnection.js';

export const whatsappRouter = express.Router();

// The exact prefilled greeting Meta hands someone who clicks a Click-to-WhatsApp
// ad varies per campaign, so this is a list, editable via /api/whatsapp/settings.
const DEFAULT_AD_GREETING_PATTERNS = [
  'I filled in your form and would like to know more about your business',
  'Hello! Can I get more info on this?'
];

function looksLikeAdGreeting(body, patterns) {
  if (!body) return false;
  const text = body.toLowerCase();
  return patterns.some((p) => p && text.includes(String(p).toLowerCase()));
}

async function alreadyStored(userId, wa_message_id) {
  if (!wa_message_id) return false;
  const { rows } = await q('SELECT 1 FROM messages WHERE wa_message_id = $1 AND user_id = $2 LIMIT 1', [wa_message_id, userId]);
  return rows.length > 0;
}

/**
 * Attach an incoming message to one user's lead, creating a PENDING lead if the
 * number is new. Only stores messages for Meta-verified leads. Shared by the
 * Cloud API webhook (routed by phone_number_id) and each user's Baileys socket.
 */
export async function ingestIncoming(userId, { from, name, body, wa_message_id, ts, fromMe, media_data, media_mime }) {
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
    console.log(`[WhatsApp u${userId}] Recorded phone-sent reply for lead ${lead.id}`);
    return lead;
  }

  if (!lead) {
    const onlyExistingLeads = await getSetting(userId, 'wa_only_existing_leads', false);
    const patterns = await getSetting(userId, 'wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS);
    if (onlyExistingLeads || !looksLikeAdGreeting(body, patterns)) {
      await q(
        `INSERT INTO pending_messages (phone, body, channel, created_at, user_id) VALUES ($1, $2, 'whatsapp', $3, $4)`,
        [phone, body, ts || new Date(), userId]
      );
      console.log(`[WhatsApp u${userId}] Message from unknown number ${phone} queued`);
      return null;
    }
    const { rows: firstStage } = await q('SELECT id FROM stages WHERE user_id = $1 ORDER BY position LIMIT 1', [userId]);
    const inserted = await q(
      `INSERT INTO leads (full_name, phone, source, wants_whatsapp, stage_id, is_meta_verified, user_id)
      VALUES ($1,$2,'whatsapp',true,$3,true,$4) RETURNING *`,
      [name || phone, phone, firstStage[0]?.id, userId]
    );
    lead = inserted.rows[0];
    console.log(`[WhatsApp u${userId}] Created verified lead for ${phone} from ad conversation`);
  }

  if (lead.is_meta_verified) {
    if (await alreadyStored(userId, wa_message_id)) return lead;
    await q(
      `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, created_at, user_id)
      VALUES ($1,'in','whatsapp',$2,$3,$4,$5,$6,$7)`,
      [lead.id, body, wa_message_id, media_data || null, media_mime || null, ts || new Date(), userId]
    );
    await q('UPDATE leads SET wants_whatsapp = true, updated_at = now() WHERE id = $1', [lead.id]);
    console.log(`[WhatsApp u${userId}] Message attached to lead ${lead.id}`);
    return lead;
  }

  await q(
    `INSERT INTO pending_messages (phone, body, channel, created_at, user_id) VALUES ($1, $2, 'whatsapp', $3, $4)`,
    [phone, body, ts || new Date(), userId]
  );
  console.log(`[WhatsApp u${userId}] Message queued in pending_messages for ${phone}`);
  return lead || null;
}

async function ingestHistoryBatch(userId, items) {
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
  if (attached > 0) console.log(`[WhatsApp u${userId}] History sync: attached ${attached} message(s)`);
}

onWebMessage(ingestIncoming);
onHistorySync(ingestHistoryBatch);

/* ---------- per-user status + config ---------- */

whatsappRouter.get('/status', async (req, res, next) => {
  try {
    const wa = await loadWaConnection(req.user.id);
    const web = webStatus(req.user.id);
    // Lazily persist a completed pairing so it auto-starts after the next deploy.
    if (web.status === 'connected' && (!wa.webPaired || wa.webPhone !== web.me)) {
      await saveWaConnection(req.user.id, { webPaired: true, webPhone: web.me });
    }
    res.json({
      cloud: {
        connected: Boolean(wa.cloud),
        phoneNumberId: wa.cloudPhoneNumberId,
        webhookPath: '/api/whatsapp/webhook'
      },
      web
    });
  } catch (e) {
    next(e);
  }
});

/** Cloud API credentials for this tenant. */
whatsappRouter.get('/cloud', async (req, res, next) => {
  try {
    const wa = await loadWaConnection(req.user.id);
    res.json({
      phoneNumberId: wa.cloudPhoneNumberId,
      verifyToken: wa.cloudVerifyToken,
      hasToken: Boolean(wa.cloud?.token),
      webhookUrl: '/api/whatsapp/webhook'
    });
  } catch (e) {
    next(e);
  }
});

whatsappRouter.patch('/cloud', async (req, res, next) => {
  try {
    const { phoneNumberId, token, verifyToken } = req.body || {};
    const patch = {};
    if (phoneNumberId !== undefined) patch.cloudPhoneNumberId = String(phoneNumberId).trim() || null;
    if (token !== undefined) patch.cloudToken = String(token).trim() || null;
    if (verifyToken !== undefined) patch.cloudVerifyToken = String(verifyToken).trim() || null;
    const wa = await saveWaConnection(req.user.id, patch);
    res.json({ phoneNumberId: wa.cloudPhoneNumberId, verifyToken: wa.cloudVerifyToken, hasToken: Boolean(wa.cloud?.token) });
  } catch (e) {
    next(e);
  }
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

/* ---------- quick-reply message templates (one list per user) ---------- */

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

/* ---------- Baileys (WhatsApp Web) pairing, per user ---------- */

whatsappRouter.post('/web/connect', async (req, res, next) => {
  try {
    res.json(await startWeb(req.user.id));
  } catch (e) {
    next(e);
  }
});

whatsappRouter.post('/web/logout', async (req, res, next) => {
  try {
    const out = await logoutWeb(req.user.id);
    await saveWaConnection(req.user.id, { webPaired: false, webPhone: null });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

/* ---------- Meta Cloud API webhook (unauthenticated, routed by tenant) ---------- */

whatsappRouter.get('/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && (await verifyTokenMatches(token))) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

whatsappRouter.post('/webhook', async (req, res) => {
  res.sendStatus(200); // acknowledge fast, then process
  try {
    for (const msg of parseWebhook(req.body)) {
      const userId = await userIdForPhoneNumberId(msg.phone_number_id);
      if (!userId) {
        console.warn('[WhatsApp webhook] no tenant for phone_number_id', msg.phone_number_id);
        continue;
      }
      if (msg.media?.id) {
        try {
          const wa = await loadWaConnection(userId);
          if (wa.cloud) {
            const downloaded = await downloadCloudMedia(wa.cloud, msg.media.id);
            if (downloaded) Object.assign(msg, downloaded);
          }
        } catch (e) {
          console.error('WhatsApp Cloud media download failed:', e.message);
        }
      }
      await ingestIncoming(userId, msg);
    }
  } catch (e) {
    console.error('Webhook processing failed:', e.message);
  }
});
