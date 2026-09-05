import express from 'express';
import { q, getSetting, setSetting } from '../db.js';
import { parseWebhook, downloadCloudMedia } from '../services/whatsappCloud.js';
import {
  startWeb, logoutWeb, webStatus, onWebMessage, onHistorySync, onQuickReplySync, syncPhoneQuickReplies, onMessageStatus
} from '../services/whatsappWeb.js';
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

/** Queue a message for a number that has no (verified) lead yet, keeping its
 *  direction, media and metadata so nothing is lost. */
async function queuePending(userId, phone, m) {
  if (m.wa_message_id) {
    const dup = await q('SELECT 1 FROM pending_messages WHERE wa_message_id = $1 AND user_id = $2 LIMIT 1', [m.wa_message_id, userId]);
    if (dup.rows.length) return;
  }
  await q(
    `INSERT INTO pending_messages (phone, body, direction, wa_message_id, media_data, media_mime, meta, channel, created_at, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'whatsapp',$8,$9)`,
    [phone, m.body || null, m.fromMe ? 'out' : 'in', m.wa_message_id || null,
     m.media_data || null, m.media_mime || null, m.meta ? JSON.stringify(m.meta) : null, m.ts || new Date(), userId]
  );
}

/** Move any queued messages for a phone onto a real lead, in order. */
export async function attachPending(userId, phone, leadId) {
  const { rows: pend } = await q(
    'SELECT * FROM pending_messages WHERE phone = $1 AND user_id = $2 ORDER BY created_at ASC',
    [phone, userId]
  );
  if (!pend.length) return 0;
  for (const p of pend) {
    if (p.wa_message_id && await alreadyStored(userId, p.wa_message_id)) continue;
    await q(
      `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, meta, created_at, user_id)
       VALUES ($1,$2,'whatsapp',$3,$4,$5,$6,$7,$8,$9)`,
      [leadId, p.direction || 'in', p.body, p.wa_message_id, p.media_data, p.media_mime,
       p.meta ? JSON.stringify(p.meta) : null, p.created_at, userId]
    );
    if (p.meta?.ad_reply) await captureAdReferral(userId, leadId, p.meta.ad_reply);
  }
  await q('DELETE FROM pending_messages WHERE phone = $1 AND user_id = $2', [phone, userId]);
  await q('UPDATE leads SET wants_whatsapp = true, updated_at = now() WHERE id = $1', [leadId]);
  return pend.length;
}

