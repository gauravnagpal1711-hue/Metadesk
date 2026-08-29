import express from 'express';
import { q } from '../db.js';
import {
  loadConnection, connConfigured, buildTargeting,
  createCampaign, createAdSet, uploadAdImage, createCreative, createAd, deleteObject
} from '../services/meta.js';

export const campaignBriefsRouter = express.Router();

/**
 * Campaign briefs. The app only assembles and stores these — it never calls
 * Meta. Claude Code reads a brief (creative embedded), creates the real
 * campaign/ad-set/creative/ad via its Meta Ads MCP tools, all PAUSED, then
 * PATCHes the meta_* ids and status back here. Every row belongs to one user.
 */

const CREATIVE_FIELDS =
  'id, kind, headline, primary_text, cta, label, cta_type, destination_type, destination_value, link_url, image_data, status, campaign_defaults';

// Once the user has pressed "Set campaign" (queued), Claude has asked a question
// (info_needed) or built it on Meta (created/live), the app stops recomputing
// the brief's status — only an explicit status change moves it from here.
const LOCKED_STATUSES = ['queued', 'info_needed', 'created', 'live', 'archived'];

/** A brief is "ready" to hand to Claude when it has a name, a budget, and a
 *  campaign-ready creative (approved + a destination). */
function computeStatus(brief, creative) {
  if (LOCKED_STATUSES.includes(brief.status)) return brief.status;
  const creativeReady =
    creative && creative.status === 'approved' && creative.destination_type && creative.destination_value;
  return brief.name && brief.daily_budget && creativeReady ? 'ready' : 'draft';
}

/** Does the saved audience name a place to advertise? */
function hasLocation(audience) {
  if (!audience || typeof audience !== 'object') return false;
  if (audience.location_mode === 'cities') return Array.isArray(audience.locations) && audience.locations.length > 0;
  return !!audience.radius_center;
}

/**
 * Keep exactly one brief per creative in step with that creative's state, within
 * one user's workspace. A brief the user or Claude has already pushed further
 * (queued / created / live / archived) is left untouched. Returns the brief (or
 * null if the creative isn't campaign-bound yet).
 */
