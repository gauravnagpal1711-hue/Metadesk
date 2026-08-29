/**
 * Meta Marketing Graph API wrapper — per tenant.
 *
 * Each user connects their own Facebook account. The connection (token + ad
 * account + page) lives in the `meta_connections` table, one row per user, and
 * is loaded with loadConnection(userId). The old env vars (META_ACCESS_TOKEN
 * etc.) are still honoured as a fallback for the first user only.
 *
 * Every Graph call takes an explicit `conn` object so nothing is shared between
 * tenants.
 */
import { q, getSetting, setSetting } from '../db.js';

const VERSION = process.env.META_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION}`;
const WA_SETTING_KEY = 'campaign_wa_number';
const SHOP_LOCATION_KEY = 'shop_location';

/* ---------- connection storage (per user) ---------- */

function envConnection() {
  if (!process.env.META_ACCESS_TOKEN && !process.env.META_AD_ACCOUNT_ID) return null;
  return {
    accessToken: process.env.META_ACCESS_TOKEN || null,
    adAccountId: process.env.META_AD_ACCOUNT_ID || null,
    pageId: process.env.META_PAGE_ID || null,
    pageToken: null,
    name: null,
    fbUserId: null,
    connectedAt: null,
    fromEnv: true
  };
}

function rowToConn(r) {
  if (!r) return null;
  return {
    accessToken: r.access_token || null,
    adAccountId: r.ad_account_id || null,
    pageId: r.page_id || null,
    pageToken: r.page_token || null,
    name: r.fb_name || null,
    fbUserId: r.fb_user_id || null,
    connectedAt: r.connected_at || null,
    expiresAt: r.expires_at || null
  };
}

const EMPTY_CONN = {
  accessToken: null, adAccountId: null, pageId: null, pageToken: null,
  name: null, fbUserId: null, connectedAt: null, expiresAt: null
};

/** Load a user's Meta connection. Falls back to env vars for the first user. */
export async function loadConnection(userId) {
  if (!userId) return { ...EMPTY_CONN };
  const { rows } = await q('SELECT * FROM meta_connections WHERE user_id = $1', [userId]);
  if (rows.length) return rowToConn(rows[0]);
  const { rows: firstU } = await q('SELECT id FROM users ORDER BY id LIMIT 1');
  if (firstU[0]?.id === userId) {
    const env = envConnection();
    if (env) return env;
  }
  return { ...EMPTY_CONN };
}

/** Merge a patch into a user's connection row. */
export async function saveConnection(userId, patch = {}) {
  const cur = (await q('SELECT * FROM meta_connections WHERE user_id = $1', [userId])).rows[0];
  const next = {
    access_token: patch.accessToken !== undefined ? patch.accessToken : cur?.access_token ?? null,
    fb_user_id: patch.fbUserId !== undefined ? patch.fbUserId : cur?.fb_user_id ?? null,
    fb_name: patch.name !== undefined ? patch.name : cur?.fb_name ?? null,
    ad_account_id: patch.adAccountId !== undefined ? patch.adAccountId : cur?.ad_account_id ?? null,
    page_id: patch.pageId !== undefined ? patch.pageId : cur?.page_id ?? null,
    page_token: patch.pageToken !== undefined ? patch.pageToken : cur?.page_token ?? null,
    expires_at: patch.expiresAt !== undefined ? patch.expiresAt : cur?.expires_at ?? null
  };
  await q(
    `INSERT INTO meta_connections (user_id, access_token, fb_user_id, fb_name, ad_account_id, page_id, page_token, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (user_id) DO UPDATE SET
       access_token=EXCLUDED.access_token, fb_user_id=EXCLUDED.fb_user_id, fb_name=EXCLUDED.fb_name,
       ad_account_id=EXCLUDED.ad_account_id, page_id=EXCLUDED.page_id, page_token=EXCLUDED.page_token,
       expires_at=EXCLUDED.expires_at, updated_at=now()`,
    [userId, next.access_token, next.fb_user_id, next.fb_name, next.ad_account_id, next.page_id, next.page_token, next.expires_at]
  );
  return loadConnection(userId);
}

export async function clearConnection(userId) {
  await q('DELETE FROM meta_connections WHERE user_id = $1', [userId]);
}

/** True when a connection can actually call the Marketing API. */
export function connConfigured(conn) {
  return Boolean(conn && conn.accessToken && conn.adAccountId);
}

/** Connection minus the token, for sending to the client. */
export function safeConn(conn) {
  const c = conn || EMPTY_CONN;
  return {
    name: c.name,
    fbUserId: c.fbUserId,
    adAccountId: c.adAccountId,
    pageId: c.pageId,
    connectedAt: c.connectedAt,
    expiresAt: c.expiresAt ?? null,
    hasToken: Boolean(c.accessToken)
  };
}

/* ---------- Graph plumbing ---------- */

function accountId(conn) {
  const id = conn?.adAccountId || '';
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function graph(pathname, { method = 'GET', params = {}, body, token, conn } = {}) {
  const useToken = token || conn?.accessToken;
  if (!useToken) throw new Error('Meta is not connected. Open the Facebook tab and sign in with Facebook.');
  const url = new URL(`${BASE}/${pathname.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', useToken);

  const init = { method, headers: {} };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error || {};
    let fields;
    try {
      const bfs = typeof e.error_data === 'string' ? JSON.parse(e.error_data) : e.error_data;
      const spec = bfs?.blame_field_specs || e.error_data?.blame_field_specs;
      if (Array.isArray(spec)) fields = spec.flat().filter(Boolean).join(', ');
    } catch { /* ignore */ }
    const msg = [
      e.message || `Meta API returned ${res.status}`,
      e.error_user_msg && e.error_user_msg !== e.message ? `— ${e.error_user_msg}` : null,
      e.error_subcode ? `(subcode ${e.error_subcode})` : null,
      fields ? `[field: ${fields}]` : null
    ].filter(Boolean).join(' ');
    const err = new Error(msg);
    err.metaError = e;
    throw err;
  }
  return json;
}

