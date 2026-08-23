-- Meta Ads Manager schema. Safe to run on every boot.

CREATE TABLE IF NOT EXISTS creatives (
id SERIAL PRIMARY KEY,
kind TEXT NOT NULL DEFAULT 'image', -- image | video
prompt TEXT NOT NULL,
headline TEXT,
primary_text TEXT,
cta TEXT,
provider TEXT,
image_data TEXT, -- base64 data URL
video_url TEXT,
status TEXT NOT NULL DEFAULT 'draft', -- draft | approved | used
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
id TEXT PRIMARY KEY, -- Meta campaign id
name TEXT NOT NULL,
objective TEXT,
status TEXT,
effective_status TEXT,
daily_budget NUMERIC,
lifetime_budget NUMERIC,
spend NUMERIC DEFAULT 0,
impressions BIGINT DEFAULT 0,
clicks BIGINT DEFAULT 0,
leads_count INTEGER DEFAULT 0,
ctr NUMERIC DEFAULT 0,
cpl NUMERIC DEFAULT 0,
raw JSONB,
synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stages (
id SERIAL PRIMARY KEY,
name TEXT NOT NULL,
position INTEGER NOT NULL,
color TEXT NOT NULL DEFAULT '#5B6478',
is_won BOOLEAN NOT NULL DEFAULT false,
is_lost BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS leads (
id SERIAL PRIMARY KEY,
meta_lead_id TEXT UNIQUE,
form_id TEXT,
campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
campaign_name TEXT,
full_name TEXT,
phone TEXT,
email TEXT,
city TEXT,
source TEXT NOT NULL DEFAULT 'meta', -- meta | whatsapp | manual
wants_whatsapp BOOLEAN NOT NULL DEFAULT false,
is_meta_verified BOOLEAN NOT NULL DEFAULT false,
stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
board_order INTEGER NOT NULL DEFAULT 0,
value NUMERIC DEFAULT 0,
fields JSONB,
custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS leads_stage_idx ON leads(stage_id);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads(phone);

CREATE TABLE IF NOT EXISTS messages (
id SERIAL PRIMARY KEY,
lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
direction TEXT NOT NULL, -- in | out
channel TEXT NOT NULL DEFAULT 'whatsapp',
body TEXT,
wa_message_id TEXT,
media_data TEXT, -- base64 data URL
media_mime TEXT,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_data TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mime TEXT;

CREATE INDEX IF NOT EXISTS messages_lead_idx ON messages(lead_id, created_at);

CREATE TABLE IF NOT EXISTS remarks (
id SERIAL PRIMARY KEY,
lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
body TEXT NOT NULL,
author TEXT DEFAULT 'me',
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
id SERIAL PRIMARY KEY,
lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
kind TEXT NOT NULL,
detail TEXT,
author TEXT DEFAULT 'me',
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE activity ADD COLUMN IF NOT EXISTS author TEXT DEFAULT 'me';

CREATE TABLE IF NOT EXISTS settings (
key TEXT PRIMARY KEY,
value JSONB NOT NULL,
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_messages (
id SERIAL PRIMARY KEY,
phone TEXT NOT NULL,
body TEXT NOT NULL,
channel TEXT NOT NULL DEFAULT 'whatsapp',
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_messages_phone_idx ON pending_messages(phone);
