import express from 'express';
import { q } from '../db.js';

export const campaignEditsRouter = express.Router();

/**
 * Queued changes to a live campaign — audience / schedule / creative swaps that
 * need ad-set-level work. (name / budget / pause-resume go straight through
 * PATCH /api/campaigns/:id.) Claude Code's MCP connector applies these and
 * PATCHes status='applied' back. Every row belongs to one user.
 */

campaignEditsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM campaign_edits WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

campaignEditsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM campaign_edits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Edit not found.' });
    const edit = rows[0];
    let creative = null;
    if (edit.changes?.creative_id) {
      const { rows: cr } = await q(
        `SELECT id, headline, primary_text, cta, label, cta_type, destination_type, destination_value, link_url, image_data
         FROM creatives WHERE id = $1 AND user_id = $2`,
        [edit.changes.creative_id, req.user.id]
      );
      creative = cr[0] || null;
    }
    res.json({ ...edit, creative });
  } catch (e) {
    next(e);
  }
});

campaignEditsRouter.post('/', async (req, res, next) => {
  try {
    const { meta_campaign_id, campaign_name, changes } = req.body || {};
    if (!meta_campaign_id) return res.status(400).json({ error: 'meta_campaign_id is required.' });
    if (!changes || !Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to change.' });
    const { rows } = await q(
      `INSERT INTO campaign_edits (meta_campaign_id, campaign_name, changes, user_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [String(meta_campaign_id), campaign_name || null, JSON.stringify(changes), req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

campaignEditsRouter.patch('/:id', async (req, res, next) => {
  try {
    const { changes, status, notes } = req.body || {};
    const { rows: existing } = await q('SELECT * FROM campaign_edits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!existing.length) return res.status(404).json({ error: 'Edit not found.' });
    const cur = existing[0];
    const nextStatus = status !== undefined ? status : cur.status;
    const { rows } = await q(
      `UPDATE campaign_edits SET
         changes = $3,
         status = $4,
         notes = $5,
         applied_at = CASE WHEN $4 = 'applied' AND applied_at IS NULL THEN now() ELSE applied_at END
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        req.params.id,
        req.user.id,
        changes !== undefined ? JSON.stringify(changes) : JSON.stringify(cur.changes || {}),
        nextStatus,
        notes !== undefined ? notes : cur.notes
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

campaignEditsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM campaign_edits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Edit not found.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
