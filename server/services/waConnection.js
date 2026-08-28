/**
 * Per-tenant WhatsApp config resolution — Cloud API creds + Baileys pairing
 * status, one row per user in wa_connections. The legacy WA_* env vars still
 * back the first user.
 */
import { q } from '../db.js';
import { cfgFromEnv } from './whatsappCloud.js';

export async function loadWaConnection(userId) {
  const r = (await q('SELECT * FROM wa_connections WHERE user_id = $1', [userId])).rows[0];
  let cloud = r?.cloud_phone_number_id && r?.cloud_token
    ? { phoneNumberId: r.cloud_phone_number_id, token: r.cloud_token }
    : null;
  if (!cloud) {
    const firstU = (await q('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0];
    if (firstU?.id === userId) cloud = cfgFromEnv();
  }
  return {
    cloud, // { phoneNumberId, token } | null
    cloudPhoneNumberId: r?.cloud_phone_number_id || (cloud?.phoneNumberId ?? null),
    cloudVerifyToken: r?.cloud_verify_token || null,
    webPaired: !!r?.web_paired,
    webPhone: r?.web_phone || null
  };
}

export async function saveWaConnection(userId, patch = {}) {
  const cur = (await q('SELECT * FROM wa_connections WHERE user_id = $1', [userId])).rows[0];
  const v = {
    cloud_phone_number_id: patch.cloudPhoneNumberId !== undefined ? patch.cloudPhoneNumberId : cur?.cloud_phone_number_id ?? null,
    cloud_token: patch.cloudToken !== undefined ? patch.cloudToken : cur?.cloud_token ?? null,
    cloud_verify_token: patch.cloudVerifyToken !== undefined ? patch.cloudVerifyToken : cur?.cloud_verify_token ?? null,
    web_paired: patch.webPaired !== undefined ? patch.webPaired : cur?.web_paired ?? false,
    web_phone: patch.webPhone !== undefined ? patch.webPhone : cur?.web_phone ?? null
  };
  await q(
    `INSERT INTO wa_connections (user_id, cloud_phone_number_id, cloud_token, cloud_verify_token, web_paired, web_phone, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       cloud_phone_number_id=EXCLUDED.cloud_phone_number_id, cloud_token=EXCLUDED.cloud_token,
       cloud_verify_token=EXCLUDED.cloud_verify_token, web_paired=EXCLUDED.web_paired,
       web_phone=EXCLUDED.web_phone, updated_at=now()`,
    [userId, v.cloud_phone_number_id, v.cloud_token, v.cloud_verify_token, v.web_paired, v.web_phone]
  );
  return loadWaConnection(userId);
}

/** Which tenant owns an inbound Cloud webhook message (by phone_number_id). */
export async function userIdForPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  const row = (await q('SELECT user_id FROM wa_connections WHERE cloud_phone_number_id = $1', [phoneNumberId])).rows[0];
  if (row) return row.user_id;
  if (process.env.WA_PHONE_NUMBER_ID && process.env.WA_PHONE_NUMBER_ID === phoneNumberId) {
    return (await q('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0]?.id || null;
  }
  return null;
}

/** Does a webhook verify token match any tenant's (or the legacy global) token? */
export async function verifyTokenMatches(token) {
  if (!token) return false;
  if (process.env.WA_VERIFY_TOKEN && token === process.env.WA_VERIFY_TOKEN) return true;
  const rows = (await q('SELECT 1 FROM wa_connections WHERE cloud_verify_token = $1 LIMIT 1', [token])).rows;
  return rows.length > 0;
}

/** User ids that should have a Baileys socket started on boot. */
export async function pairedWebUserIds() {
  const { rows } = await q('SELECT user_id FROM wa_connections WHERE web_paired = true');
  return rows.map((r) => r.user_id);
}