async function captureAdReferral(userId, leadId, adReply) {
  if (!adReply) return;
  await q(
    `UPDATE leads SET ad_referral = COALESCE(ad_referral, $3::jsonb), updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [leadId, userId, JSON.stringify(adReply)]
  );
}

/**
 * Attach a message to one user's lead, creating a lead if the first message
 * looks like an ad-click. Shared by the Cloud webhook (routed by
 * phone_number_id) and each user's Baileys socket. `m` = the extractMessage
 * shape: { from, name, body, wa_message_id, ts, fromMe, media_data, media_mime, meta }.
 */
export async function ingestIncoming(userId, m) {
  if (!userId) return null;
  const { name, body, wa_message_id, ts, fromMe, media_data, media_mime, meta } = m;
  const phone = normalisePhone(m.from);
  const { rows } = await q('SELECT * FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1', [phone, userId]);
  let lead = rows[0];

  // No (verified) lead yet: either create one from an ad greeting, or queue.
  if (!lead || !lead.is_meta_verified) {
    if (!lead && !fromMe) {
      const onlyExistingLeads = await getSetting(userId, 'wa_only_existing_leads', false);
      const patterns = await getSetting(userId, 'wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS);
      if (!onlyExistingLeads && looksLikeAdGreeting(body, patterns)) {
        const { rows: firstStage } = await q('SELECT id FROM stages WHERE user_id = $1 ORDER BY position LIMIT 1', [userId]);
        const inserted = await q(
          `INSERT INTO leads (full_name, phone, source, wants_whatsapp, stage_id, is_meta_verified, user_id)
          VALUES ($1,$2,'whatsapp',true,$3,true,$4) RETURNING *`,
          [name || phone, phone, firstStage[0]?.id, userId]
        );
        lead = inserted.rows[0];
        console.log(`[WhatsApp u${userId}] Created verified lead for ${phone} from ad conversation`);
        await attachPending(userId, phone, lead.id); // pull in anything queued before the greeting
      }
    }
    if (!lead || !lead.is_meta_verified) {
      await queuePending(userId, phone, m);
      console.log(`[WhatsApp u${userId}] Message queued for ${phone} (${fromMe ? 'out' : 'in'})`);
      return lead || null;
    }
  }

  if (await alreadyStored(userId, wa_message_id)) return lead;
  await q(
    `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, meta, created_at, user_id)
    VALUES ($1,$2,'whatsapp',$3,$4,$5,$6,$7,$8,$9)`,
    [lead.id, fromMe ? 'out' : 'in', body, wa_message_id, media_data || null, media_mime || null,
     meta ? JSON.stringify(meta) : null, ts || new Date(), userId]
  );
  if (meta?.ad_reply) await captureAdReferral(userId, lead.id, meta.ad_reply);
  await q(
    `UPDATE leads SET wants_whatsapp = true, updated_at = now()${fromMe ? ', last_contacted_at = now()' : ''} WHERE id = $1`,
    [lead.id]
  );
  console.log(`[WhatsApp u${userId}] ${fromMe ? 'out' : 'in'} message attached to lead ${lead.id}`);
  return lead;
}

async function ingestHistoryBatch(userId, items) {
  if (!userId) return;
  let attached = 0;
  let reconciled = 0;
  for (const item of items) {
    try {
      const phone = normalisePhone(item.from);
      const { rows } = await q('SELECT * FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1', [phone, userId]);
      const lead = rows[0];
      if (!lead || !lead.is_meta_verified) continue; // never import non-lead (personal) chats

      if (await alreadyStored(userId, item.wa_message_id)) {
        // Already have the message, but an earlier sync may have stored it before
        // we could read click-to-WhatsApp ad / quoted-reply context. Backfill
        // that now — never overwriting anything already captured.
        if (item.meta?.ad_reply && !lead.ad_referral) {
          await captureAdReferral(userId, lead.id, item.meta.ad_reply);
        }
        if (item.meta) {
          const { rowCount } = await q(
            `UPDATE messages SET meta = $1
             WHERE wa_message_id = $2 AND user_id = $3 AND lead_id = $4 AND meta IS NULL`,
            [JSON.stringify(item.meta), item.wa_message_id, userId, lead.id]
          );
          if (rowCount) reconciled++;
        }
        continue;
      }

      await q(
        `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, meta, created_at, user_id)
        VALUES ($1,$2,'whatsapp',$3,$4,$5,$6,$7,$8,$9)`,
        [lead.id, item.fromMe ? 'out' : 'in', item.body, item.wa_message_id, item.media_data || null, item.media_mime || null,
         item.meta ? JSON.stringify(item.meta) : null, item.ts, userId]
      );
      if (item.meta?.ad_reply) await captureAdReferral(userId, lead.id, item.meta.ad_reply);
      attached++;
    } catch (e) {
      console.error('History backfill failed for one message:', e.message);
    }
  }
  if (attached || reconciled) {
    console.log(`[WhatsApp u${userId}] History sync: attached ${attached}, reconciled ${reconciled} message(s)`);
  }
}

/** Keyed by shortcut (unique on the phone) rather than the sync entry's
 *  timestamp id, since editing a quick reply on the phone writes a fresh id. */
async function ingestQuickReply(userId, item) {
  const shortcut = item.shortcut;
  if (!shortcut) return;
  const list = await getSetting(userId, 'wa_phone_quick_replies', []);
  const idx = list.findIndex((q) => q.shortcut === shortcut);
  if (item.deleted) {
    if (idx === -1) return;
    list.splice(idx, 1);
    await setSetting(userId, 'wa_phone_quick_replies', list);
    return;
  }
  if (!item.message) return;
  const entry = { shortcut, message: item.message, keywords: item.keywords || [], synced_at: new Date().toISOString() };
  if (idx === -1) list.push(entry); else list[idx] = entry;
  await setSetting(userId, 'wa_phone_quick_replies', list);
}

const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

/** Delivery acks can arrive out of order; never let a late 'sent' echo undo an
 *  already-recorded 'read'. */
async function ingestStatusUpdate(userId, { wa_message_id, status }) {
  if (!wa_message_id || !STATUS_RANK[status]) return;
  await q(
    `UPDATE messages SET status = $1
     WHERE wa_message_id = $2 AND user_id = $3
       AND COALESCE(array_position(ARRAY['sent','delivered','read'], status), 0) <= $4`,
    [status, wa_message_id, userId, STATUS_RANK[status]]
  );
}

onWebMessage(ingestIncoming);
onHistorySync(ingestHistoryBatch);
onQuickReplySync(ingestQuickReply);
onMessageStatus(ingestStatusUpdate);

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

/* ---------- quick replies configured on the linked phone (WhatsApp Business
   app > Settings > Business tools > Quick replies), read-only mirror ---------- */

whatsappRouter.get('/quick-replies', async (req, res, next) => {
  try {
    res.json(await getSetting(req.user.id, 'wa_phone_quick_replies', []));
  } catch (e) {
    next(e);
  }
});

whatsappRouter.post('/quick-replies/sync', async (req, res, next) => {
  try {
    res.json(await syncPhoneQuickReplies(req.user.id));
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
