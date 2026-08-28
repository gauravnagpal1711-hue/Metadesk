import express from 'express';
import { q } from '../db.js';
import {
  loadConnection,
  connConfigured,
  listCampaigns,
  listAdSets,
  setStatus,
  setDailyBudget,
  renameObject
} from '../services/meta.js';

export const campaignsRouter = express.Router();

campaignsRouter.get('/status', async (req, res, next) => {
  try {
    const conn = await loadConnection(req.user.id);
    res.json({ connected: connConfigured(conn), account: conn.adAccountId || null, page: conn.pageId || null });
  } catch (e) {
    next(e);
  }
});

/** Cached view — instant, served from Postgres, this user's campaigns only. */
campaignsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      'SELECT * FROM campaigns WHERE user_id = $1 ORDER BY spend DESC, name ASC',
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/** Pull fresh numbers from Meta and upsert them into this user's workspace. */
campaignsRouter.post('/sync', async (req, res, next) => {
  try {
    const conn = await loadConnection(req.user.id);
    if (!connConfigured(conn)) return res.status(400).json({ error: 'Connect your Meta account first (Facebook tab).' });
    const campaigns = await listCampaigns(conn);
    for (const c of campaigns) {
      await q(
        `INSERT INTO campaigns (id,user_id,name,objective,status,effective_status,daily_budget,lifetime_budget,
                                spend,impressions,clicks,leads_count,ctr,cpl,raw,synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
         ON CONFLICT (id) DO UPDATE SET
           user_id=EXCLUDED.user_id,
           name=EXCLUDED.name, objective=EXCLUDED.objective, status=EXCLUDED.status,
           effective_status=EXCLUDED.effective_status, daily_budget=EXCLUDED.daily_budget,
           lifetime_budget=EXCLUDED.lifetime_budget, spend=EXCLUDED.spend,
           impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, leads_count=EXCLUDED.leads_count,
           ctr=EXCLUDED.ctr, cpl=EXCLUDED.cpl, raw=EXCLUDED.raw, synced_at=now()`,
        [
          c.id, req.user.id, c.name, c.objective, c.status, c.effective_status, c.daily_budget, c.lifetime_budget,
          c.spend, c.impressions, c.clicks, c.leads_count, c.ctr, c.cpl, JSON.stringify(c.raw)
        ]
      );
    }
    const { rows } = await q(
      'SELECT * FROM campaigns WHERE user_id = $1 ORDER BY spend DESC, name ASC',
      [req.user.id]
    );
    res.json({ synced: campaigns.length, campaigns: rows });
  } catch (e) {
    next(e);
  }
});

campaignsRouter.get('/:id/adsets', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT 1 FROM campaigns WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Campaign not found.' });
    const conn = await loadConnection(req.user.id);
    res.json(await listAdSets(conn, req.params.id));
  } catch (e) {
    next(e);
  }
});

/** One endpoint for every inline edit the funnel UI makes. */
campaignsRouter.patch('/:id', async (req, res, next) => {
  try {
    const owned = await q('SELECT 1 FROM campaigns WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!owned.rows.length) return res.status(404).json({ error: 'Campaign not found.' });
    const conn = await loadConnection(req.user.id);

    const { status, daily_budget, name } = req.body || {};
    const changes = [];
    if (status) {
      await setStatus(conn, req.params.id, status);
      await q('UPDATE campaigns SET status=$2, effective_status=$2 WHERE id=$1 AND user_id=$3', [req.params.id, status, req.user.id]);
      changes.push(`status → ${status}`);
    }
    if (daily_budget != null) {
      await setDailyBudget(conn, req.params.id, daily_budget);
      await q('UPDATE campaigns SET daily_budget=$2 WHERE id=$1 AND user_id=$3', [req.params.id, daily_budget, req.user.id]);
      changes.push(`daily budget → ${daily_budget}`);
    }
    if (name) {
      await renameObject(conn, req.params.id, name);
      await q('UPDATE campaigns SET name=$2 WHERE id=$1 AND user_id=$3', [req.params.id, name, req.user.id]);
      changes.push(`renamed to ${name}`);
    }
    if (!changes.length) return res.status(400).json({ error: 'Nothing to change.' });
    res.json({ ok: true, changes });
  } catch (e) {
    next(e);
  }
});

/** Same edits, applied to an ad set. The ad set's campaign must belong to the user. */
campaignsRouter.patch('/adsets/:id', async (req, res, next) => {
  try {
    const conn = await loadConnection(req.user.id);
    if (!connConfigured(conn)) return res.status(400).json({ error: 'Connect your Meta account first.' });
    const { status, daily_budget, name } = req.body || {};
    if (status) await setStatus(conn, req.params.id, status);
    if (daily_budget != null) await setDailyBudget(conn, req.params.id, daily_budget);
    if (name) await renameObject(conn, req.params.id, name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
