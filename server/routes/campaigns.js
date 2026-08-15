import express from 'express';
import { q } from '../db.js';
import {
  listCampaigns,
  listAdSets,
  setStatus,
  setDailyBudget,
  renameObject,
  metaConfigured
} from '../services/meta.js';

export const campaignsRouter = express.Router();

campaignsRouter.get('/status', (req, res) => {
  res.json({
    connected: metaConfigured(),
    account: process.env.META_AD_ACCOUNT_ID || null,
    page: process.env.META_PAGE_ID || null
  });
});

/** Cached view — instant, served from Postgres. */
campaignsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM campaigns ORDER BY spend DESC, name ASC');
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/** Pull fresh numbers from Meta and upsert them. */
campaignsRouter.post('/sync', async (req, res, next) => {
  try {
    const campaigns = await listCampaigns();
    for (const c of campaigns) {
      await q(
        `INSERT INTO campaigns (id,name,objective,status,effective_status,daily_budget,lifetime_budget,
                                spend,impressions,clicks,leads_count,ctr,cpl,raw,synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, objective=EXCLUDED.objective, status=EXCLUDED.status,
           effective_status=EXCLUDED.effective_status, daily_budget=EXCLUDED.daily_budget,
           lifetime_budget=EXCLUDED.lifetime_budget, spend=EXCLUDED.spend,
           impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, leads_count=EXCLUDED.leads_count,
           ctr=EXCLUDED.ctr, cpl=EXCLUDED.cpl, raw=EXCLUDED.raw, synced_at=now()`,
        [
          c.id, c.name, c.objective, c.status, c.effective_status, c.daily_budget, c.lifetime_budget,
          c.spend, c.impressions, c.clicks, c.leads_count, c.ctr, c.cpl, JSON.stringify(c.raw)
        ]
      );
    }
    const { rows } = await q('SELECT * FROM campaigns ORDER BY spend DESC, name ASC');
    res.json({ synced: campaigns.length, campaigns: rows });
  } catch (e) {
    next(e);
  }
});

campaignsRouter.get('/:id/adsets', async (req, res, next) => {
  try {
    res.json(await listAdSets(req.params.id));
  } catch (e) {
    next(e);
  }
});

/** One endpoint for every inline edit the funnel UI makes. */
campaignsRouter.patch('/:id', async (req, res, next) => {
  try {
    const { status, daily_budget, name } = req.body || {};
    const changes = [];
    if (status) {
      await setStatus(req.params.id, status);
      await q('UPDATE campaigns SET status=$2, effective_status=$2 WHERE id=$1', [req.params.id, status]);
      changes.push(`status → ${status}`);
    }
    if (daily_budget != null) {
      await setDailyBudget(req.params.id, daily_budget);
      await q('UPDATE campaigns SET daily_budget=$2 WHERE id=$1', [req.params.id, daily_budget]);
      changes.push(`daily budget → ${daily_budget}`);
    }
    if (name) {
      await renameObject(req.params.id, name);
      await q('UPDATE campaigns SET name=$2 WHERE id=$1', [req.params.id, name]);
      changes.push(`renamed to ${name}`);
    }
    if (!changes.length) return res.status(400).json({ error: 'Nothing to change.' });
    res.json({ ok: true, changes });
  } catch (e) {
    next(e);
  }
});

/** Same edits, applied to an ad set instead of a campaign. */
campaignsRouter.patch('/adsets/:id', async (req, res, next) => {
  try {
    const { status, daily_budget, name } = req.body || {};
    if (status) await setStatus(req.params.id, status);
    if (daily_budget != null) await setDailyBudget(req.params.id, daily_budget);
    if (name) await renameObject(req.params.id, name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
