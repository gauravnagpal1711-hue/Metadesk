import express from 'express';
import { q } from '../db.js';
import { generateImage, generateCopy, imageProvider, copyProvider } from '../services/ai.js';

export const creativesRouter = express.Router();

creativesRouter.get('/providers', (req, res) => {
  res.json({ image: imageProvider(), copy: copyProvider() });
});

creativesRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM creatives ORDER BY created_at DESC LIMIT 200');
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
      `INSERT INTO creatives (kind, prompt, headline, primary_text, cta, provider, image_data)
       VALUES ('image',$1,$2,$3,$4,$5,$6) RETURNING *`,
      [prompt, headline || null, primary_text || null, cta || null, provider, dataUrl]
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
      `INSERT INTO creatives (kind, prompt, headline, primary_text, cta, provider, image_data)
       VALUES ('image',$1,$2,$3,$4,'manual',$5) RETURNING *`,
      [prompt || 'Uploaded artwork', headline || null, primary_text || null, cta || null, imageData]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

creativesRouter.patch('/:id', async (req, res, next) => {
  try {
    const { status, headline, primary_text, cta, label, cta_type, destination_type, destination_value, link_url } = req.body || {};
    const { rows } = await q(
      `UPDATE creatives SET
         status = COALESCE($2, status),
         headline = COALESCE($3, headline),
         primary_text = COALESCE($4, primary_text),
         cta = COALESCE($5, cta),
         label = COALESCE($6, label),
         cta_type = COALESCE($7, cta_type),
         destination_type = COALESCE($8, destination_type),
         destination_value = COALESCE($9, destination_value),
         link_url = COALESCE($10, link_url)
       WHERE id = $1 RETURNING *`,
      [req.params.id, status, headline, primary_text, cta, label, cta_type, destination_type, destination_value, link_url]
    );
    if (!rows.length) return res.status(404).json({ error: 'That creative no longer exists.' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

creativesRouter.delete('/:id', async (req, res, next) => {
  try {
    await q('DELETE FROM creatives WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
