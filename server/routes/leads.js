import express from 'express';
import { q } from '../db.js';
import { listLeadForms, fetchFormLeads, flattenLead, normalisePhone, metaConfigured } from '../services/meta.js';
import { sendText, sendMedia, cloudConfigured } from '../services/whatsappCloud.js';
import { sendWebText, sendWebMedia, webStatus } from '../services/whatsappWeb.js';

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

/** Everything the funnel needs in one request: stages + VERIFIED leads + message counts. */
leadsRouter.get('/board', async (req, res, next) => {
  try {
    const { rows: stages } = await q('SELECT * FROM stages ORDER BY position');
    const { rows: leads } = await q(
      `SELECT l.*,
      (SELECT count(*)::int FROM messages m WHERE m.lead_id = l.id) AS message_count,
      (SELECT count(*)::int FROM remarks r WHERE r.lead_id = l.id) AS remark_count,
      (SELECT max(created_at) FROM messages m WHERE m.lead_id = l.id) AS last_message_at
      FROM leads l
      WHERE l.is_meta_verified = true
      ORDER BY l.board_order ASC, l.created_at DESC`
    );
    res.json({ stages, leads });
  } catch (e) {
    next(e);
  }
});

leadsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM leads WHERE id=$1 AND is_meta_verified = true', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'That lead no longer exists or is pending Meta verification.' });
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
    const normalizedPhone = normalisePhone(phone);
    const { rows: firstStage } = await q('SELECT id FROM stages ORDER BY position LIMIT 1');
    const { rows } = await q(
      `INSERT INTO leads (full_name, phone, email, city, stage_id, campaign_name, value, source, is_meta_verified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',true) RETURNING *`,
      [
        full_name || 'Unnamed lead',
        normalizedPhone,
        email || null,
        city || null,
        stage_id || firstStage[0]?.id,
        campaign_name || null,
        value || 0
      ]
    );
    const lead = rows[0];

    // Any WhatsApp messages that arrived before this number was a known lead were
    // queued in pending_messages — attach them now so the conversation isn't lost.
    if (normalizedPhone) {
      const { rows: pendingMsgs } = await q(
        `SELECT * FROM pending_messages WHERE phone = $1 ORDER BY created_at ASC`,
        [normalizedPhone]
      );
      if (pendingMsgs.length > 0) {
        for (const msg of pendingMsgs) {
          await q(
            `INSERT INTO messages (lead_id, direction, channel, body, created_at)
            VALUES ($1, 'in', $2, $3, $4)`,
            [lead.id, msg.channel, msg.body, msg.created_at]
          );
        }
        await q(`DELETE FROM pending_messages WHERE phone = $1`, [normalizedPhone]);
        await q('UPDATE leads SET wants_whatsapp = true, updated_at = now() WHERE id = $1', [lead.id]);
      }
    }

    res.json(lead);
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch('/:id', async (req, res, next) => {
  try {
    const { stage_id, full_name, email, city, value, campaign_name } = req.body || {};
    if (stage_id !== undefined) {
      await q('INSERT INTO activity (lead_id, kind, detail) VALUES ($1, $2, $3)', [req.params.id, 'moved', `to stage ${stage_id}`]);
    }
    const { rows } = await q(
      `UPDATE leads SET
      stage_id=COALESCE($2,stage_id),
      full_name=COALESCE($3,full_name),
      email=COALESCE($4,email),
      city=COALESCE($5,city),
      value=COALESCE($6,value),
      campaign_name=COALESCE($7,campaign_name),
      updated_at=now()
      WHERE id=$1 RETURNING *`,
      [req.params.id, stage_id, full_name, email, city, value, campaign_name]
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

/* ---------- remarks ---------- */

leadsRouter.post('/:id/remarks', async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'Empty remark.' });
    const { rows } = await q(
      'INSERT INTO remarks (lead_id, body) VALUES ($1,$2) RETURNING *',
      [req.params.id, body]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/:leadId/remarks/:remarkId', async (req, res, next) => {
  try {
    await q('DELETE FROM remarks WHERE id=$1 AND lead_id=$2', [req.params.remarkId, req.params.leadId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- messages ---------- */

leadsRouter.post('/:id/messages', async (req, res, next) => {
  try {
    const { body, mediaData, mediaMime, fileName } = req.body || {};
    if (!body && !mediaData) return res.status(400).json({ error: 'Empty message.' });
    const { rows: lead } = await q('SELECT * FROM leads WHERE id=$1', [req.params.id]);
    if (!lead.length) return res.status(404).json({ error: 'Lead not found.' });

    // Send via WhatsApp if connected, capturing the real message id so the
    // Baileys echo of this same message (fromMe: true) dedups against it
    // instead of appearing a second time in the conversation.
    let waMessageId = null;
    try {
      const phone = lead[0].phone;
      if (mediaData) {
        const opts = { mediaData, mimeType: mediaMime, caption: body || undefined, fileName };
        const sent = cloudConfigured()
          ? await sendMedia(phone, opts)
          : webStatus().status === 'connected'
            ? await sendWebMedia(phone, opts)
            : null;
        waMessageId = sent?.id || null;
      } else if (cloudConfigured()) {
        const sent = await sendText(phone, body);
        waMessageId = sent?.id || null;
      } else if (webStatus().status === 'connected') {
        const sent = await sendWebText(phone, body);
        waMessageId = sent?.id || null;
      }
    } catch (e) {
      console.error('WhatsApp send failed:', e.message);
    }

    const { rows } = await q(
      'INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.params.id, 'out', 'whatsapp', body || null, waMessageId, mediaData || null, mediaMime || null]
    );

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/* ---------- sync ---------- */

leadsRouter.post('/meta/sync', async (req, res, next) => {
  try {
    if (!metaConfigured()) return res.status(400).json({ error: 'Meta is not connected.' });
    const forms = await listLeadForms();
    const { rows: firstStage } = await q('SELECT id FROM stages ORDER BY position LIMIT 1');
    let count = 0;
    for (const form of forms) {
      const leads = await fetchFormLeads(form.id);
      for (const raw of leads) {
        const flat = flattenLead(raw);
        const wantsWhatsApp = JSON.stringify(flat.fields).toLowerCase().includes('whatsapp');
        await q(
          `INSERT INTO leads (meta_lead_id, form_id, campaign_id, campaign_name, full_name, phone, email, city,
          source, wants_whatsapp, is_meta_verified, stage_id, fields, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'meta',$9,true,$10,$11,$12)
          ON CONFLICT (meta_lead_id) DO UPDATE SET
            full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, email=EXCLUDED.email, city=EXCLUDED.city,
            wants_whatsapp=EXCLUDED.wants_whatsapp, fields=EXCLUDED.fields, is_meta_verified=true,
            updated_at=now()`,
          [raw.id, raw.form_id || form.id, raw.campaign_id || null, raw.campaign_name || form.name,
          flat.full_name, flat.phone, flat.email, flat.city, wantsWhatsApp,
          firstStage[0]?.id, JSON.stringify(flat.fields), raw.created_time || new Date()]
        );
        count++;

        // Upgrade any pending WhatsApp leads with the same phone to Meta-verified,
        // and attach whatever messages were queued while waiting for this sync.
        const { rows: upgradedLeads } = await q(
          `UPDATE leads
           SET is_meta_verified = true, meta_lead_id = COALESCE(meta_lead_id, $1), source = CASE WHEN source = 'whatsapp' THEN 'meta' ELSE source END, updated_at = now()
           WHERE phone = $2 AND is_meta_verified = false
           RETURNING id`,
          [raw.id, flat.phone]
        );
        if (upgradedLeads.length > 0) {
          const leadId = upgradedLeads[0].id;
          const { rows: pendingMsgs } = await q(
            `SELECT * FROM pending_messages WHERE phone = $1 ORDER BY created_at ASC`,
            [flat.phone]
          );
          for (const msg of pendingMsgs) {
            await q(
              `INSERT INTO messages (lead_id, direction, channel, body, created_at)
              VALUES ($1, 'in', $2, $3, $4)`,
              [leadId, msg.channel, msg.body, msg.created_at]
            );
          }
          await q(`DELETE FROM pending_messages WHERE phone = $1`, [flat.phone]);
        }
      }
    }
    res.json({ ok: true, imported: count });
  } catch (e) {
    next(e);
  }
});

leadsRouter.post('/sync/whatsapp', async (req, res, next) => {
  try {
    if (!webStatus().ready && !cloudConfigured()) {
      return res.status(400).json({ error: 'WhatsApp is not connected.' });
    }
    res.json({ ok: true, message: 'WhatsApp messages are synced in real-time.' });
  } catch (e) {
    next(e);
  }
});

/* ---------- board-order ---------- */

leadsRouter.patch('/board-order', async (req, res, next) => {
  try {
    const { moves } = req.body || {};
    if (!Array.isArray(moves)) return res.status(400).json({ error: 'Invalid moves.' });
    for (const { id, board_order } of moves) {
      await q('UPDATE leads SET board_order=$1 WHERE id=$2', [board_order, id]);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
