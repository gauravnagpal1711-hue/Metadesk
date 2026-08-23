import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

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
  { name: 'Appointment Book', color: '#0E7C5A', requires_appointment_date: true },
  { name: 'Interested', color: '#B8860F' },
  { name: 'Won', color: '#0E7C5A', is_won: true },
  { name: 'Lost', color: '#8A8F9B', is_lost: true }
];

export async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await q(sql);

  const { rows } = await q('SELECT count(*)::int AS n FROM stages');
  if (rows[0].n === 0) {
    let position = 0;
    for (const stage of DEFAULT_STAGES) {
      await q(
        'INSERT INTO stages (name, position, color, is_won, is_lost, requires_appointment_date) VALUES ($1,$2,$3,$4,$5,$6)',
        [stage.name, position++, stage.color, !!stage.is_won, !!stage.is_lost, !!stage.requires_appointment_date]
      );
    }
    console.log('Seeded default funnel stages.');
  }

  // One-time backfill for installs that already had an "Appointment Book" stage
  // before requires_appointment_date existed. Guarded by a settings flag so it
  // never overrides a later manual toggle in Manage Stages.
  const migrated = await getSetting('migrated_appointment_flag', false);
  if (!migrated) {
    await q(`UPDATE stages SET requires_appointment_date = true WHERE name = 'Appointment Book'`);
    await setSetting('migrated_appointment_flag', true);
  }
}

export async function getSetting(key, fallback = null) {
  const { rows } = await q('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function setSetting(key, value) {
  await q(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}
