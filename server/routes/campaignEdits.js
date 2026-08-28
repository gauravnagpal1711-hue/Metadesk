import express from 'express';
import { q } from '../db.js';

export const campaignEditsRouter = express.Router();

/**
 * Queued changes to a live campaign — audience / schedule / creative swaps that
 * need ad-set-level work. (name / budget / pause-resume go straight through
 * PATCH /api/campaigns/:id.) Claude Code's MCP connector applies these and
 * PATCHes status='applied' back.
 */

campaignEditsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM campaign_edits ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

campaignEditsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM campaign_edits WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Edit not found.' });
    const edit = rows[0];
    let creative = null;
    if (edit.changes?.creative_id) {
      const { rows: cr } = await q(
        `SELECT id, headline, primary_text, cta, label, cta_type, destination_type, destination_value, link_url, image_data
         FROM creatives WHERE id = $1`,
        [edit.changes.creative_id]
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
      `INSERT INTO campaign_edits (meta_campaign_id, campaign_name, changes)
       VALUES ($1, $2, $3) RETURNING *`,
      [String(meta_campaign_id), campaign_name || null, JSON.stringify(changes)]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

campaignEditsRouter.patch('/:id', async (req, res, next) => {
  try {
    const { changes, status, notes } = req.body || {};
    const { rows: existing } = await q('SELECT * FROM campaign_edits WHERE id = $1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Edit not found.' });
    const cur = existing[0];
    const nextStatus = status !== undefined ? status : cur.status;
    const { rows } = await q(
      `UPDATE campaign_edits SET
         changes = $2,
         status = $3,
         notes = $4,
         applied_at = CASE WHEN $3 = 'applied' AND applied_at IS NULL THEN now() ELSE applied_at END
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
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
    await q('DELETE FROM campaign_edits WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