/* ---------- campaigns ---------- */

/** Every campaign in the ad account, with 30-day performance merged in. */
export async function listCampaigns(conn) {
  const fields = 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time';
  const campaigns = await graph(`${accountId(conn)}/campaigns`, { conn, params: { fields, limit: 200 } });

  const insights = await graph(`${accountId(conn)}/insights`, {
    conn,
    params: {
      level: 'campaign',
      fields: 'campaign_id,spend,impressions,clicks,ctr,actions,cost_per_action_type',
      date_preset: 'last_30d',
      limit: 500
    }
  }).catch(() => ({ data: [] }));

  const byCampaign = new Map();
  for (const row of insights.data || []) byCampaign.set(row.campaign_id, row);

  return (campaigns.data || []).map((c) => {
    const i = byCampaign.get(c.id) || {};
    const RESULT_ACTION_TYPES = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection', 'lead'];
    const valueFor = (type) => Number((i.actions || []).find((a) => a.action_type === type)?.value || 0);
    const resultType = RESULT_ACTION_TYPES.find((t) => valueFor(t) > 0) || 'lead';
    const leadAction = { value: valueFor(resultType) };
    const leadCost = (i.cost_per_action_type || []).find((a) => a.action_type === resultType);
    return {
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
      spend: Number(i.spend || 0),
      impressions: Number(i.impressions || 0),
      clicks: Number(i.clicks || 0),
      ctr: Number(i.ctr || 0),
      leads_count: Number(leadAction?.value || 0),
      cpl: Number(leadCost?.value || 0),
      raw: c
    };
  });
}

/** Ad sets inside one campaign. */
export async function listAdSets(conn, campaignId) {
  const data = await graph(`${campaignId}/adsets`, {
    conn,
    params: {
      fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time,end_time,promoted_object,targeting',
      limit: 100
    }
  });
  return (data.data || []).map((a) => ({
    ...a,
    daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
    lifetime_budget: a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null
  }));
}

/** Pause / resume a campaign or ad set. status is ACTIVE or PAUSED. */
export async function setStatus(conn, objectId, status) {
  return graph(objectId, { conn, method: 'POST', params: { status } });
}

/** Budget is passed in rupees/dollars; Meta wants minor units. */
export async function setDailyBudget(conn, objectId, amount) {
  return graph(objectId, { conn, method: 'POST', params: { daily_budget: Math.round(Number(amount) * 100) } });
}

export async function renameObject(conn, objectId, name) {
  return graph(objectId, { conn, method: 'POST', params: { name } });
}

export async function deleteObject(conn, objectId) {
  return graph(objectId, { conn, method: 'DELETE' });
}

