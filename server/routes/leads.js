import express from 'express';
import { q } from '../db.js';
import { listLeadForms, fetchFormLeads, flattenLead, normalisePhone, metaConfigured } from '../services/meta.js';
import { sendText, sendMedia, cloudConfigured } from '../services/whatsappCloud.js';
import { sendWebText, sendWebMedia, webStatus } from '../services/whatsappWeb.js';
import { suggestReplies, chatProvider } from '../services/ai.js';

export const leadsRouter = express.Router();

/** Per-lead computed columns shared by the board feed and the table (list) feed. */
const LEAD_ENRICH = `
  (SELECT count(*)::int FROM messages m WHERE m.lead_id = l.id) AS message_count,
  (SELECT count(*)::int FROM remarks r WHERE r.lead_id = l.id) AS remark_count,
  (SELECT max(created_at) FROM messages m WHERE m.lead_id = l.id) AS last_message_at,
  (SELECT count(*)::int FROM tasks t WHERE t.lead_id = l.id AND t.done = false) AS open_task_count,
  (SELECT min(due_at) FROM tasks t WHERE t.lead_id = l.id AND t.done = false) AS next_task_due_at,
  (l.campaign_id IS NOT NULL AND EXISTS (
     SELECT 1 FROM campaign_briefs b WHERE b.meta_campaign_id = l.campaign_id AND b.user_id = l.user_id
  )) AS from_adsdesk`;

const LIST_SORT_COLUMNS = {
  created: 'l.created_at',
  updated: 'l.updated_at',
  name: 'l.full_name',
  value: 'COALESCE(l.value,0)',
  followup: 'l.followup_date',
  appointment: 'l.appointment_date',
  last_contacted: 'l.last_contacted_at',
  stage: 'l.stage_id'
};

const asArray = (v) => (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []);

/**
 * Turns the query string of GET /list and GET /export.csv into a parameterised
 * WHERE clause, always scoped to one user. Every other filter is optional.
 */
function buildLeadFilter(query, userId) {
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const clauses = ['l.is_meta_verified = true', `l.user_id = ${add(userId)}`];

  const stageIds = asArray(query.stage_id).map(Number).filter(Number.isFinite);
  if (stageIds.length) clauses.push(`l.stage_id = ANY(${add(stageIds)}::int[])`);

  const sources = asArray(query.source);
  if (sources.length) clauses.push(`l.source = ANY(${add(sources)}::text[])`);

  const campaigns = asArray(query.campaign);
  if (campaigns.length) clauses.push(`l.campaign_name = ANY(${add(campaigns)}::text[])`);

  const tags = asArray(query.tag);
  if (tags.length) clauses.push(`l.tags && ${add(tags)}::text[]`);

  if (query.adsdesk === '1' || query.adsdesk === 'true') {
    clauses.push(`l.campaign_id IS NOT NULL AND EXISTS (SELECT 1 FROM campaign_briefs b WHERE b.meta_campaign_id = l.campaign_id AND b.user_id = l.user_id)`);
  }

  if (query.value_min !== undefined && query.value_min !== '') clauses.push(`COALESCE(l.value,0) >= ${add(Number(query.value_min))}`);
  if (query.value_max !== undefined && query.value_max !== '') clauses.push(`COALESCE(l.value,0) <= ${add(Number(query.value_max))}`);
  if (query.created_after) clauses.push(`l.created_at >= ${add(query.created_after)}`);
  if (query.created_before) clauses.push(`l.created_at <= ${add(query.created_before)}`);

  const dateBucket = (col, bucket) => {
    if (bucket === 'overdue') clauses.push(`(l.${col} IS NOT NULL AND l.${col} < now())`);
    else if (bucket === 'today') clauses.push(`(l.${col} >= date_trunc('day', now()) AND l.${col} < date_trunc('day', now()) + interval '1 day')`);
    else if (bucket === 'next7') clauses.push(`(l.${col} >= now() AND l.${col} < now() + interval '7 days')`);
    else if (bucket === 'none') clauses.push(`l.${col} IS NULL`);
  };
  if (query.followup) dateBucket('followup_date', query.followup);
  if (query.appointment) dateBucket('appointment_date', query.appointment);

  if (query.q && String(query.q).trim()) {
    const like = add(`%${String(query.q).trim().toLowerCase()}%`);
    clauses.push(`(lower(l.full_name) LIKE ${like} OR lower(l.phone) LIKE ${like} OR lower(coalesce(l.email,'')) LIKE ${like} OR lower(coalesce(l.city,'')) LIKE ${like} OR lower(coalesce(l.campaign_name,'')) LIKE ${like})`);
  }

  return { where: clauses.join(' AND '), params };
}

function parseListSort(sortParam) {
  const [field, dir] = String(sortParam || 'created:desc').split(':');
  const col = LIST_SORT_COLUMNS[field] || LIST_SORT_COLUMNS.created;
  return `${col} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, l.id DESC`;
}

/* ---------- stages ---------- */

