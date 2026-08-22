import express from 'express';
import { q, getSetting, setSetting } from '../db.js';
import { cloudConfigured, parseWebhook } from '../services/whatsappCloud.js';
import { startWeb, logoutWeb, webStatus, onWebMessage } from '../services/whatsappWeb.js';
import { normalisePhone } from '../services/meta.js';

export const whatsappRouter = express.Router();

// The exact prefilled greeting Meta hands someone who clicks a Click-to-WhatsApp
// ad varies per campaign (it's set in the ad's "message template"), so this is a
// list, not a single string — editable via /api/whatsapp/settings.
const DEFAULT_AD_GREETING_PATTERNS = [
  'I filled in your form and would like to know more about your business'
];

/** True if the message text looks like a Meta ad-click greeting, not an ordinary reply. */
function looksLikeAdGreeting(body, patterns) {
  if (!body) return false;
  const text = body.toLowerCase();
  return patterns.some((p) => p && text.includes(String(p).toLowerCase()));
}

/**
* Attach an incoming message to a lead, creating a PENDING lead if this number is new.
* Only stores messages for Meta-verified leads.
* Shared by both the Cloud API webhook and the WhatsApp Web listener.
*/
export async function ingestIncoming({ from, name, body, wa_message_id, ts }) {
const phone = normalisePhone(from);
let { rows } = await q('SELECT * FROM leads WHERE phone = $1 ORDER BY created_at ASC LIMIT 1', [phone]);
let lead = rows[0];

if (!lead) {
  const onlyExistingLeads = await getSetting('wa_only_existing_leads', false);
  const patterns = await getSetting('wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS);
  const isAdGreeting = looksLikeAdGreeting(body, patterns);

  if (onlyExistingLeads || !isAdGreeting) {
    // Either leads are Meta-forms-only for now, or this message doesn't look like
    // a genuine ad-click conversation (so we won't turn a random text into a lead).
    // Queue it — if a matching lead shows up later by this phone number, it's attached then.
    await q(
      `INSERT INTO pending_messages (phone, body, channel, created_at)
      VALUES ($1, $2, 'whatsapp', $3)`,
      [phone, body, ts || new Date()]
    );
    console.log(
      onlyExistingLeads
        ? `[WhatsApp] Message from unknown number ${phone} queued — leads are Meta-only right now`
        : `[WhatsApp] Message from unknown number ${phone} queued — first message didn't match a known ad greeting`
    );
    return null;
  }
      // Message matches a known ad-click greeting — this is a real click-to-WhatsApp lead.
  const { rows: firstStage } = await q('SELECT id FROM stages ORDER BY position LIMIT 1');
  const inserted = await q(
    `INSERT INTO leads (full_name, phone, source, wants_whatsapp, stage_id, is_meta_verified)
    VALUES ($1,$2,'whatsapp',true,$3,true) RETURNING *`,
    [name || phone, phone, firstStage[0]?.id]
  );
  lead = inserted.rows[0];
      console.log(`[WhatsApp] Created verified lead for phone ${phone} from ad conversation`);
}

// Only store message if lead is Meta-verified
if (lead.is_meta_verified) {
  await q(
    `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, created_at)
    VALUES ($1,'in','whatsapp',$2,$3,$4)`,
    [lead.id, body, wa_message_id, ts || new Date()]
  );
  await q('UPDATE leads SET wants_whatsapp = true, updated_at = now() WHERE id = $1', [lead.id]);
  console.log(`[WhatsApp] Message attached to verified lead ${lead.id}`);
  return lead;
} else if (rows.length > 0) {
  // Lead existed but is still pending - store in pending_messages
  await q(
    `INSERT INTO pending_messages (phone, body, channel, created_at)
    VALUES ($1, $2, 'whatsapp', $3)`,
    [phone, body, ts || new Date()]
  );
  console.log(`[WhatsApp] Message queued in pending_messages for phone ${phone}`);
  return lead;
} else {
  // New unknown number - queue message
  await q(
    `INSERT INTO pending_messages (phone, body, channel, created_at)
    VALUES ($1, $2, 'whatsapp', $3)`,
    [phone, body, ts || new Date()]
  );
  console.log(`[WhatsApp] Received message from unknown number ${phone} - queued until Meta verification`);
  return null;
}
}

onWebMessage(ingestIncoming);

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
  onlyExistingLeads: await getSetting('wa_only_existing_leads', false),
  adGreetingPatterns: await getSetting('wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS)
});
} catch (e) {
next(e);
}
});

whatsappRouter.patch('/settings', async (req, res, next) => {
try {
const { onlyExistingLeads, adGreetingPatterns } = req.body || {};
if (onlyExistingLeads !== undefined) await setSetting('wa_only_existing_leads', !!onlyExistingLeads);
if (Array.isArray(adGreetingPatterns)) {
  await setSetting('wa_ad_greeting_patterns', adGreetingPatterns.map((p) => String(p).trim()).filter(Boolean));
}
res.json({
  onlyExistingLeads: await getSetting('wa_only_existing_leads', false),
  adGreetingPatterns: await getSetting('wa_ad_greeting_patterns', DEFAULT_AD_GREETING_PATTERNS)
});
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
await ingestIncoming(msg);
}
} catch (e) {
console.error('Webhook processing failed:', e.message);
}
});
