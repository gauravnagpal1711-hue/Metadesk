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
    const leadAction = (i.actions || []).find((a) => a.action_type === 'lead');
    const leadCost = (i.cost_per_action_type || []).find((a) => a.action_type === 'lead');
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
    params: { fields: 'id,name,status,leads_count', limit: 200 },
    token: connection.pageToken || undefined
  });
  return data.data || [];
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