leadsRouter.get('/stages', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM stages WHERE user_id = $1 ORDER BY position', [req.user.id]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

leadsRouter.post('/stages', async (req, res, next) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name the stage.' });
    const { rows: max } = await q('SELECT COALESCE(MAX(position),-1)+1 AS p FROM stages WHERE user_id = $1', [req.user.id]);
    const { rows } = await q(
      'INSERT INTO stages (name, position, color, user_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, max[0].p, color || '#5B6478', req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch('/stages/:id', async (req, res, next) => {
  try {
    const { name, color, position, requires_appointment_date, requires_followup_date, is_won, is_lost } = req.body || {};
    const { rows } = await q(
      `UPDATE stages SET name=COALESCE($3,name), color=COALESCE($4,color), position=COALESCE($5,position),
      requires_appointment_date=COALESCE($6,requires_appointment_date),
      requires_followup_date=COALESCE($7,requires_followup_date),
      is_won=COALESCE($8,is_won), is_lost=COALESCE($9,is_lost)
      WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id, name, color, position, requires_appointment_date, requires_followup_date, is_won, is_lost]
    );
    if (!rows.length) return res.status(404).json({ error: 'Stage not found.' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/stages/:id', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM stages WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Stage not found.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- board ---------- */

/** Everything the funnel needs in one request: stages + VERIFIED leads + message counts. */
leadsRouter.get('/board', async (req, res, next) => {
  try {
    const { rows: stages } = await q('SELECT * FROM stages WHERE user_id = $1 ORDER BY position', [req.user.id]);
    const { rows: leads } = await q(
      `SELECT l.*, ${LEAD_ENRICH}
      FROM leads l
      WHERE l.is_meta_verified = true AND l.user_id = $1
      ORDER BY l.board_order ASC, l.created_at DESC`,
      [req.user.id]
    );
    res.json({ stages, leads });
  } catch (e) {
    next(e);
  }
});

/* ---------- table view / filtering / bulk / tasks / views / analytics ----------
 * These collection routes MUST be declared before the "/:id" routes below, or
 * Express matches e.g. GET /leads/list as GET /leads/:id with id="list". */

/** Paginated, server-filtered feed for the table layout. */
leadsRouter.get('/list', async (req, res, next) => {
  try {
    const { where, params } = buildLeadFilter(req.query, req.user.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const orderBy = parseListSort(req.query.sort);

    const { rows: countRows } = await q(`SELECT count(*)::int AS total FROM leads l WHERE ${where}`, params);
    const { rows } = await q(
      `SELECT l.*, s.name AS stage_name, s.color AS stage_color, s.is_won AS stage_is_won, s.is_lost AS stage_is_lost,
      ${LEAD_ENRICH}
      FROM leads l
      LEFT JOIN stages s ON s.id = l.stage_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    res.json({ rows, total: countRows[0].total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

/** Same filters as /list, no pagination — streamed as a CSV download. */
leadsRouter.get('/export.csv', async (req, res, next) => {
  try {
    const { where, params } = buildLeadFilter(req.query, req.user.id);
    const { rows } = await q(
      `SELECT l.full_name, l.phone, l.email, l.city, l.campaign_name, s.name AS stage_name,
      l.value, l.tags, l.source, l.created_at, l.last_contacted_at, l.appointment_date,
      l.followup_date, l.lost_reason
      FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
      WHERE ${where}
      ORDER BY l.created_at DESC`,
      params
    );
    const headers = ['Name', 'Phone', 'Email', 'City', 'Campaign', 'Stage', 'Value', 'Tags', 'Source', 'Created', 'Last contacted', 'Appointment', 'Followup', 'Lost reason'];
    const cell = (v) => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([r.full_name, r.phone, r.email, r.city, r.campaign_name, r.stage_name, r.value,
        r.tags, r.source, r.created_at, r.last_contacted_at, r.appointment_date, r.followup_date, r.lost_reason].map(cell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ads-desk-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  } catch (e) {
    next(e);
  }
});

/** Pipeline reporting for the Insights tab. One object, all plain SQL aggregates. */
leadsRouter.get('/analytics', async (req, res, next) => {
  try {
    const params = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    const clauses = ['l.is_meta_verified = true', `l.user_id = ${add(req.user.id)}`];
    if (req.query.from) clauses.push(`l.created_at >= ${add(req.query.from)}`);
    if (req.query.to) clauses.push(`l.created_at <= ${add(req.query.to)}`);
    const campaigns = asArray(req.query.campaign);
    if (campaigns.length) clauses.push(`l.campaign_name = ANY(${add(campaigns)}::text[])`);
    const rw = clauses.join(' AND ');
    const uidPh = '$1'; // req.user.id is always the first param

    const { rows: byStage } = await q(
      `SELECT s.id AS stage_id, s.name, s.color, s.position, s.is_won, s.is_lost,
       count(l.id)::int AS count, COALESCE(sum(l.value),0)::float AS value
       FROM stages s LEFT JOIN leads l ON l.stage_id = s.id AND ${rw}
       WHERE s.user_id = ${uidPh}
       GROUP BY s.id ORDER BY s.position`,
      params
    );

    const won = byStage.filter((s) => s.is_won).reduce((a, s) => ({ count: a.count + s.count, value: a.value + s.value }), { count: 0, value: 0 });
    const lost = byStage.filter((s) => s.is_lost).reduce((a, s) => a + s.count, 0);
    const open = byStage.filter((s) => !s.is_won && !s.is_lost).reduce((a, s) => ({ count: a.count + s.count, value: a.value + s.value }), { count: 0, value: 0 });

    const [lostReasons, bySource, byCampaign, newLeads, daily, velocity, stale] = await Promise.all([
      q(`SELECT COALESCE(NULLIF(trim(l.lost_reason), ''), 'Not specified') AS reason, count(*)::int AS count
         FROM leads l JOIN stages s ON s.id = l.stage_id WHERE s.is_lost AND ${rw}
         GROUP BY reason ORDER BY count DESC LIMIT 10`, params),
      q(`SELECT COALESCE(l.source,'unknown') AS source, count(*)::int AS count
         FROM leads l WHERE ${rw} GROUP BY l.source ORDER BY count DESC`, params),
      q(`SELECT COALESCE(l.campaign_name,'No campaign') AS campaign_name, count(*)::int AS count,
         (count(*) FILTER (WHERE s.is_won))::int AS won,
         COALESCE((sum(l.value) FILTER (WHERE s.is_won)),0)::float AS won_value
         FROM leads l LEFT JOIN stages s ON s.id = l.stage_id WHERE ${rw}
         GROUP BY campaign_name ORDER BY count DESC LIMIT 15`, params),
      q(`SELECT
         (count(*) FILTER (WHERE created_at >= date_trunc('day', now())))::int AS today,
         (count(*) FILTER (WHERE created_at >= date_trunc('week', now())))::int AS this_week,
         (count(*) FILTER (WHERE created_at >= date_trunc('month', now())))::int AS this_month
         FROM leads WHERE is_meta_verified = true AND user_id = ${uidPh}`, [req.user.id]),
      q(`SELECT to_char(date_trunc('day', l.created_at), 'YYYY-MM-DD') AS date, count(*)::int AS count
         FROM leads l WHERE ${rw} GROUP BY 1 ORDER BY 1`, params),
      q(`SELECT
         (avg(EXTRACT(EPOCH FROM (l.stage_changed_at - l.created_at))/86400.0)
           FILTER (WHERE s.is_won))::float AS avg_days_to_won,
         (avg(EXTRACT(EPOCH FROM (l.last_contacted_at - l.created_at))/86400.0)
           FILTER (WHERE l.last_contacted_at IS NOT NULL))::float AS avg_days_to_contact,
         (avg(EXTRACT(EPOCH FROM (now() - l.stage_changed_at))/86400.0)
           FILTER (WHERE NOT s.is_won AND NOT s.is_lost))::float AS avg_days_in_stage
         FROM leads l LEFT JOIN stages s ON s.id = l.stage_id WHERE ${rw}`, params),
      q(`SELECT count(*)::int AS count
         FROM leads l JOIN stages s ON s.id = l.stage_id
         WHERE NOT s.is_won AND NOT s.is_lost AND l.is_meta_verified = true AND l.user_id = ${uidPh}
         AND l.created_at < now() - interval '7 days'
         AND (l.last_contacted_at IS NULL OR l.last_contacted_at < now() - interval '7 days')`, [req.user.id])
    ]);

    // Daily activity log — scoped to this user's leads.
    const p2 = [req.user.id];
    const a2 = (v) => { p2.push(v); return `$${p2.length}`; };
    const uid2 = '$1';
    const campPh = campaigns.length ? a2(campaigns) : null;
    const fromPh = req.query.from ? a2(req.query.from) : null;
    const toPh = req.query.to ? a2(req.query.to) : null;
    const actWhere = (col) => [
      `l.user_id = ${uid2}`,
      campPh ? `l.campaign_name = ANY(${campPh}::text[])` : null,
      fromPh ? `${col} >= ${fromPh}` : null,
      toPh ? `${col} <= ${toPh}` : null
    ].filter(Boolean).map((c) => ` AND ${c}`).join('');

    const { rows: dailyActionRows } = await q(
      `WITH actions AS (
         SELECT date_trunc('day', a.created_at) AS day,
           CASE a.kind WHEN 'moved' THEN 'moves'
                       WHEN 'contacted' THEN 'contacts'
                       WHEN 'task_done' THEN 'tasks_done'
                       WHEN 'task_added' THEN 'tasks_added'
                       ELSE a.kind END AS type
         FROM activity a JOIN leads l ON l.id = a.lead_id
         WHERE a.kind IN ('moved','contacted','task_done','task_added')${actWhere('a.created_at')}
         UNION ALL
         SELECT date_trunc('day', m.created_at), 'messages_sent'
         FROM messages m JOIN leads l ON l.id = m.lead_id
         WHERE m.direction = 'out'${actWhere('m.created_at')}
         UNION ALL
         SELECT date_trunc('day', r.created_at), 'remarks'
         FROM remarks r JOIN leads l ON l.id = r.lead_id
         WHERE true${actWhere('r.created_at')}
       )
       SELECT to_char(day, 'YYYY-MM-DD') AS date, type, count(*)::int AS count
       FROM actions GROUP BY day, type ORDER BY day`,
      p2
    );

    const dayMap = new Map();
    for (const r of dailyActionRows) {
      const d = dayMap.get(r.date) || { date: r.date, moves: 0, contacts: 0, messages_sent: 0, tasks_done: 0, tasks_added: 0, remarks: 0, total: 0 };
      d[r.type] = r.count;
      d.total += r.count;
      dayMap.set(r.date, d);
    }
    const daily_actions = [...dayMap.values()];
    const actionsTotal = daily_actions.reduce((a, d) => a + d.total, 0);
    const busiest = daily_actions.reduce((best, d) => (!best || d.total > best.total ? d : best), null);

    const funnelStages = byStage.filter((s) => !s.is_lost);
    const funnel = funnelStages.map((s, i) => {
      const next = funnelStages[i + 1];
      return { ...s, conversion_to_next: next && s.count > 0 ? next.count / s.count : null };
    });

    res.json({
      total: byStage.reduce((a, s) => a + s.count, 0),
      by_stage: byStage,
      funnel,
      open,
      won: { ...won, avg_value: won.count ? won.value / won.count : 0 },
      lost: { count: lost, reasons: lostReasons.rows },
      win_rate: won.count + lost > 0 ? won.count / (won.count + lost) : null,
      new_leads: { ...newLeads.rows[0], daily: daily.rows },
      by_source: bySource.rows,
      by_campaign: byCampaign.rows,
      velocity: velocity.rows[0],
      stale: stale.rows[0].count,
      daily_actions,
      actions: {
        total: actionsTotal,
        active_days: daily_actions.length,
        per_active_day: daily_actions.length ? actionsTotal / daily_actions.length : 0,
        busiest_day: busiest ? { date: busiest.date, total: busiest.total } : null
      }
    });
  } catch (e) {
    next(e);
  }
});

/* ---------- tasks ---------- */

/** Cross-lead task queue for the "Today / Overdue" strip. */
leadsRouter.get('/tasks', async (req, res, next) => {
  try {
    const scope = req.query.scope || 'all';
    const includeDone = req.query.include_done === 'true' || req.query.include_done === '1';
    const clauses = ['t.user_id = $1'];
    if (!includeDone) clauses.push('t.done = false');
    if (scope === 'today') clauses.push(`t.due_at < date_trunc('day', now()) + interval '1 day'`);
    else if (scope === 'overdue') clauses.push('t.due_at < now()');
    else if (scope === 'upcoming') clauses.push('t.due_at >= now()');
    const { rows } = await q(
      `SELECT t.*, l.full_name AS lead_name, l.phone AS lead_phone, l.stage_id,
       s.name AS stage_name, s.color AS stage_color
       FROM tasks t JOIN leads l ON l.id = t.lead_id LEFT JOIN stages s ON s.id = l.stage_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY t.done ASC, t.due_at ASC NULLS LAST, t.created_at DESC
       LIMIT 500`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch('/tasks/:taskId', async (req, res, next) => {
  try {
    const { done, title, due_at, kind } = req.body || {};
    const { rows: existing } = await q('SELECT * FROM tasks WHERE id=$1 AND user_id=$2', [req.params.taskId, req.user.id]);
    if (!existing.length) return res.status(404).json({ error: 'Task not found.' });
    const task = existing[0];
    const nextDone = done === undefined ? task.done : !!done;
    const { rows } = await q(
      `UPDATE tasks SET
       done = $2,
       done_at = CASE WHEN $2 AND NOT done THEN now() WHEN NOT $2 THEN NULL ELSE done_at END,
       title = COALESCE($3, title),
       due_at = $4,
       kind = COALESCE($5, kind)
       WHERE id = $1 RETURNING *`,
      [req.params.taskId, nextDone, title ?? null, due_at === undefined ? task.due_at : (due_at || null), kind ?? null]
    );
    if (nextDone && !task.done) {
      await q(`INSERT INTO activity (lead_id, kind, detail, user_id) VALUES ($1,'task_done',$2,$3)`, [task.lead_id, `Task done: ${rows[0].title}`, req.user.id]);
      if (['call', 'meeting', 'whatsapp', 'email'].includes(rows[0].kind)) {
        await q(`UPDATE leads SET last_contacted_at = now(), updated_at = now() WHERE id = $1`, [task.lead_id]);
      }
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/tasks/:taskId', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM tasks WHERE id=$1 AND user_id=$2', [req.params.taskId, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Task not found.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- saved views ---------- */

leadsRouter.get('/views', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM saved_views WHERE user_id = $1 ORDER BY position, id', [req.user.id]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

leadsRouter.post('/views', async (req, res, next) => {
  try {
    const { name, filters, layout } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name the view.' });
    const { rows: max } = await q('SELECT COALESCE(MAX(position),-1)+1 AS p FROM saved_views WHERE user_id = $1', [req.user.id]);
    const { rows } = await q(
      'INSERT INTO saved_views (name, filters, layout, position, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [String(name).trim(), JSON.stringify(filters || {}), layout === 'table' ? 'table' : 'board', max[0].p, req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch('/views/:id', async (req, res, next) => {
  try {
    const { name, filters, layout, position } = req.body || {};
    const { rows } = await q(
      `UPDATE saved_views SET name=COALESCE($3,name),
       filters=COALESCE($4,filters), layout=COALESCE($5,layout), position=COALESCE($6,position)
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id, name ?? null, filters !== undefined ? JSON.stringify(filters) : null, layout ?? null, position ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: 'View not found.' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/views/:id', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM saved_views WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'View not found.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- bulk actions ---------- */

leadsRouter.patch('/bulk-update', async (req, res, next) => {
  try {
    const { ids, stage_id, add_tags, remove_tags, campaign_name, lost_reason } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No leads selected.' });
    const numIds = ids.map(Number).filter(Number.isFinite);
    const uid = req.user.id;
    let moved = 0;

    if (stage_id !== undefined) {
      const { rows: s } = await q('SELECT name, is_lost FROM stages WHERE id=$1 AND user_id=$2', [stage_id, uid]);
      if (!s.length) return res.status(400).json({ error: 'Stage not found.' });
      const isLost = !!s[0]?.is_lost;
      for (const id of numIds) {
        const { rowCount } = await q(
          `UPDATE leads SET stage_id=$2, stage_changed_at=now(),
           lost_reason = CASE WHEN $3 THEN COALESCE($4, lost_reason) ELSE NULL END,
           updated_at=now() WHERE id=$1 AND user_id=$5`,
          [id, stage_id, isLost, lost_reason || null, uid]
        );
        if (rowCount) {
          await q(`INSERT INTO activity (lead_id, kind, detail, user_id) VALUES ($1,'moved',$2,$3)`, [id, `Moved to ${s[0]?.name || 'a stage'} (bulk)`, uid]);
          moved++;
        }
      }
    }
    if (Array.isArray(add_tags) && add_tags.length) {
      await q(
        `UPDATE leads SET tags = (SELECT array_agg(DISTINCT x) FROM unnest(tags || $2::text[]) x), updated_at=now()
         WHERE id = ANY($1::int[]) AND user_id = $3`,
        [numIds, add_tags, uid]
      );
    }
    if (Array.isArray(remove_tags) && remove_tags.length) {
      await q(
        `UPDATE leads SET tags = COALESCE((SELECT array_agg(x) FROM unnest(tags) x WHERE NOT (x = ANY($2::text[]))), '{}'), updated_at=now()
         WHERE id = ANY($1::int[]) AND user_id = $3`,
        [numIds, remove_tags, uid]
      );
    }
    if (campaign_name !== undefined) {
      await q('UPDATE leads SET campaign_name=$2, updated_at=now() WHERE id = ANY($1::int[]) AND user_id = $3', [numIds, campaign_name || null, uid]);
    }
    res.json({ ok: true, updated: numIds.length, moved });
  } catch (e) {
    next(e);
  }
});

leadsRouter.post('/bulk-delete', async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No leads selected.' });
    const numIds = ids.map(Number).filter(Number.isFinite);
    const { rowCount } = await q('DELETE FROM leads WHERE id = ANY($1::int[]) AND user_id = $2', [numIds, req.user.id]);
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    next(e);
  }
});

leadsRouter.get('/:id', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { rows } = await q(
      `SELECT l.*, (l.campaign_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM campaign_briefs b WHERE b.meta_campaign_id = l.campaign_id AND b.user_id = l.user_id
       )) AS from_adsdesk
       FROM leads l WHERE l.id=$1 AND l.user_id=$2 AND l.is_meta_verified = true`,
      [req.params.id, uid]
    );
    if (!rows.length) return res.status(404).json({ error: 'That lead no longer exists or is pending Meta verification.' });
    const { rows: messages } = await q('SELECT * FROM messages WHERE lead_id=$1 AND user_id=$2 ORDER BY created_at ASC', [req.params.id, uid]);
    const { rows: remarks } = await q('SELECT * FROM remarks WHERE lead_id=$1 AND user_id=$2 ORDER BY created_at DESC', [req.params.id, uid]);
    const { rows: activity } = await q('SELECT * FROM activity WHERE lead_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50', [req.params.id, uid]);
    const { rows: tasks } = await q('SELECT * FROM tasks WHERE lead_id=$1 AND user_id=$2 ORDER BY done ASC, due_at ASC NULLS LAST, created_at DESC', [req.params.id, uid]);
    res.json({ lead: rows[0], messages, remarks, activity, tasks });
  } catch (e) {
    next(e);
  }
});

/**
 * AI-suggested WhatsApp replies for this lead's conversation, written to match
 * how the user replies by hand — preferring their replies to leads from the
 * SAME campaign.
 */
leadsRouter.post('/:id/suggest-replies', async (req, res, next) => {
  try {
    if (!chatProvider()) return res.status(400).json({ error: 'Add ANTHROPIC_API_KEY to enable reply suggestions.' });
    const uid = req.user.id;

    const { rows: leadRows } = await q(
      `SELECT l.id, l.full_name, l.city, l.campaign_name, s.name AS stage_name
       FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
       WHERE l.id = $1 AND l.user_id = $2 AND l.is_meta_verified = true`,
      [req.params.id, uid]
    );
    if (!leadRows.length) return res.status(404).json({ error: 'That lead no longer exists.' });
    const lead = leadRows[0];

    const { rows: convo } = await q(
      `SELECT direction, body FROM (
         SELECT direction, body, created_at FROM messages
         WHERE lead_id = $1 AND user_id = $2 AND body IS NOT NULL AND btrim(body) <> ''
         ORDER BY created_at DESC LIMIT 60
       ) t ORDER BY created_at ASC`,
      [req.params.id, uid]
    );
    if (convo.length === 0) return res.status(400).json({ error: 'No conversation yet to work from.' });

    // (incoming -> their reply) pairs from this user's OTHER leads, with the
    // campaign each pair came from so same-campaign pairs can be preferred.
    const { rows: others } = await q(
      `SELECT m.lead_id, m.direction, m.body, l.campaign_name FROM (
         SELECT lead_id, direction, body, created_at FROM messages
         WHERE user_id = $1 AND lead_id <> $2 AND body IS NOT NULL AND btrim(body) <> ''
         ORDER BY created_at DESC LIMIT 800
       ) m JOIN leads l ON l.id = m.lead_id
       ORDER BY m.lead_id ASC, m.created_at ASC`,
      [uid, req.params.id]
    );
    const sameCampaign = [];
    const otherCampaign = [];
    let prevLead = null;
    let prevIn = null;
    for (const m of others) {
      if (m.lead_id !== prevLead) { prevLead = m.lead_id; prevIn = null; }
      if (m.direction === 'in') { prevIn = m.body; continue; }
      if (m.direction === 'out' && prevIn) {
        const pair = { lead: prevIn.slice(0, 400), reply: m.body.slice(0, 400) };
        (m.campaign_name && lead.campaign_name && m.campaign_name === lead.campaign_name ? sameCampaign : otherCampaign).push(pair);
        prevIn = null;
      }
    }
    const examples = [...sameCampaign.slice(-8), ...otherCampaign.slice(-8)].slice(0, 12);

    const suggestions = await suggestReplies({
      conversation: convo,
      examples,
      lead: { name: lead.full_name, stage: lead.stage_name, campaign: lead.campaign_name, city: lead.city }
    });
    res.json({ suggestions });
  } catch (e) {
    next(e);
  }
});

leadsRouter.post('/:id/tasks', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { kind, title, due_at } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Task needs a title.' });
    const { rows: owned } = await q('SELECT 1 FROM leads WHERE id=$1 AND user_id=$2', [req.params.id, uid]);
    if (!owned.length) return res.status(404).json({ error: 'Lead not found.' });
    const { rows } = await q(
      'INSERT INTO tasks (lead_id, kind, title, due_at, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.id, kind || 'todo', String(title).trim(), due_at || null, uid]
    );
    await q(`INSERT INTO activity (lead_id, kind, detail, user_id) VALUES ($1,'task_added',$2,$3)`, [req.params.id, `Task added: ${String(title).trim()}`, uid]);
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/** Records "I just reached out" — bumps last_contacted_at without sending anything. */
leadsRouter.post('/:id/contacted', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { rows } = await q('UPDATE leads SET last_contacted_at = now(), updated_at = now() WHERE id=$1 AND user_id=$2 RETURNING *', [req.params.id, uid]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found.' });
    await q(`INSERT INTO activity (lead_id, kind, detail, user_id) VALUES ($1,'contacted','Marked as contacted',$2)`, [req.params.id, uid]);
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/**
* Shared by the single-add and bulk-upload routes. Creates a manual lead for the
* given user and attaches any WhatsApp messages already queued in
* pending_messages for its phone (within that user's workspace).
*/
async function createManualLead(userId, { full_name, phone, email, city, stage_id, campaign_name, value, remark }, { skipIfExists = false, remarkAuthor = 'me' } = {}) {
  const normalizedPhone = normalisePhone(phone);

  if (skipIfExists && normalizedPhone) {
    const { rows: existing } = await q('SELECT id FROM leads WHERE phone = $1 AND user_id = $2 LIMIT 1', [normalizedPhone, userId]);
    if (existing.length) return { skipped: true, reason: 'A lead with this phone already exists.' };
  }

  const { rows: firstStage } = await q('SELECT id FROM stages WHERE user_id = $1 ORDER BY position LIMIT 1', [userId]);
  const { rows } = await q(
    `INSERT INTO leads (full_name, phone, email, city, stage_id, campaign_name, value, source, is_meta_verified, user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',true,$8) RETURNING *`,
    [
      full_name || 'Unnamed lead',
      normalizedPhone,
      email || null,
      city || null,
      stage_id || firstStage[0]?.id,
      campaign_name || null,
      value || 0,
      userId
    ]
  );
  const lead = rows[0];

  if (remark && String(remark).trim()) {
    await q('INSERT INTO remarks (lead_id, body, author, user_id) VALUES ($1,$2,$3,$4)', [lead.id, String(remark).trim(), remarkAuthor, userId]);
  }

  if (normalizedPhone) {
    const { rows: pendingMsgs } = await q(
      `SELECT * FROM pending_messages WHERE phone = $1 AND user_id = $2 ORDER BY created_at ASC`,
      [normalizedPhone, userId]
    );
    if (pendingMsgs.length > 0) {
      for (const msg of pendingMsgs) {
        await q(
          `INSERT INTO messages (lead_id, direction, channel, body, created_at, user_id)
          VALUES ($1, 'in', $2, $3, $4, $5)`,
          [lead.id, msg.channel, msg.body, msg.created_at, userId]
        );
      }
      await q(`DELETE FROM pending_messages WHERE phone = $1 AND user_id = $2`, [normalizedPhone, userId]);
      await q('UPDATE leads SET wants_whatsapp = true, updated_at = now() WHERE id = $1', [lead.id]);
    }
  }

  return { lead };
}

leadsRouter.post('/', async (req, res, next) => {
  try {
    const { lead } = await createManualLead(req.user.id, req.body || {});
    res.json(lead);
  } catch (e) {
    next(e);
  }
});

/** Bulk import from the "Add lead manually" Excel upload. */
leadsRouter.post('/bulk', async (req, res, next) => {
  try {
    const { leads } = req.body || {};
    if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: 'No leads to import.' });
    if (leads.length > 2000) return res.status(400).json({ error: 'Too many rows in one upload (max 2000).' });

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < leads.length; i++) {
      const row = leads[i];
      if (!row.phone) {
        skipped++;
        errors.push({ row: i + 1, reason: 'Missing phone number.' });
        continue;
      }
      try {
        const result = await createManualLead(req.user.id, row, { skipIfExists: true, remarkAuthor: 'upload' });
        if (result.skipped) {
          skipped++;
          errors.push({ row: i + 1, reason: result.reason });
        } else {
          created++;
        }
      } catch (e) {
        skipped++;
        errors.push({ row: i + 1, reason: e.message });
      }
    }

    res.json({ created, skipped, errors });
  } catch (e) {
    next(e);
  }
});

/**
* Looks up the target stage (for this user) and confirms the move is allowed.
*/
async function checkStageMoveRequirements(userId, leadId, stageId, { appointment_date, followup_date, lost_reason }) {
  const { rows: stageRow } = await q(
    'SELECT name, requires_appointment_date, requires_followup_date, is_won, is_lost FROM stages WHERE id=$1 AND user_id=$2',
    [stageId, userId]
  );
  const stage = stageRow[0];
  if (!stage) return { stage };

  const needsAppointment = stage.requires_appointment_date && appointment_date === undefined;
  const needsFollowup = stage.requires_followup_date && followup_date === undefined;
  const needsLostReason = stage.is_lost && !(lost_reason && String(lost_reason).trim());
  if (!needsAppointment && !needsFollowup && !needsLostReason) return { stage };

  const { rows: leadRow } = await q('SELECT appointment_date, followup_date, lost_reason FROM leads WHERE id=$1 AND user_id=$2', [leadId, userId]);
  const missing = [];
  if (needsAppointment && !leadRow[0]?.appointment_date) missing.push('an appointment date');
  if (needsFollowup && !leadRow[0]?.followup_date) missing.push('a followup date');
  const stillNeedsLostReason = needsLostReason && !(leadRow[0]?.lost_reason && String(leadRow[0].lost_reason).trim());
  if (stillNeedsLostReason) missing.push('a lost reason');
  if (missing.length) {
    return {
      stage,
      needsLostReason: stillNeedsLostReason || undefined,
      blocked: `${missing.join(' and ').replace(/^a/, 'A')} is required to move a lead into "${stage.name}".`
    };
  }
  return { stage };
}

leadsRouter.patch('/:id', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { stage_id, full_name, email, city, value, campaign_name, custom_fields, appointment_date, followup_date, tags, lost_reason } = req.body || {};
    const { rows: owned } = await q('SELECT 1 FROM leads WHERE id=$1 AND user_id=$2', [req.params.id, uid]);
    if (!owned.length) return res.status(404).json({ error: 'Lead not found.' });

    let stageIsLost = false;
    if (stage_id !== undefined) {
      const check = await checkStageMoveRequirements(uid, req.params.id, stage_id, { appointment_date, followup_date, lost_reason });
      if (check.blocked) return res.status(400).json({ error: check.blocked, needs_lost_reason: check.needsLostReason });
      stageIsLost = !!check.stage?.is_lost;
      await q('INSERT INTO activity (lead_id, kind, detail, user_id) VALUES ($1, $2, $3, $4)', [req.params.id, 'moved', `Moved to ${check.stage?.name || 'a stage'}`, uid]);
    }
    const { rows } = await q(
      `UPDATE leads SET
      stage_id=COALESCE($2,stage_id),
      full_name=COALESCE($3,full_name),
      email=COALESCE($4,email),
      city=COALESCE($5,city),
      value=COALESCE($6,value),
      campaign_name=COALESCE($7,campaign_name),
      custom_fields=COALESCE($8,custom_fields),
      appointment_date=COALESCE($9,appointment_date),
      followup_date=COALESCE($10,followup_date),
      tags=COALESCE($11::text[],tags),
      stage_changed_at = CASE WHEN $12::int IS NOT NULL THEN now() ELSE stage_changed_at END,
      lost_reason = CASE
        WHEN $12::int IS NOT NULL AND $13 THEN COALESCE($14, lost_reason)
        WHEN $12::int IS NOT NULL AND NOT $13 THEN NULL
        WHEN $15 THEN $14
        ELSE lost_reason END,
      updated_at=now()
      WHERE id=$1 AND user_id=$16 RETURNING *`,
      [req.params.id, stage_id, full_name, email, city, value, campaign_name,
        custom_fields !== undefined ? JSON.stringify(custom_fields) : undefined,
        appointment_date, followup_date,
        tags !== undefined ? tags : undefined,
        stage_id ?? null, stageIsLost,
        lost_reason === undefined ? null : (lost_reason || null),
        lost_reason !== undefined, uid]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/** Dedicated stage-move endpoint the client's drag-and-drop calls. */
leadsRouter.patch('/:id/move', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { stage_id, appointment_date, followup_date, lost_reason } = req.body || {};
    if (stage_id === undefined) return res.status(400).json({ error: 'stage_id is required.' });
    const check = await checkStageMoveRequirements(uid, req.params.id, stage_id, { appointment_date, followup_date, lost_reason });
    if (!check.stage) return res.status(404).json({ error: 'Stage not found.' });
    if (check.blocked) return res.status(400).json({ error: check.blocked, needs_lost_reason: check.needsLostReason });
    const { rows } = await q(
      `UPDATE leads SET stage_id=$2, stage_changed_at=now(),
      appointment_date=COALESCE($3,appointment_date),
      followup_date=COALESCE($4,followup_date),
      lost_reason = CASE WHEN $5 THEN COALESCE($6, lost_reason) ELSE NULL END,
      updated_at=now() WHERE id=$1 AND user_id=$7 RETURNING *`,
      [req.params.id, stage_id, appointment_date, followup_date, !!check.stage?.is_lost, lost_reason || null, uid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lead not found.' });
    await q('INSERT INTO activity (lead_id, kind, detail, user_id) VALUES ($1, $2, $3, $4)', [req.params.id, 'moved', `Moved to ${check.stage?.name || 'a stage'}`, uid]);
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM leads WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Lead not found.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- remarks ---------- */

leadsRouter.post('/:id/remarks', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'Empty remark.' });
    const { rows: owned } = await q('SELECT 1 FROM leads WHERE id=$1 AND user_id=$2', [req.params.id, uid]);
    if (!owned.length) return res.status(404).json({ error: 'Lead not found.' });
    const { rows } = await q(
      'INSERT INTO remarks (lead_id, body, user_id) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, body, uid]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete('/:leadId/remarks/:remarkId', async (req, res, next) => {
  try {
    const { rowCount } = await q('DELETE FROM remarks WHERE id=$1 AND lead_id=$2 AND user_id=$3', [req.params.remarkId, req.params.leadId, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Remark not found.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- messages ---------- */

leadsRouter.post('/:id/messages', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { body, mediaData, mediaMime, fileName } = req.body || {};
    if (!body && !mediaData) return res.status(400).json({ error: 'Empty message.' });
    const { rows: lead } = await q('SELECT * FROM leads WHERE id=$1 AND user_id=$2', [req.params.id, uid]);
    if (!lead.length) return res.status(404).json({ error: 'Lead not found.' });

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
      'INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, media_data, media_mime, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.params.id, 'out', 'whatsapp', body || null, waMessageId, mediaData || null, mediaMime || null, uid]
    );
    await q('UPDATE leads SET last_contacted_at = now(), updated_at = now() WHERE id = $1', [req.params.id]);

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/* ---------- sync ---------- */

leadsRouter.post('/meta/sync', async (req, res, next) => {
  try {
    const uid = req.user.id;
    if (!metaConfigured()) return res.status(400).json({ error: 'Meta is not connected.' });
    const forms = await listLeadForms();
    const { rows: firstStage } = await q('SELECT id FROM stages WHERE user_id = $1 ORDER BY position LIMIT 1', [uid]);
    let count = 0;
    for (const form of forms) {
      const leads = await fetchFormLeads(form.id);
      for (const raw of leads) {
        const flat = flattenLead(raw);
        const wantsWhatsApp = JSON.stringify(flat.fields).toLowerCase().includes('whatsapp');
        await q(
          `INSERT INTO leads (meta_lead_id, form_id, campaign_id, campaign_name, full_name, phone, email, city,
          source, wants_whatsapp, is_meta_verified, stage_id, fields, created_at, user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'meta',$9,true,$10,$11,$12,$13)
          ON CONFLICT (meta_lead_id) DO UPDATE SET
            full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, email=EXCLUDED.email, city=EXCLUDED.city,
            wants_whatsapp=EXCLUDED.wants_whatsapp, fields=EXCLUDED.fields, is_meta_verified=true,
            updated_at=now()`,
          [raw.id, raw.form_id || form.id, raw.campaign_id || null, raw.campaign_name || form.name,
          flat.full_name, flat.phone, flat.email, flat.city, wantsWhatsApp,
          firstStage[0]?.id, JSON.stringify(flat.fields), raw.created_time || new Date(), uid]
        );
        count++;

        const { rows: upgradedLeads } = await q(
          `UPDATE leads
           SET is_meta_verified = true, meta_lead_id = COALESCE(meta_lead_id, $1), source = CASE WHEN source = 'whatsapp' THEN 'meta' ELSE source END, updated_at = now()
           WHERE phone = $2 AND is_meta_verified = false AND user_id = $3
           RETURNING id`,
          [raw.id, flat.phone, uid]
        );
        if (upgradedLeads.length > 0) {
          const leadId = upgradedLeads[0].id;
          const { rows: pendingMsgs } = await q(
            `SELECT * FROM pending_messages WHERE phone = $1 AND user_id = $2 ORDER BY created_at ASC`,
            [flat.phone, uid]
          );
          for (const msg of pendingMsgs) {
            await q(
              `INSERT INTO messages (lead_id, direction, channel, body, created_at, user_id)
              VALUES ($1, 'in', $2, $3, $4, $5)`,
              [leadId, msg.channel, msg.body, msg.created_at, uid]
            );
          }
          await q(`DELETE FROM pending_messages WHERE phone = $1 AND user_id = $2`, [flat.phone, uid]);
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
      await q('UPDATE leads SET board_order=$1 WHERE id=$2 AND user_id=$3', [board_order, id, req.user.id]);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