/* ---------- creating a campaign from a brief (all PAUSED) ---------- */

const GENDER_CODE = { female: 2, male: 1 };

/** Turn a stored brief.audience blob into a Meta targeting spec. */
export function buildTargeting(audience = {}) {
  const t = {
    age_min: Number(audience.age_min) || 18,
    age_max: Number(audience.age_max) || 65
  };
  const genders = (audience.genders || []).map((g) => GENDER_CODE[g]).filter(Boolean);
  if (genders.length === 1) t.genders = genders; // omit = all

  if (audience.location_mode === 'cities' && Array.isArray(audience.locations) && audience.locations.length) {
    t.geo_locations = {
      cities: audience.locations.map((l) => {
        const city = { key: String(l.key) };
        const r = Number(l.radius_km);
        // Meta only accepts a city radius of 17–80 km; outside that, omit it and
        // let Meta use the city's own boundary.
        if (r >= 17 && r <= 80) { city.radius = r; city.distance_unit = 'kilometer'; }
        return city;
      })
    };
  } else if (audience.radius_center) {
    t.geo_locations = {
      custom_locations: [{
        latitude: audience.radius_center.lat ?? audience.radius_center.latitude,
        longitude: audience.radius_center.lng ?? audience.radius_center.longitude,
        radius: Number(audience.radius_km) || 10,
        distance_unit: 'kilometer'
      }]
    };
  }

  const interests = (audience.interests || [])
    .filter((i) => i && i.id)
    .map((i) => ({ id: String(i.id), name: i.name }));
  if (interests.length) t.flexible_spec = [{ interests }];

  return t;
}

export async function createCampaign(conn, { name, objective }) {
  return graph(`${accountId(conn)}/campaigns`, {
    conn,
    method: 'POST',
    body: {
      name,
      objective: objective || 'OUTCOME_LEADS',
      status: 'PAUSED',
      special_ad_categories: [],
      // Budget lives on the ad set (no campaign budget), so Meta requires this
      // flag to be explicit. false = each ad set keeps its own budget.
      is_adset_budget_sharing_enabled: false
    }
  });
}

/** Click-to-WhatsApp ad set: promoted page, WHATSAPP destination, PAUSED. */
export async function createAdSet(conn, {
  name, campaignId, dailyBudgetRupees, optimizationGoal, pageId, targeting, bidCapRupees, startAt, endAt
}) {
  const body = {
    name,
    campaign_id: campaignId,
    daily_budget: Math.round(Number(dailyBudgetRupees) * 100),
    billing_event: 'IMPRESSIONS',
    optimization_goal: optimizationGoal || 'CONVERSATIONS',
    destination_type: 'WHATSAPP',
    promoted_object: { page_id: String(pageId) },
    targeting,
    status: 'PAUSED'
  };
  if (bidCapRupees) {
    body.bid_amount = Math.round(Number(bidCapRupees) * 100);
    body.bid_strategy = 'LOWEST_COST_WITH_BID_CAP';
  }
  if (startAt) body.start_time = new Date(startAt).toISOString();
  if (endAt) body.end_time = new Date(endAt).toISOString();
  return graph(`${accountId(conn)}/adsets`, { conn, method: 'POST', body });
}

/** Upload a data-URL image to the ad account, returns its image hash. */
export async function uploadAdImage(conn, dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) throw new Error('The creative has no usable image to upload.');
  const res = await graph(`${accountId(conn)}/adimages`, { conn, method: 'POST', body: { bytes: m[2] } });
  const first = res.images && Object.values(res.images)[0];
  if (!first?.hash) throw new Error('Meta did not return an image hash for the creative.');
  return first.hash;
}

/** Click-to-WhatsApp ad creative from the page + uploaded image. */
export async function createCreative(conn, { name, pageId, message, imageHash, waNumber }) {
  return graph(`${accountId(conn)}/adcreatives`, {
    conn,
    method: 'POST',
    body: {
      name,
      object_story_spec: {
        page_id: String(pageId),
        link_data: {
          message: message || '',
          image_hash: imageHash,
          link: `https://api.whatsapp.com/send?phone=${waNumber}`,
          call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } }
        }
      }
    }
  });
}

