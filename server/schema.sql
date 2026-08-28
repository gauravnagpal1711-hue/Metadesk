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
label TEXT,
cta_type TEXT,             -- Meta CTA enum, e.g. WHATSAPP_MESSAGE | SIGN_UP | LEARN_MORE
destination_type TEXT,     -- whatsapp | lead_form | website
destination_value TEXT,    -- WhatsApp phone (digits) | lead-form id | URL
link_url TEXT,             -- display/click URL for a website destination
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE creatives ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS cta_type TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS destination_type TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS destination_value TEXT;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS link_url TEXT;
-- Campaign details entered up front in "Set up for campaign" / Create campaign,
-- kept with the artwork so they pre-fill next time. { name, daily_budget, audience, start_at, end_at }
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS campaign_defaults JSONB;

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
is_lost BOOLEAN NOT NULL DEFAULT false,
requires_appointment_date BOOLEAN NOT NULL DEFAULT false,
requires_followup_date BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE stages ADD COLUMN IF NOT EXISTS requires_appointment_date BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS requires_followup_date BOOLEAN NOT NULL DEFAULT false;

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
appointment_date TIMESTAMPTZ,
followup_date TIMESTAMPTZ,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_date TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS leads_stage_idx ON leads(stage_id);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads(phone);
CREATE INDEX IF NOT EXISTS leads_followup_idx ON leads(followup_date);
CREATE INDEX IF NOT EXISTS leads_tags_idx ON leads USING GIN (tags);

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

CREATE TABLE IF NOT EXISTS tasks (
id SERIAL PRIMARY KEY,
lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
kind TEXT NOT NULL DEFAULT 'todo', -- todo | call | meeting | whatsapp | email
title TEXT NOT NULL,
due_at TIMESTAMPTZ,
done BOOLEAN NOT NULL DEFAULT false,
done_at TIMESTAMPTZ,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(done, due_at);
CREATE INDEX IF NOT EXISTS tasks_lead_idx ON tasks(lead_id);

CREATE TABLE IF NOT EXISTS saved_views (
id SERIAL PRIMARY KEY,
name TEXT NOT NULL,
filters JSONB NOT NULL DEFAULT '{}'::jsonb,
layout TEXT NOT NULL DEFAULT 'board', -- board | table
position INTEGER NOT NULL DEFAULT 0,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Requested changes to a live campaign. name/budget/status apply instantly via
-- PATCH /api/campaigns/:id; audience/schedule/creative changes are queued here
-- for Claude Code's MCP connector to apply.
CREATE TABLE IF NOT EXISTS campaign_edits (
id SERIAL PRIMARY KEY,
meta_campaign_id TEXT NOT NULL,
campaign_name TEXT,
changes JSONB NOT NULL DEFAULT '{}'::jsonb,
status TEXT NOT NULL DEFAULT 'ready', -- ready | applied | archived
notes TEXT,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
applied_at TIMESTAMPTZ
);

-- Campaign briefs: the app assembles these; Claude Code creates the real Meta
-- campaign from a brief (via MCP) and writes the meta_* ids back here.
CREATE TABLE IF NOT EXISTS campaign_briefs (
id SERIAL PRIMARY KEY,
name TEXT NOT NULL,
objective TEXT NOT NULL DEFAULT 'OUTCOME_LEADS',
creative_id INTEGER REFERENCES creatives(id) ON DELETE SET NULL,
daily_budget NUMERIC,
audience JSONB NOT NULL DEFAULT '{}'::jsonb, -- { cities:[], radius_km, age_min, age_max, genders:[] }
start_at TIMESTAMPTZ,
end_at TIMESTAMPTZ,
status TEXT NOT NULL DEFAULT 'draft', -- draft | ready | queued | info_needed | created | live | archived
-- notes doubles as the message channel: when status = 'info_needed', Claude's
-- MCP connector writes the question it needs answered here.
meta_campaign_id TEXT,
meta_adset_id TEXT,
meta_creative_id TEXT,
meta_ad_id TEXT,
meta_image_hash TEXT,
notes TEXT,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