export async function syncBriefForCreative(userId, creativeId) {
  if (!userId || !creativeId) return null;
  const { rows: cr } = await q(
    `SELECT id, label, headline, status, destination_type, destination_value, campaign_defaults
       FROM creatives WHERE id = $1 AND user_id = $2`,
    [creativeId, userId]
  );
  const creative = cr[0];
  if (!creative) return null;

  const { rows: br } = await q(
    'SELECT * FROM campaign_briefs WHERE creative_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1',
    [creativeId, userId]
  );
  const brief = br[0] || null;
  if (brief && LOCKED_STATUSES.includes(brief.status)) return brief;

  const campaignBound =
    creative.status === 'approved' && creative.destination_type && creative.destination_value;

  if (!campaignBound) {
    if (brief && brief.status === 'ready') {
      const { rows } = await q(
        "UPDATE campaign_briefs SET status = 'draft', updated_at = now() WHERE id = $1 RETURNING *",
        [brief.id]
      );
      return rows[0];
    }
    return brief;
  }

  const d = creative.campaign_defaults || {};
  const name =
    (d.name && String(d.name).trim()) || creative.label || creative.headline || `Creative ${creative.id}`;
  const daily_budget = d.daily_budget != null ? d.daily_budget : brief ? brief.daily_budget : null;
  const audience = d.audience || (brief && brief.audience) || {};
  const start_at = d.start_at !== undefined ? d.start_at : brief ? brief.start_at : null;
  const end_at = d.end_at !== undefined ? d.end_at : brief ? brief.end_at : null;
  const status = daily_budget && hasLocation(audience) ? 'ready' : 'draft';

  if (brief) {
    const { rows } = await q(
      `UPDATE campaign_briefs SET
         name = $2, daily_budget = $3, audience = $4, start_at = $5, end_at = $6,
         status = $7, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [brief.id, name, daily_budget, JSON.stringify(audience), start_at, end_at, status]
    );
    return rows[0];
  }
  const { rows } = await q(
    `INSERT INTO campaign_briefs (name, creative_id, daily_budget, audience, start_at, end_at, status, user_id)
     VALUES ($1, $2, $3, COALESCE($4, '{}'::jsonb), $5, $6, $7, $8) RETURNING *`,
    [name, creativeId, daily_budget, JSON.stringify(audience), start_at, end_at, status, userId]
  );
  return rows[0];
}

campaignBriefsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT b.*, c.label AS creative_label, c.headline AS creative_headline,
              c.destination_type AS creative_destination_type, c.status AS creative_status
       FROM campaign_briefs b
       LEFT JOIN creatives c ON c.id = b.creative_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

campaignBriefsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM campaign_briefs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Brief not found.' });
    const brief = rows[0];
    let creative = null;
    if (brief.creative_id) {
      const { rows: cr } = await q(
        `SELECT ${CREATIVE_FIELDS} FROM creatives WHERE id = $1 AND user_id = $2`,
        [brief.creative_id, req.user.id]
      );
      creative = cr[0] || null;
    }
    res.json({ ...brief, creative });
  } catch (e) {
    next(e);
  }
});

campaignBriefsRouter.post('/', async (req, res, next) => {
  try {
    const { name, objective, creative_id, daily_budget, audience, start_at, end_at, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name the campaign.' });

    let creative = null;
    if (creative_id) {
      const { rows: cr } = await q(
        'SELECT status, destination_type, destination_value FROM creatives WHERE id = $1 AND user_id = $2',
        [creative_id, req.user.id]
      );
      creative = cr[0] || null;
    }
    const draft = { name: String(name).trim(), daily_budget: daily_budget ?? null, status: 'draft' };
    const status = computeStatus(draft, creative);

    const { rows } = await q(
      `INSERT INTO campaign_briefs
         (name, objective, creative_id, daily_budget, audience, start_at, end_at, status, notes, user_id)
       VALUES ($1, COALESCE($2,'OUTCOME_LEADS'), $3, $4, COALESCE($5,'{}'::jsonb), $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        draft.name, objective || null, creative_id || null, daily_budget ?? null,
        audience !== undefined ? JSON.stringify(audience) : null,
        start_at || null, end_at || null, status, notes || null, req.user.id
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

campaignBriefsRouter.patch('/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: existRows } = await q('SELECT * FROM campaign_briefs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!existRows.length) return res.status(404).json({ error: 'Brief not found.' });
    const existing = existRows[0];

    const next_ = {
      name: b.name !== undefined ? String(b.name).trim() : existing.name,
      objective: b.objective !== undefined ? b.objective : existing.objective,
      creative_id: b.creative_id !== undefined ? b.creative_id : existing.creative_id,
      daily_budget: b.daily_budget !== undefined ? b.daily_budget : existing.daily_budget,
      audience: b.audience !== undefined ? b.audience : existing.audience,
      start_at: b.start_at !== undefined ? b.start_at : existing.start_at,
      end_at: b.end_at !== undefined ? b.end_at : existing.end_at,
      notes: b.notes !== undefined ? b.notes : existing.notes,
      meta_campaign_id: b.meta_campaign_id !== undefined ? b.meta_campaign_id : existing.meta_campaign_id,
      meta_adset_id: b.meta_adset_id !== undefined ? b.meta_adset_id : existing.meta_adset_id,
      meta_creative_id: b.meta_creative_id !== undefined ? b.meta_creative_id : existing.meta_creative_id,
      meta_ad_id: b.meta_ad_id !== undefined ? b.meta_ad_id : existing.meta_ad_id,
      meta_image_hash: b.meta_image_hash !== undefined ? b.meta_image_hash : existing.meta_image_hash
    };

    // Explicit status wins (the app sets 'queued'; Claude sets 'created'/'live'); otherwise recompute.
    let status = b.status !== undefined ? b.status : existing.status;
    if (b.status === undefined && !LOCKED_STATUSES.includes(existing.status)) {
      let creative = null;
      if (next_.creative_id) {
        const { rows: cr } = await q(
          'SELECT status, destination_type, destination_value FROM creatives WHERE id = $1 AND user_id = $2',
          [next_.creative_id, req.user.id]
        );
        creative = cr[0] || null;
      }
      status = computeStatus(next_, creative);
    }

    const { rows } = await q(
      `UPDATE campaign_briefs SET
         name = $3, objective = $4, creative_id = $5, daily_budget = $6,
         audience = $7, start_at = $8, end_at = $9, notes = $10, status = $11,
         meta_campaign_id = $12, meta_adset_id = $13, meta_creative_id = $14,
         meta_ad_id = $15, meta_image_hash = $16, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        req.params.id, req.user.id, next_.name, next_.objective, next_.creative_id, next_.daily_budget,
        JSON.stringify(next_.audience || {}), next_.start_at, next_.end_at, next_.notes, status,
        next_.meta_campaign_id, next_.meta_adset_id, next_.meta_creative_id,
        next_.meta_ad_id, next_.meta_image_hash
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/**
 * Actually build the brief on Meta — campaign + ad set + creative + ad, all
 * PAUSED — and record the ids. Nothing here ever goes ACTIVE; the user does that
 * with "Start campaign" (PATCH /campaigns/:id { status: 'ACTIVE' }). On any Meta
 * error the half-built campaign is deleted and the brief is left 'info_needed'.
 */
campaignBriefsRouter.post('/:id/launch', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { rows } = await q('SELECT * FROM campaign_briefs WHERE id = $1 AND user_id = $2', [req.params.id, uid]);
    const brief = rows[0];
    if (!brief) return res.status(404).json({ error: 'Brief not found.' });
    if (brief.meta_campaign_id) return res.status(400).json({ error: 'This brief is already on Meta.' });
    if (!brief.creative_id) return res.status(400).json({ error: 'This brief has no creative.' });
    if (!brief.daily_budget) return res.status(400).json({ error: 'Set a daily budget before launching.' });

    const { rows: cr } = await q(
      `SELECT ${CREATIVE_FIELDS} FROM creatives WHERE id = $1 AND user_id = $2`,
      [brief.creative_id, uid]
    );
    const creative = cr[0];
    if (!creative) return res.status(400).json({ error: 'The brief\'s creative no longer exists.' });
    if (creative.status !== 'approved') return res.status(400).json({ error: 'The creative is not approved yet.' });
    if (creative.destination_type !== 'whatsapp' || !creative.destination_value) {
      return res.status(400).json({ error: 'This launcher only handles click-to-WhatsApp creatives for now.' });
    }

    const conn = await loadConnection(uid);
    if (!connConfigured(conn)) return res.status(400).json({ error: 'Meta is not connected — open the Facebook tab.' });
    if (!conn.pageId) return res.status(400).json({ error: 'No Facebook page selected on the Facebook tab.' });

    const audience = brief.audience || {};
    const targeting = buildTargeting(audience);
    const waNumber = String(creative.destination_value).replace(/\D/g, '');

    let campaignId, adsetId, imageHash, creativeId, adId;
    let step = 'campaign';
    try {
      ({ id: campaignId } = await createCampaign(conn, { name: brief.name, objective: brief.objective }));
      step = 'ad set';
      ({ id: adsetId } = await createAdSet(conn, {
        name: `${brief.name} — ad set`,
        campaignId,
        dailyBudgetRupees: brief.daily_budget,
        optimizationGoal: audience.advanced?.optimization_goal,
        bidCapRupees: audience.advanced?.bid_cap_rupees,
        pageId: conn.pageId,
        targeting,
        startAt: brief.start_at,
        endAt: brief.end_at
      }));
      step = 'image upload';
      imageHash = await uploadAdImage(conn, creative.image_data);
      step = 'creative';
      ({ id: creativeId } = await createCreative(conn, {
        name: `${brief.name} — creative`,
        pageId: conn.pageId,
        message: creative.primary_text || creative.headline || '',
        imageHash,
        waNumber
      }));
      step = 'ad';
      ({ id: adId } = await createAd(conn, { name: `${brief.name} — ad`, adsetId, creativeId }));
    } catch (metaErr) {
      console.error(
        `[brief ${brief.id} launch] failed at "${step}":`,
        JSON.stringify(metaErr.metaError || { message: metaErr.message })
      );
      if (campaignId) await deleteObject(conn, campaignId).catch(() => {});
      const note = `Meta rejected the launch at "${step}": ${metaErr.message}`;
      await q(
        "UPDATE campaign_briefs SET status = 'info_needed', notes = $2, updated_at = now() WHERE id = $1",
        [brief.id, note]
      );
      return res.status(502).json({ error: note });
    }

    const { rows: upd } = await q(
      `UPDATE campaign_briefs SET
         meta_campaign_id = $2, meta_adset_id = $3, meta_creative_id = $4,
         meta_ad_id = $5, meta_image_hash = $6, status = 'created', updated_at = now()
       WHERE id = $1 AND user_id = $7 RETURNING *`,
      [brief.id, campaignId, adsetId, creativeId, adId, imageHash, uid]
    );
    res.json(upd[0]);
  } catch (e) {
    next(e);
  }
});

campaignBriefsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM campaign_briefs WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Brief not found.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