export async function createAd(conn, { name, adsetId, creativeId }) {
  return graph(`${accountId(conn)}/ads`, {
    conn,
    method: 'POST',
    body: { name, adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED' }
  });
}

/** Every lead-gen form attached to the page. Uses the page token when we have one. */
export async function listLeadForms(conn, pageId) {
  const id = pageId || conn?.pageId;
  if (!id) throw new Error('No Facebook page selected. Pick one on the Facebook tab.');
  const data = await graph(`${id}/leadgen_forms`, {
    conn,
    params: { fields: 'id,name,status,leads_count,questions', limit: 200 },
    token: conn?.pageToken || undefined
  });
  return (data.data || []).map((f) => ({
    id: f.id,
    name: f.name,
    status: f.status,
    leads_count: f.leads_count,
    fields: (f.questions || []).map((qq) => qq.type)
  }));
}

/* ---------- in-app campaign builder helpers ---------- */

export async function searchGeo(conn, qStr) {
  if (!qStr || !qStr.trim()) return [];
  const isPin = /^\d{4,10}$/.test(qStr.trim());
  const data = await graph('search', {
    conn,
    params: {
      type: 'adgeolocation',
      q: qStr.trim(),
      location_types: JSON.stringify(isPin ? ['zip'] : ['city', 'region', 'zip']),
      limit: 8
    }
  });
  return (data.data || []).map((g) => ({
    key: g.key,
    name: g.name,
    type: g.type,
    region: g.region || null,
    country_code: g.country_code || null,
    primary_city: g.primary_city || null,
    latitude: g.latitude ?? null,
    longitude: g.longitude ?? null
  }));
}

export async function searchInterests(conn, qStr) {
  if (!qStr || !qStr.trim()) return [];
  const data = await graph('search', { conn, params: { type: 'adinterest', q: qStr.trim(), limit: 10 } });
  return (data.data || []).map((i) => ({
    id: i.id,
    name: i.name,
    audience_size: i.audience_size_lower_bound || i.audience_size || null,
    path: i.path || []
  }));
}

/* ---------- per-user settings (no Meta call) ---------- */

/** The shopkeeper's saved shop location — every campaign defaults to "near here". */
export async function getShopLocation(userId) {
  try {
    return (await getSetting(userId, SHOP_LOCATION_KEY, null)) || null;
  } catch {
    return null;
  }
}

export async function setShopLocation(userId, loc) {
  if (loc && loc.lat != null && loc.lng != null) {
    await setSetting(userId, SHOP_LOCATION_KEY, {
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      label: String(loc.label || 'My shop').slice(0, 80),
      radius_km: Math.min(80, Math.max(1, Number(loc.radius_km) || 5))
    });
  } else {
    await setSetting(userId, SHOP_LOCATION_KEY, null);
  }
  return getShopLocation(userId);
}

/**
 * Resolve the WhatsApp number leads should message for this user. A number they
 * saved in-app wins; otherwise their Page's connected number → WA_DISPLAY_NUMBER
 * env → the paired WhatsApp-Web number.
 */
export async function resolveWhatsappNumber(userId) {
  try {
    const saved = await getSetting(userId, WA_SETTING_KEY, null);
    if (saved) return { number: String(saved).replace(/\D/g, ''), source: 'saved', manual: true };
  } catch {
    /* settings table not ready */
  }
  const conn = await loadConnection(userId).catch(() => null);
  if (conn?.pageId) {
    try {
      const p = await graph(`${conn.pageId}`, {
        conn,
        params: { fields: 'connected_whatsapp_number,whatsapp_number' },
        token: conn.pageToken || undefined
      });
      const n = p.connected_whatsapp_number || p.whatsapp_number;
      if (n) return { number: String(n).replace(/\D/g, ''), source: 'page', manual: false };
    } catch {
      /* page has no WA field / no permission — fall through */
    }
  }
  if (process.env.WA_DISPLAY_NUMBER) {
    return { number: String(process.env.WA_DISPLAY_NUMBER).replace(/\D/g, ''), source: 'env', manual: false };
  }
  try {
    const { webStatus } = await import('./whatsappWeb.js');
    const me = webStatus(userId)?.me;
    if (me) return { number: String(me).replace(/\D/g, ''), source: 'whatsapp-web', manual: false };
  } catch {
    /* Baileys not running */
  }
  return { number: null, source: null, manual: false };
}

export async function setWhatsappNumber(userId, raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  await setSetting(userId, WA_SETTING_KEY, digits || null);
  return resolveWhatsappNumber(userId);
}

/* ---------- page + lead forms ---------- */

/** Page info the form flow needs: id, name, and whether lead terms are accepted. */
export async function getPageInfo(conn) {
  const pageId = conn?.pageId;
  if (!pageId) return { page_id: null, page_name: null, leadgen_tos_accepted: null };
  try {
    const p = await graph(`${pageId}`, {
      conn,
      params: { fields: 'id,name,leadgen_tos_accepted' },
      token: conn?.pageToken || undefined
    });
    return { page_id: p.id, page_name: p.name, leadgen_tos_accepted: !!p.leadgen_tos_accepted };
  } catch {
    return { page_id: pageId, page_name: conn?.name || null, leadgen_tos_accepted: null };
  }
}

const QUESTION_TYPE = { name: 'FULL_NAME', phone: 'PHONE', email: 'EMAIL', city: 'CITY' };

/** Create an Instant Form on the connected Page. The one Graph write the app makes. */
export async function createLeadForm(conn, spec = {}) {
  const pageId = conn?.pageId;
  if (!pageId) throw new Error('Connect a Facebook page first (Facebook tab).');
  if (!conn?.pageToken) throw new Error('Missing page access token — re-pick your page on the Facebook tab.');

  const wanted = Array.isArray(spec.fields) && spec.fields.length ? spec.fields : ['name', 'phone'];
  const questions = [...new Set(wanted)].map((f) => ({ type: QUESTION_TYPE[f] || 'FULL_NAME' }));
  if (!questions.some((qq) => qq.type === 'PHONE')) questions.push({ type: 'PHONE' });

  for (const cq of Array.isArray(spec.custom_questions) ? spec.custom_questions : []) {
    const label = String(cq?.label || '').trim();
    if (!label) continue;
    const opts = (Array.isArray(cq.options) ? cq.options : []).map((o) => String(o).trim()).filter(Boolean);
    questions.push(opts.length ? { type: 'CUSTOM', label, options: opts.map((value) => ({ value })) } : { type: 'CUSTOM', label });
  }

  const privacyUrl = (spec.privacy_url || '').trim() || 'https://www.facebook.com/privacy/policy/';
  const body = {
    name: (spec.name || 'Ads Desk form').slice(0, 250),
    locale: 'EN_US',
    questions,
    privacy_policy: { url: privacyUrl, link_text: 'Privacy policy' },
    context_card: {
      title: (spec.greeting || 'Get in touch').slice(0, 60),
      style: 'PARAGRAPH_STYLE',
      content: [(spec.subtext || 'Leave your details and we will contact you shortly.').slice(0, 200)]
    },
    thank_you_page: {
      title: (spec.thank_you_title || 'Thank you!').slice(0, 60),
      body: (spec.thank_you_body || 'We will be in touch soon.').slice(0, 200),
      button_type: 'VIEW_WEBSITE',
      website_url: privacyUrl
    }
  };

  const res = await graph(`${pageId}/leadgen_forms`, { conn, method: 'POST', body, token: conn.pageToken });
  return { id: res.id, name: body.name };
}

/** Raw leads for one form, newest first. */
export async function fetchFormLeads(conn, formId, since) {
  const params = { fields: 'id,created_time,field_data,campaign_id,campaign_name,form_id', limit: 200 };
  if (since) params.filtering = JSON.stringify([
    { field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(new Date(since).getTime() / 1000) }
  ]);
  const data = await graph(`${formId}/leads`, { conn, params, token: conn?.pageToken || undefined });
  return data.data || [];
}

/** Turn Meta's field_data array into a flat object. */
export function flattenLead(lead) {
  const fields = {};
  for (const f of lead.field_data || []) {
    fields[f.name] = Array.isArray(f.values) ? f.values.join(', ') : f.values;
  }
  const pick = (...keys) => keys.map((k) => fields[k]).find(Boolean) || null;
  return {
    fields,
    full_name: pick('full_name', 'name', 'first_name'),
    phone: normalisePhone(pick('phone_number', 'phone', 'mobile')),
    email: pick('email', 'email_address'),
    city: pick('city', 'town')
  };
}

export function normalisePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  const cc = (process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');
  if (digits.length === 10) return cc + digits;
  return digits;
}

export { graph };
