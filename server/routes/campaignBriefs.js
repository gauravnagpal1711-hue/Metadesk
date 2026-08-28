import express from 'express';
import { q } from '../db.js';

export const campaignBriefsRouter = express.Router();

/**
 * Campaign briefs. The app only assembles and stores these — it never calls
 * Meta. Claude Code reads a brief (creative embedded), creates the real
 * campaign/ad-set/creative/ad via its Meta Ads MCP tools, all PAUSED, then
 * PATCHes the meta_* ids and status back here.
 */

const CREATIVE_FIELDS =
  'id, kind, headline, primary_text, cta, label, cta_type, destination_type, destination_value, link_url, image_data, status';

/** A brief is "ready" to hand to Claude when it has a name, a budget, and a
 *  campaign-ready creative (approved + a destination). */
function computeStatus(brief, creative) {
  if (['created', 'live', 'archived'].includes(brief.status)) return brief.status;
  const creativeReady =
    creative && creative.status === 'approved' && creative.destination_type && creative.destination_value;
  return brief.name && brief.daily_budget && creativeReady ? 'ready' : 'draft';
}

campaignBriefsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT b.*, c.label AS creative_label, c.headline AS creative_headline,
              c.destination_type AS creative_destination_type, c.status AS creative_status
       FROM campaign_briefs b
       LEFT JOIN creatives c ON c.id = b.creative_id
       ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

campaignBriefsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM campaign_briefs WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Brief not found.' });
    const brief = rows[0];
    let creative = null;
    if (brief.creative_id) {
      const { rows: cr } = await q(`SELECT ${CREATIVE_FIELDS} FROM creatives WHERE id = $1`, [brief.creative_id]);
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
      const { rows: cr } = await q('SELECT status, destination_type, destination_value FROM creatives WHERE id = $1', [creative_id]);
      creative = cr[0] || null;
    }
    const draft = { name: String(name).trim(), daily_budget: daily_budget ?? null, status: 'draft' };
    const status = computeStatus(draft, creative);

    const { rows } = await q(
      `INSERT INTO campaign_briefs
         (name, objective, creative_id, daily_budget, audience, start_at, end_at, status, notes)
       VALUES ($1, COALESCE($2,'OUTCOME_LEADS'), $3, $4, COALESCE($5,'{}'::jsonb), $6, $7, $8, $9)
       RETURNING *`,
      [
        draft.name, objective || null, creative_id || null, daily_budget ?? null,
        audience !== undefined ? JSON.stringify(audience) : null,
        start_at || null, end_at || null, status, notes || null
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
    const { rows: existRows } = await q('SELECT * FROM campaign_briefs WHERE id = $1', [req.params.id]);
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

    // Explicit status wins (Claude Code sets 'created'/'live'); otherwise recompute.
    let status = b.status !== undefined ? b.status : existing.status;
    if (b.status === undefined && !['created', 'live', 'archived'].includes(existing.status)) {
      let creative = null;
      if (next_.creative_id) {
        const { rows: cr } = await q('SELECT status, destination_type, destination_value FROM creatives WHERE id = $1', [next_.creative_id]);
        creative = cr[0] || null;
      }
      status = computeStatus(next_, creative);
    }

    const { rows } = await q(
      `UPDATE campaign_briefs SET
         name = $2, objective = $3, creative_id = $4, daily_budget = $5,
         audience = $6, start_at = $7, end_at = $8, notes = $9, status = $10,
         meta_campaign_id = $11, meta_adset_id = $12, meta_creative_id = $13,
         meta_ad_id = $14, meta_image_hash = $15, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id, next_.name, next_.objective, next_.creative_id, next_.daily_budget,
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

campaignBriefsRouter.delete('/:id', async (req, res, next) => {
  try {
    await q('DELETE FROM campaign_briefs WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
