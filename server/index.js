import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

import { initDb, q } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { creativesRouter } from './routes/creatives.js';
import { campaignsRouter } from './routes/campaigns.js';
import { leadsRouter } from './routes/leads.js';
import { campaignBriefsRouter } from './routes/campaignBriefs.js';
import { campaignEditsRouter } from './routes/campaignEdits.js';
import { metaTargetingRouter } from './routes/metaTargeting.js';
import { whatsappRouter } from './routes/whatsapp.js';
import { reachUsRouter } from './routes/reachUs.js';
import { facebookRouter, restoreConnection } from './routes/facebook.js';
import { listCampaigns, listLeadForms, fetchFormLeads, flattenLead, normalisePhone, metaConfigured, getConnection } from './services/meta.js';
import { startWeb } from './services/whatsappWeb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
}

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', authRouter);

// The OAuth callback must be reachable without the app cookie (Facebook redirects to it).
// Everything else under /api/facebook still requires the app login.
app.use('/api/facebook', (req, res, next) => {
  if (req.path.startsWith('/callback')) return next();
  return requireAuth(req, res, next);
}, facebookRouter);

app.use('/api', requireAuth);
app.use('/api/creatives', creativesRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/campaign-briefs', campaignBriefsRouter);
app.use('/api/campaign-edits', campaignEditsRouter);
app.use('/api/meta', metaTargetingRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/reach-us', reachUsRouter);

// Serve the built React app for every non-API route.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => (err ? next() : null));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Something went wrong on the server.' });
});

/* ---------- background sync ---------- */

async function syncEverything() {
  if (!metaConfigured()) return;
  try {
    const campaigns = await listCampaigns();
    for (const c of campaigns) {
      await q(
        `INSERT INTO campaigns (id,name,objective,status,effective_status,daily_budget,lifetime_budget,
        spend,impressions,clicks,leads_count,ctr,cpl,raw,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
        ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name, status=EXCLUDED.status, effective_status=EXCLUDED.effective_status,
        daily_budget=EXCLUDED.daily_budget, spend=EXCLUDED.spend, impressions=EXCLUDED.impressions,
        clicks=EXCLUDED.clicks, leads_count=EXCLUDED.leads_count, ctr=EXCLUDED.ctr, cpl=EXCLUDED.cpl,
        raw=EXCLUDED.raw, synced_at=now()`,
        [c.id, c.name, c.objective, c.status, c.effective_status, c.daily_budget, c.lifetime_budget,
        c.spend, c.impressions, c.clicks, c.leads_count, c.ctr, c.cpl, JSON.stringify(c.raw)]
      );
    }
  } catch (e) {
    console.error('Campaign sync failed:', e.message);
  }

  // The page can come from META_PAGE_ID (old manual setup) or, more commonly now,
  // from the Facebook OAuth connection saved in the database.
  const pageId = process.env.META_PAGE_ID || getConnection().pageId;
  if (!pageId) return;
  try {
    const forms = await listLeadForms(pageId);
    const { rows: firstStage } = await q('SELECT id FROM stages ORDER BY position LIMIT 1');
    for (const form of forms) {
      const leads = await fetchFormLeads(form.id);
      for (const raw of leads) {
        const flat = flattenLead(raw);
        const wantsWhatsApp = JSON.stringify(flat.fields).toLowerCase().includes('whatsapp');
        const normalizedPhone = normalisePhone(flat.phone);
        
        // Insert or update the lead as Meta-verified
        await q(
          `INSERT INTO leads (meta_lead_id, form_id, campaign_id, campaign_name, full_name, phone, email, city,
          source, wants_whatsapp, is_meta_verified, stage_id, fields, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'meta',$9,true,$10,$11,$12)
          ON CONFLICT (meta_lead_id) DO UPDATE SET
            is_meta_verified = true,
            wants_whatsapp = EXCLUDED.wants_whatsapp,
            fields = EXCLUDED.fields,
            updated_at = now()`,
          [raw.id, raw.form_id || form.id, raw.campaign_id || null, raw.campaign_name || form.name,
          flat.full_name, normalizedPhone, flat.email, flat.city, wantsWhatsApp,
          firstStage[0]?.id, JSON.stringify(flat.fields), raw.created_time || new Date()]
        );

        // Upgrade any pending WhatsApp leads with the same phone to Meta-verified
        const { rows: upgradedLeads } = await q(
          `UPDATE leads 
           SET is_meta_verified = true, meta_lead_id = $1, source = 'meta', updated_at = now()
           WHERE phone = $2 AND source = 'whatsapp' AND is_meta_verified = false
           RETURNING id`,
          [raw.id, normalizedPhone]
        );

        // Attach pending messages to this lead
        if (upgradedLeads.length > 0) {
          const leadId = upgradedLeads[0].id;
          const { rows: pendingMsgs } = await q(
            `SELECT * FROM pending_messages WHERE phone = $1 ORDER BY created_at ASC`,
            [normalizedPhone]
          );

          for (const msg of pendingMsgs) {
            await q(
              `INSERT INTO messages (lead_id, direction, channel, body, created_at)
              VALUES ($1, 'in', $2, $3, $4)`,
              [leadId, msg.channel, msg.body, msg.created_at]
            );
          }

          // Clean up pending messages
          await q(`DELETE FROM pending_messages WHERE phone = $1`, [normalizedPhone]);
          console.log(`[Meta Sync] Upgraded pending lead for ${normalizedPhone} - attached ${pendingMsgs.length} queued messages`);
        }
      }
    }
  } catch (e) {
    console.error('Lead sync failed:', e.message);
  }
}

const SYNC_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 10);

initDb()
  .then(async () => {
    // Reload any Facebook connection saved from a previous OAuth login.
    await restoreConnection().catch((e) => console.error('Restore connection failed:', e.message));

    app.listen(PORT, () => console.log(`Meta Ads Manager listening on ${PORT}`));

    // Run the loop always; syncEverything() no-ops until Meta is connected,
    // so a connection made later (via Facebook login) starts syncing on its own.
    syncEverything();
    setInterval(syncEverything, SYNC_MINUTES * 60 * 1000);

    if (process.env.WA_WEB_AUTOSTART === 'true') {
      startWeb().catch((e) => console.error('WhatsApp Web autostart failed:', e.message));
    }
  })
  .catch((err) => {
    console.error('Database init failed:', err.message);
    process.exit(1);
  });
