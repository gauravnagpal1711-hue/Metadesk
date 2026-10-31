/**
 * Automatic appointment WhatsApp messages, per tenant:
 *   1. Confirmation — sent as soon as a lead's appointment date is set or changed.
 *   2. Reminder — sent the day before the appointment, at the tenant's chosen hour.
 *
 * Templates + switches live in settings key `appointment_messages` (edited on the
 * "Appointment messages" tab). Duplicate sends are prevented by stamping which
 * appointment_date each message went out for (leads.appt_confirm_sent_for /
 * appt_reminder_sent_for), claimed atomically before sending — so re-saving the
 * same date never re-sends, while a reschedule sends a fresh confirmation and
 * a fresh reminder.
 */
import { q, getSetting, setSetting } from '../db.js';
import { sendText, cloudConfigured } from './whatsappCloud.js';
import { sendWebText, webStatus } from './whatsappWeb.js';
import { loadWaConnection } from './waConnection.js';

export const SETTINGS_KEY = 'appointment_messages';

export const DEFAULT_APPOINTMENT_SETTINGS = {
  confirm_enabled: false,
  confirm_template:
    'Hi {name}, your appointment at {studio} is confirmed for {day}, {date} at {time}.\n📍 {address}\n{map}\nReply here if you need to reschedule. See you soon!',
  reminder_enabled: false,
  reminder_template:
    'Hi {name}, a friendly reminder of your visit to {studio} tomorrow ({day}, {date}) at {time}.\n📍 {address}\n{map}\nSee you there!',
  reminder_hour: 10, // local hour (0–23) the day before
  studio_name: '',
  address: '',
  map_link: '',
  timezone: 'Asia/Kolkata'
};

export const PLACEHOLDERS = ['name', 'date', 'day', 'time', 'studio', 'address', 'map', 'phone'];

export async function loadAppointmentSettings(userId) {
  const saved = await getSetting(userId, SETTINGS_KEY, {});
  return { ...DEFAULT_APPOINTMENT_SETTINGS, ...(saved || {}) };
}

export async function saveAppointmentSettings(userId, patch) {
  const current = await loadAppointmentSettings(userId);
  const next = { ...current };
  for (const k of ['confirm_enabled', 'reminder_enabled']) {
    if (patch[k] !== undefined) next[k] = !!patch[k];
  }
  for (const k of ['confirm_template', 'reminder_template', 'studio_name', 'address', 'map_link']) {
    if (patch[k] !== undefined) next[k] = String(patch[k] ?? '').slice(0, 2000);
  }
  if (patch.reminder_hour !== undefined) {
    const h = Math.round(Number(patch.reminder_hour));
    if (!(h >= 0 && h <= 23)) throw Object.assign(new Error('Reminder hour must be 0–23.'), { status: 400 });
    next.reminder_hour = h;
  }
  if (patch.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone });
      next.timezone = patch.timezone;
    } catch {
      throw Object.assign(new Error('Unknown timezone.'), { status: 400 });
    }
  }
  await setSetting(userId, SETTINGS_KEY, next);
  return next;
}

/* ---------- date helpers (tenant timezone; server runs in UTC) ---------- */

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** Fills {placeholders}; a line whose placeholders were all blank and is left with no words is dropped. */
export function renderTemplate(template, lead, settings) {
  const tz = settings.timezone || 'Asia/Kolkata';
  const appt = lead.appointment_date ? new Date(lead.appointment_date) : null;
  const firstName = String(lead.full_name || '').trim().split(/\s+/)[0] || '';
  const values = {
    name: firstName || 'there',
    phone: lead.phone || '',
    date: appt ? appt.toLocaleDateString('en-IN', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }) : '',
    day: appt ? appt.toLocaleDateString('en-IN', { timeZone: tz, weekday: 'long' }) : '',
    time: appt ? appt.toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }) : '',
    studio: settings.studio_name?.trim() || 'our studio',
    address: settings.address?.trim() || '',
    map: settings.map_link?.trim() || ''
  };
  const lines = String(template || '').split('\n');
  const out = [];
  for (const line of lines) {
    let hadBlank = false;
    const filled = line.replace(/\{(\w+)\}/g, (m, key) => {
      if (!(key in values)) return m;
      if (!values[key]) hadBlank = true;
      return values[key];
    });
    if (hadBlank && !/[\p{L}\p{N}]/u.test(filled)) continue;
    out.push(filled.replace(/[ \t]+$/, ''));
  }
  return out.join('\n').trim();
}

/* ---------- sending ---------- */

/** Sends a plain WhatsApp text to a lead (Cloud first, then paired Web), records it like an app-sent message. */
async function sendLeadText(userId, lead, body) {
  const wa = await loadWaConnection(userId);
  const transports = [];
  if (cloudConfigured(wa.cloud)) transports.push(['Cloud API', () => sendText(wa.cloud, lead.phone, body)]);
  if (webStatus(userId).status === 'connected') transports.push(['WhatsApp Web', () => sendWebText(userId, lead.phone, body)]);
  if (!transports.length) throw new Error('WhatsApp is not connected');

  const failures = [];
  for (const [label, run] of transports) {
    try {
      const sent = await run();
      if (sent?.id) {
        await q(
          `INSERT INTO messages (lead_id, direction, channel, body, wa_message_id, user_id)
           SELECT $1::int,'out','whatsapp',$2::text,$3::text,$4::int
           WHERE NOT EXISTS (SELECT 1 FROM messages WHERE wa_message_id = $3::text AND user_id = $4::int)`,
          [lead.id, body, sent.id, userId]
        );
        await q('UPDATE leads SET last_contacted_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2', [lead.id, userId]);
        return label;
      }
      failures.push(`${label}: no message id returned`);
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
    }
  }
  throw new Error(failures.join(' | '));
}

