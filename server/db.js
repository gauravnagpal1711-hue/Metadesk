import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add a Postgres plugin in Railway and reference ${{Postgres.DATABASE_URL}}.');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 8
});

export const q = (text, params) => pool.query(text, params);

const DEFAULT_STAGES = [
  { name: 'New lead', color: '#2B3AF0' },
  { name: 'Contacted', color: '#6B4BE8' },
  { name: 'Followup', color: '#1877f2', requires_followup_date: true },
  { name: 'Appointment Book', color: '#0E7C5A', requires_appointment_date: true },
  { name: 'Interested', color: '#B8860F' },
  { name: 'Won', color: '#0E7C5A', is_won: true },
  { name: 'Lost', color: '#8A8F9B', is_lost: true }
];

// Every domain table carries user_id; kept in one place so the backfill and any
// future audit share the list.
const TENANT_TABLES = [
  'creatives', 'campaigns', 'stages', 'leads', 'messages', 'remarks', 'activity',
  'tasks', 'saved_views', 'pending_messages', 'campaign_edits', 'campaign_briefs', 'settings'
];

/** Give a new user their own copy of the default funnel. Idempotent. */
export async function seedStagesForUser(userId) {
  const { rows } = await q('SELECT count(*)::int AS n FROM stages WHERE user_id = $1', [userId]);
  if (rows[0].n > 0) return;
  let position = 0;
  for (const stage of DEFAULT_STAGES) {
    await q(
      `INSERT INTO stages (name, position, color, is_won, is_lost, requires_appointment_date, requires_followup_date, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [stage.name, position++, stage.color, !!stage.is_won, !!stage.is_lost,
       !!stage.requires_appointment_date, !!stage.requires_followup_date, userId]
    );
  }
  console.log(`Seeded funnel stages for user ${userId}.`);
}

async function settingsPkHasUserId() {
  const { rows } = await q(`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'settings'::regclass AND i.indisprimary
  `);
  return rows.some((r) => r.attname === 'user_id');
}

export async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await q(sql);

  // --- first user: the existing single-tenant owner, from legacy env vars ---
  const { rows: uCount } = await q('SELECT count(*)::int AS n FROM users');
  if (uCount[0].n === 0) {
    const uname = (process.env.APP_USERNAME || 'owner').trim();
    const pw = process.env.APP_PASSWORD || '';
    if (pw) {
      await q(
        'INSERT INTO users (username, password_hash, business_name) VALUES ($1, $2, $3)',
        [uname, bcrypt.hashSync(pw, 10), process.env.APP_BUSINESS_NAME || 'Ads Desk']
      );
      console.log(`Seeded first user "${uname}" from APP_USERNAME/APP_PASSWORD.`);
    } else {
      console.warn('No users yet and APP_PASSWORD is unset — create one via POST /api/auth/signup.');
    }
  }

  const { rows: firstU } = await q('SELECT id FROM users ORDER BY id LIMIT 1');
  const firstUserId = firstU[0]?.id || null;

  // --- multi-tenant migration: attach every pre-existing row to the first user,
  //     then move settings from a global key PK to (user_id, key). Idempotent. ---
  if (firstUserId) {
    for (const t of TENANT_TABLES) {
      await q(`UPDATE ${t} SET user_id = $1 WHERE user_id IS NULL`, [firstUserId]);
    }
    if (!(await settingsPkHasUserId())) {
      await q('ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey');
      await q('ALTER TABLE settings ADD PRIMARY KEY (user_id, key)');
      console.log('settings primary key is now (user_id, key).');
    }

    await seedStagesForUser(firstUserId);

    // Legacy one-time stage migrations, now scoped to the first user only.
    const migrated = await getSetting(firstUserId, 'migrated_appointment_flag', false);
    if (!migrated) {
      await q(`UPDATE stages SET requires_appointment_date = true WHERE name = 'Appointment Book' AND user_id = $1`, [firstUserId]);
      await setSetting(firstUserId, 'migrated_appointment_flag', true);
    }
    const followupMigrated = await getSetting(firstUserId, 'migrated_followup_stage', false);
    if (!followupMigrated) {
      const { rows: existing } = await q(`SELECT id FROM stages WHERE name = 'Followup' AND user_id = $1`, [firstUserId]);
      if (existing.length === 0) {
        const { rows: apptStage } = await q(`SELECT position FROM stages WHERE name = 'Appointment Book' AND user_id = $1 LIMIT 1`, [firstUserId]);
        let insertPosition = apptStage[0]?.position;
        if (insertPosition === undefined) {
          const { rows: max } = await q('SELECT COALESCE(MAX(position),-1)+1 AS p FROM stages WHERE user_id = $1', [firstUserId]);
          insertPosition = max[0].p;
        } else {
          await q('UPDATE stages SET position = position + 1 WHERE position >= $1 AND user_id = $2', [insertPosition, firstUserId]);
        }
        await q(
          `INSERT INTO stages (name, position, color, requires_followup_date, user_id) VALUES ($1,$2,$3,true,$4)`,
          ['Followup', insertPosition, '#1877f2', firstUserId]
        );
        console.log('Created "Followup" stage for the first user.');
      }
      await setSetting(firstUserId, 'migrated_followup_stage', true);
    }
  }
}

export async function getSetting(userId, key, fallback = null) {
  const { rows } = await q('SELECT value FROM settings WHERE user_id = $1 AND key = $2', [userId, key]);
  return rows.length ? rows[0].value : fallback;
}

export async function setSetting(userId, key, value) {
  await q(
    `INSERT INTO settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [userId, key, JSON.stringify(value)]
  );
}
