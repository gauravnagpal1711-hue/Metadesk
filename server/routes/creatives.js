import express from 'express';
import { q } from '../db.js';
import { generateImage, generateCopy, imageProvider, copyProvider } from '../services/ai.js';
import { syncBriefForCreative } from './campaignBriefs.js';

export const creativesRouter = express.Router();

creativesRouter.get('/providers', (req, res) => {
  res.json({ image: imageProvider(), copy: copyProvider() });
});

creativesRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      'SELECT * FROM creatives WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/** Write headline / primary text / CTA and a stronger image prompt. */
creativesRouter.post('/copy', async (req, res, next) => {
  try {
    const { brief, offer, audience, language } = req.body || {};
    if (!brief) return res.status(400).json({ error: 'Describe what you are advertising.' });
    res.json(await generateCopy(brief, { offer, audience, language }));
  } catch (e) {
    next(e);
  }
});

/** Generate an image and store it as a draft creative. */
creativesRouter.post('/image', async (req, res, next) => {
  try {
    const { prompt, size, referenceImage, headline, primary_text, cta } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Write a prompt first.' });
    const { provider, dataUrl } = await generateImage(prompt, { size, referenceImage });
    const { rows } = await q(
      `INSERT INTO creatives (kind, prompt, headline, primary_text, cta, provider, image_data, user_id)
       VALUES ('image',$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [prompt, headline || null, primary_text || null, cta || null, provider, dataUrl, req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/** Save artwork you generated elsewhere (ChatGPT, Canva, a designer). */
creativesRouter.post('/upload', async (req, res, next) => {
  try {
    const { imageData, prompt, headline, primary_text, cta } = req.body || {};
    if (!imageData) return res.status(400).json({ error: 'Choose an image file first.' });
    const { rows } = await q(
      `INSERT INTO creatives (kind, prompt, headline, primary_text, cta, provider, image_data, user_id)
       VALUES ('image',$1,$2,$3,$4,'manual',$5,$6) RETURNING *`,
      [prompt || 'Uploaded artwork', headline || null, primary_text || null, cta || null, imageData, req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

creativesRouter.patch('/:id', async (req, res, next) => {
  try {
    const {
      status, headline, primary_text, cta, label, cta_type,
      destination_type, destination_value, link_url, campaign_defaults
    } = req.body || {};
    const { rows } = await q(
      `UPDATE creatives SET
         status = COALESCE($3, status),
         headline = COALESCE($4, headline),
         primary_text = COALESCE($5, primary_text),
         cta = COALESCE($6, cta),
         label = COALESCE($7, label),
         cta_type = COALESCE($8, cta_type),
         destination_type = COALESCE($9, destination_type),
         destination_value = COALESCE($10, destination_value),
         link_url = COALESCE($11, link_url),
         campaign_defaults = COALESCE($12::jsonb, campaign_defaults)
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        req.params.id, req.user.id, status, headline, primary_text, cta, label, cta_type,
        destination_type, destination_value, link_url,
        campaign_defaults !== undefined ? JSON.stringify(campaign_defaults) : null
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'That creative no longer exists.' });
    // Keep this creative's campaign brief in step (created / updated / left alone).
    const brief = await syncBriefForCreative(req.user.id, rows[0].id).catch(() => null);
    res.json({ ...rows[0], brief });
  } catch (e) {
    next(e);
  }
});

creativesRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM creatives WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'That creative no longer exists.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
