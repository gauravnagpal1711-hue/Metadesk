import express from 'express';
import { q } from '../db.js';
import { listLeadForms, fetchFormLeads, flattenLead, normalisePhone, metaConfigured } from '../services/meta.js';
import { sendText, cloudConfigured } from '../services/whatsappCloud.js';
import { sendWebText, webStatus } from '../services/whatsappWeb.js';

export const leadsRouter = express.Router();

/* ---------- stages ---------- */

leadsRouter.get('/stages', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM stages ORDER BY position');
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

leadsRouter.post('/stages', async (req, res, next) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name the stage.' });
    const { rows: max } = await q('SELECT COALESCE(MAX(position),-1)+1 AS p FROM stages');
    const { rows } = await q(
      'INSERT INTO stages (name, position, color) VALUES ($1,$2,$3) RETURNING *',
      [name, max[0].p, color || '#5B6478']
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch('/stages/:id', async (req, res, next) => {
  try {
    const { name, color, position } = req.body || {};
    const { rows } = await q(
      `UPDATE stages SET name=COALESCE($2,name), color=COALESCE($3,color), position=COALESCE($4,position)
       WHERE id=$1 RETURNING *`,
      [req.params.id, name, color, position]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/stages/:id', async (req, res, next) => {
  try {
    await q('DELETE FROM stages WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- board ---------- */

/** Everything the funnel needs in one request: stages + leads + message counts. */
leadsRouter.get('/board', async (req, res, next) => {
  try {
    const { rows: stages } = await q('SELECT * FROM stages ORDER BY position');
    const { rows: leads } = await q(
      `SELECT l.*,
              (SELECT count(*)::int FROM messages m WHERE m.lead_id = l.id) AS message_count,
              (SELECT count(*)::int FROM remarks r WHERE r.lead_id = l.id) AS remark_count,
              (SELECT max(created_at) FROM messages m WHERE m.lead_id = l.id) AS last_message_at
       FROM leads l
       ORDER BY l.board_order ASC, l.created_at DESC`
    );
    res.json({ stages, leads });
  } catch (e) {
    next(e);
  }
});

leadsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM leads WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'That lead no longer exists.' });
    const { rows: messages } = await q(
      'SELECT * FROM messages WHERE lead_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    const { rows: remarks } = await q(
      'SELECT * FROM remarks WHERE lead_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    const { rows: activity } = await q(
      'SELECT * FROM activity WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.params.id]
    );
    res.json({ lead: rows[0], messages, remarks, activity });
  } catch (e) {
    next(e);
  }
});

leadsRouter.post('/', async (req, res, next) => {
  try {
    const { full_name, phone, email, city, stage_id, campaign_name, value } = req.body || {};
    const { rows: firstStage } = await q('SELECT id FROM stages ORDER BY position LIMIT 1');
    const { rows } = await q(
      `INSERT INTO leads (full_name, phone, email, city, stage_id, campaign_name, value, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING *`,
      [
        full_name || 'Unnamed lead',
        normalisePhone(phone),
        email || null,
        city || null,
        stage_id || firstStage[0]?.id,
        campaign_name || null,
        value || 0
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/** Drag and drop lands here: new stage, new order. */
leadsRouter.patch('/:id/move', async (req, res, next) => {
  try {
    const { stage_id, board_order } = req.body || {};
    const { rows } = await q(
      'UPDATE leads SET stage_id=$2, board_order=COALESCE($3, board_order), updated_at=now() WHERE id=$1 RETURNING *',
      [req.params.id, stage_id, board_order]
    );
    const { rows: stage } = await q('SELECT name FROM stages WHERE id=$1', [stage_id]);
    await q('INSERT INTO activity (lead_id, kind, detail) VALUES ($1,$2,$3)', [
      req.params.id,
      'stage_change',
      `Moved to ${stage[0]?.name || 'a new stage'}`
    ]);
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch('/:id', async (req, res, next) => {
  try {
    const { full_name, phone, email, city, value, wants_whatsapp, campaign_name } = req.body || {};
    const { rows } = await q(
      `UPDATE leads SET
         full_name=COALESCE($2,full_name), phone=COALESCE($3,phone), email=COALESCE($4,email),
         city=COALESCE($5,city), value=COALESCE($6,value),
         wants_whatsapp=COALESCE($7,wants_whatsapp), campaign_name=COALESCE($8,campaign_name),
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [req.params.id, full_name, normalisePhone(phone), email, city, value, wants_whatsapp, campaign_name]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/:id', async (req, res, next) => {
  try {
    await q('DELETE FROM leads WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- remarks + conversation ---------- */

leadsRouter.post('/:id/remarks', async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'Write a remark first.' });
    const { rows } = await q(
      'INSERT INTO remarks (lead_id, body) VALUES ($1,$2) RETURNING *',
      [req.params.id, body]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/:id/remarks/:remarkId', async (req, res, next) => {
  try {
    await q('DELETE FROM remarks WHERE id=$1 AND lead_id=$2', [req.params.remarkId, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Send a WhatsApp message and log it on the lead's trail. */
leadsRouter.post('/:id/messages', async (req, res, next) => {
  try {
    const { body, channel } = req.body || {};
    if (!body) return res.status(400).json({ error: 'Type a message first.' });
    const { rows: leadRows } = await q('SELECT * FROM leads WHERE id=$1', [req.params.id]);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'That lead no longer exists.' });
    if (!lead.phone) return res.status(400).json({ error: 'Add a phone number to this lead first.' });

    const route = channel || (webStatus().status === 'connected' ? 'web' : 'cloud');
    let sent = { id: null };
    if (route === 'web') sent = await sendWebText(lead.phone, body);
    else if (cloudConfigured()) sent = await sendText(lead.phone, body);
    else return res.status(400).json({ error: 'Connect WhatsApp on the Connect tab first.' });

    const { rows } = await q(
      `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id)
       VALUES ($1,'out','whatsapp',$2,$3) RETURNING *`,
      [req.params.id, body, sent.id]
    );
    await q('UPDATE leads SET updated_at=now(), wants_whatsapp=true WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/* ---------- Meta lead sync ---------- */

leadsRouter.get('/meta/forms', async (req, res, next) => {
  try {
    if (!metaConfigured()) return res.json([]);
    res.json(await listLeadForms());
  } catch (e) {
    next(e);
  }
});

/** Pull new leads from every lead form on the page into the first stage. */
leadsRouter.post('/meta/sync', async (req, res, next) => {
  try {
    if (!metaConfigured()) return res.status(400).json({ error: 'Connect your Meta account first.' });
    const forms = await listLeadForms();
    const { rows: firstStage } = await q('SELECT id FROM stages ORDER BY position LIMIT 1');
    const stageId = firstStage[0]?.id;
    let imported = 0;

    for (const form of forms) {
      const leads = await fetchFormLeads(form.id);
      for (const raw of leads) {
        const flat = flattenLead(raw);
        const wantsWhatsApp = JSON.stringify(flat.fields).toLowerCase().includes('whatsapp');
        const { rowCount } = await q(
          `INSERT INTO leads (meta_lead_id, form_id, campaign_id, campaign_name, full_name, phone, email, city,
                              source, wants_whatsapp, stage_id, fields, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'meta',$9,$10,$11,$12)
           ON CONFLICT (meta_lead_id) DO NOTHING`,
          [
            raw.id, raw.form_id || form.id, raw.campaign_id || null, raw.campaign_name || form.name,
            flat.full_name, flat.phone, flat.email, flat.city,
            wantsWhatsApp, stageId, JSON.stringify(flat.fields), raw.created_time || new Date()
          ]
        );
        imported += rowCount;
      }
    }
    res.json({ imported, forms: forms.length });
  } catch (e) {
    next(e);
  }
});
