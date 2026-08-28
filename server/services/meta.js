/**
 * Meta Marketing Graph API wrapper.
 *
 * The connection (token + ad account + page) can come from two places:
 *   1. The Facebook Login flow, which saves it to the DB and calls setConnection().
 *   2. Env vars (META_ACCESS_TOKEN etc.) as a fallback for the old manual setup.
 *
 * OAuth wins when both are present, so once you connect in-app you never touch
 * the Railway token variable again.
 */
const VERSION = process.env.META_API_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION}`;

// Populated on boot from the settings table, and whenever OAuth completes.
let connection = {
  accessToken: process.env.META_ACCESS_TOKEN || null,
  adAccountId: process.env.META_AD_ACCOUNT_ID || null,
  pageId: process.env.META_PAGE_ID || null,
  pageToken: null,
  name: null,
  connectedAt: null
};

/** Called on boot with whatever was saved, and by the OAuth callback. */
export function setConnection(next = {}) {
  connection = { ...connection, ...next };
}

export function getConnection() {
  const { accessToken, ...safe } = connection;
  return { ...safe, hasToken: Boolean(accessToken) };
}

export function metaConfigured() {
  return Boolean(connection.accessToken && connection.adAccountId);
}

function currentToken() {
  return connection.accessToken;
}

function accountId() {
  const id = connection.adAccountId || '';
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function graph(pathname, { method = 'GET', params = {}, body, token } = {}) {
  const useToken = token || currentToken();
  if (!useToken) throw new Error('Meta is not connected. Open the Connect tab and sign in with Facebook.');
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
    const msg = json?.error?.message || `Meta API returned ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/** Every campaign in the ad account, with 30-day performance merged in. */
export async function listCampaigns() {
  const fields = 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time';
  const campaigns = await graph(`${accountId()}/campaigns`, {
    params: { fields, limit: 200 }
  });

  const insights = await graph(`${accountId()}/insights`, {
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

/** Ad sets inside one campaign, so budgets can be edited at the right level. */
export async function listAdSets(campaignId) {
  const data = await graph(`${campaignId}/adsets`, {
    params: {
      fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,targeting',
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
export async function setStatus(objectId, status) {
  return graph(objectId, { method: 'POST', params: { status } });
}

/** Budget is passed in rupees/dollars; Meta wants minor units. */
export async function setDailyBudget(objectId, amount) {
  return graph(objectId, {
    method: 'POST',
    params: { daily_budget: Math.round(Number(amount) * 100) }
  });
}

export async function renameObject(objectId, name) {
  return graph(objectId, { method: 'POST', params: { name } });
}

/** Every lead-gen form attached to the page. Uses the page token when we have one. */
export async function listLeadForms(pageId) {
  const id = pageId || connection.pageId;
  if (!id) throw new Error('No Facebook page selected. Pick one on the Connect tab.');
  const data = await graph(`${id}/leadgen_forms`, {
    params: { fields: 'id,name,status,leads_count,questions', limit: 200 },
    token: connection.pageToken || undefined
  });
  return (data.data || []).map((f) => ({
    id: f.id,
    name: f.name,
    status: f.status,
    leads_count: f.leads_count,
    fields: (f.questions || []).map((q) => q.type)
  }));
}

/* ---------- helpers for the in-app campaign builder (all reads except createLeadForm) ---------- */

/** City / region type-ahead. Returns Meta geo keys the ad-set targeting needs. */
export async function searchGeo(qStr) {
  if (!qStr || !qStr.trim()) return [];
  const data = await graph('search', {
    params: {
      type: 'adgeolocation',
      q: qStr.trim(),
      location_types: JSON.stringify(['city', 'region']),
      limit: 8
    }
  });
  return (data.data || []).map((g) => ({
    key: g.key,
    name: g.name,
    type: g.type,
    region: g.region || null,
    country_code: g.country_code || null
  }));
}

/** Interest type-ahead for the Advanced targeting section. */
export async function searchInterests(qStr) {
  if (!qStr || !qStr.trim()) return [];
  const data = await graph('search', { params: { type: 'adinterest', q: qStr.trim(), limit: 10 } });
  return (data.data || []).map((i) => ({
    id: i.id,
    name: i.name,
    audience_size: i.audience_size_lower_bound || i.audience_size || null,
    path: i.path || []
  }));
}

/** Best-effort resolve the WhatsApp number leads should message. */
export async function resolveWhatsappNumber() {
  const pageId = connection.pageId;
  if (pageId) {
    try {
      const p = await graph(`${pageId}`, {
        params: { fields: 'connected_whatsapp_number,whatsapp_number' },
        token: connection.pageToken || undefined
      });
      const n = p.connected_whatsapp_number || p.whatsapp_number;
      if (n) return { number: String(n).replace(/\D/g, ''), source: 'page' };
    } catch {
      /* page has no WA field / no permission — fall through */
    }
  }
  if (process.env.WA_DISPLAY_NUMBER) {
    return { number: String(process.env.WA_DISPLAY_NUMBER).replace(/\D/g, ''), source: 'env' };
  }
  try {
    const { webStatus } = await import('./whatsappWeb.js');
    const me = webStatus()?.me;
    if (me) return { number: String(me).replace(/\D/g, ''), source: 'whatsapp-web' };
  } catch {
    /* Baileys not running */
  }
  return { number: null, source: null };
}

/** Page info the form flow needs: id, name, and whether lead terms are accepted. */
export async function getPageInfo() {
  const pageId = connection.pageId;
  if (!pageId) return { page_id: null, page_name: null, leadgen_tos_accepted: null };
  try {
    const p = await graph(`${pageId}`, {
      params: { fields: 'id,name,leadgen_tos_accepted' },
      token: connection.pageToken || undefined
    });
    return { page_id: p.id, page_name: p.name, leadgen_tos_accepted: !!p.leadgen_tos_accepted };
  } catch {
    return { page_id: pageId, page_name: connection.name || null, leadgen_tos_accepted: null };
  }
}

const QUESTION_TYPE = { name: 'FULL_NAME', phone: 'PHONE', email: 'EMAIL', city: 'CITY' };

/**
 * Create an Instant Form on the connected Page. This is the ONE Graph *write*
 * the app makes — Meta's Ads MCP connector has no lead-form tool, and a
 * shopkeeper should not have to open Ads Manager. The form costs nothing, is
 * deletable, and the page token already carries pages_manage_ads. Spec fields
 * come straight from the plain-language mini-builder.
 */
export async function createLeadForm(spec = {}) {
  const pageId = connection.pageId;
  if (!pageId) throw new Error('Connect a Facebook page first (Facebook tab).');
  if (!connection.pageToken) throw new Error('Missing page access token — re-pick your page on the Facebook tab.');

  const wanted = Array.isArray(spec.fields) && spec.fields.length ? spec.fields : ['name', 'phone'];
  const questions = [...new Set(wanted)].map((f) => ({ type: QUESTION_TYPE[f] || 'FULL_NAME' }));
  if (!questions.some((q) => q.type === 'PHONE')) questions.push({ type: 'PHONE' });

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

  const res = await graph(`${pageId}/leadgen_forms`, { method: 'POST', body, token: connection.pageToken });
  return { id: res.id, name: body.name };
}

/** Raw leads for one form, newest first. */
export async function fetchFormLeads(formId, since) {
  const params = { fields: 'id,created_time,field_data,campaign_id,campaign_name,form_id', limit: 200 };
  if (since) params.filtering = JSON.stringify([
    { field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(new Date(since).getTime() / 1000) }
  ]);
  const data = await graph(`${formId}/leads`, {
    params,
    token: connection.pageToken || undefined
  });
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