const logActivity = (userId, leadId, detail) =>
  q("INSERT INTO activity (lead_id, kind, detail, author, user_id) VALUES ($1,'auto_message',$2,'auto',$3)", [leadId, detail, userId]);

/**
 * Call after a lead's appointment_date was written. Sends the confirmation if the
 * feature is on, the date is in the future, and this date hasn't been confirmed yet.
 * Never throws — failures are logged on the lead's activity timeline.
 */
export async function onAppointmentSet(userId, leadId) {
  try {
    const settings = await loadAppointmentSettings(userId);
    if (!settings.confirm_enabled) return;
    const { rows } = await q(
      `SELECT l.*, s.is_lost FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
       WHERE l.id = $1 AND l.user_id = $2`,
      [leadId, userId]
    );
    const lead = rows[0];
    if (!lead?.appointment_date || lead.is_lost || !lead.phone) return;
    if (new Date(lead.appointment_date) <= new Date()) return;

    // Claim: only one request wins for a given date.
    const prev = lead.appt_confirm_sent_for;
    const { rowCount } = await q(
      `UPDATE leads SET appt_confirm_sent_for = appointment_date
       WHERE id = $1 AND user_id = $2 AND appt_confirm_sent_for IS DISTINCT FROM appointment_date`,
      [leadId, userId]
    );
    if (!rowCount) return;

    const body = renderTemplate(settings.confirm_template, lead, settings);
    if (!body) return;
    try {
      const via = await sendLeadText(userId, lead, body);
      await q('UPDATE leads SET appt_confirm_sent_at = now() WHERE id = $1', [leadId]);
      await logActivity(userId, leadId, `Appointment confirmation sent on WhatsApp (${via})`);
    } catch (e) {
      // Release the claim so re-saving the date retries.
      await q('UPDATE leads SET appt_confirm_sent_for = $3 WHERE id = $1 AND user_id = $2', [leadId, userId, prev]);
      await logActivity(userId, leadId, `Appointment confirmation NOT sent: ${e.message}`);
      console.error(`Appointment confirmation failed for lead ${leadId}:`, e.message);
    }
  } catch (e) {
    console.error('onAppointmentSet failed:', e.message);
  }
}

/** Background job: day-before reminders for every tenant that has them switched on. */
export async function sendDueAppointmentReminders() {
  let users;
  try {
    ({ rows: users } = await q(
      `SELECT user_id FROM settings WHERE key = $1 AND (value->>'reminder_enabled')::boolean = true`,
      [SETTINGS_KEY]
    ));
  } catch (e) {
    console.error('Reminder job: could not list tenants:', e.message);
    return;
  }

  for (const { user_id: uid } of users) {
    try {
      const settings = await loadAppointmentSettings(uid);
      const tz = settings.timezone || 'Asia/Kolkata';
      const now = new Date();
      const nowLocal = localParts(now, tz);
      if (nowLocal.hour < Number(settings.reminder_hour ?? 10)) continue;
      const tomorrow = localParts(new Date(now.getTime() + 24 * 3600 * 1000), tz).ymd;

      const { rows: leads } = await q(
        `SELECT l.* FROM leads l LEFT JOIN stages s ON s.id = l.stage_id
         WHERE l.user_id = $1 AND l.appointment_date > now()
           AND l.appointment_date < now() + interval '48 hours'
           AND l.appt_reminder_sent_for IS DISTINCT FROM l.appointment_date
           AND COALESCE(s.is_lost, false) = false AND l.phone IS NOT NULL`,
        [uid]
      );

      for (const lead of leads) {
        if (localParts(new Date(lead.appointment_date), tz).ymd !== tomorrow) continue;

        const { rowCount } = await q(
          `UPDATE leads SET appt_reminder_sent_for = appointment_date
           WHERE id = $1 AND user_id = $2 AND appointment_date = $3 AND appt_reminder_sent_for IS DISTINCT FROM appointment_date`,
          [lead.id, uid, lead.appointment_date]
        );
        if (!rowCount) continue;

        // Booked within the last 3 hours and already confirmed → don't double-message.
        const justConfirmed = lead.appt_confirm_sent_at &&
          now - new Date(lead.appt_confirm_sent_at) < 3 * 3600 * 1000 &&
          lead.appt_confirm_sent_for && new Date(lead.appt_confirm_sent_for).getTime() === new Date(lead.appointment_date).getTime();
        if (justConfirmed) {
          await logActivity(uid, lead.id, 'Appointment reminder skipped — confirmation was sent less than 3 hours ago');
          continue;
        }

        const body = renderTemplate(settings.reminder_template, lead, settings);
        if (!body) continue;
        try {
          const via = await sendLeadText(uid, lead, body);
          await logActivity(uid, lead.id, `Appointment reminder sent on WhatsApp (${via})`);
        } catch (e) {
          // Release so the next run (every 15 min) retries.
          await q('UPDATE leads SET appt_reminder_sent_for = NULL WHERE id = $1 AND user_id = $2', [lead.id, uid]);
          console.error(`Appointment reminder failed for lead ${lead.id}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`Reminder job failed for user ${uid}:`, e.message);
    }
  }
}
