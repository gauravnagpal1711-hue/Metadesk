/**
 * Multi-tenant isolation test.
 *
 *   DATABASE_URL="postgres://…"  node scripts/isolation-test.mjs
 *
 * Boots the real Express app against the given database, signs up two users,
 * has each create a row in every tenant-scoped table through the real HTTP
 * endpoints, then asserts that neither user can see or mutate the other's data.
 * Exits non-zero if any check fails. Safe to re-run (it cleans its own users).
 *
 * DO NOT point this at the production database.
 */
process.env.ADS_DESK_NO_BOOT = '1';
process.env.SIGNUP_ENABLED = 'true';
process.env.APP_USERNAME = process.env.APP_USERNAME || 'owner';
process.env.APP_PASSWORD = process.env.APP_PASSWORD || 'ownerpass123';
delete process.env.NODE_ENV; // keep session cookies non-Secure over http

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL first (a throwaway DB — never production).');
  process.exit(2);
}

const { initDb, q, pool } = await import('../server/db.js');
const { app } = await import('../server/index.js');

await initDb();

// ---- clean slate ---------------------------------------------------------
for (const u of ['isoA', 'isoB']) {
  await q('DELETE FROM users WHERE username = $1', [u]); // cascades to all tenant rows
}

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (label) => console.log(`  ok  ${label}`);
const bad = (label, detail) => { failures++; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); };
function expect(cond, label, detail) { cond ? ok(label) : bad(label, detail); }

async function call(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json (csv, html) */ }
  return { status: res.status, json, text, res };
}

async function signup(username) {
  const res = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'passw0rd!!', business_name: `${username} Co` })
  });
  if (res.status !== 200) throw new Error(`signup ${username} failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.getSetCookie?.() || [res.headers.get('set-cookie')].filter(Boolean);
  const token = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('mam_token='));
  if (!token) throw new Error(`no session cookie for ${username}`);
  return token;
}

const A = await signup('isoA');
const B = await signup('isoB');
console.log('signed up isoA, isoB\n');

// ---- each user creates one row in every tenant-scoped table -------------
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seed(cookie, tag) {
  const out = {};

  const cr = await call(cookie, 'POST', '/api/creatives/upload', { imageData: PIX, headline: `${tag} creative` });
  out.creativeId = cr.json.id;
  await call(cookie, 'PATCH', `/api/creatives/${out.creativeId}`, {
    status: 'approved',
    destination_type: 'whatsapp',
    destination_value: '919000000000',
    campaign_defaults: { name: `${tag} campaign`, daily_budget: 300, audience: { location_mode: 'cities', locations: [{ key: '1', name: 'Mumbai' }] } }
  });
  const briefs = await call(cookie, 'GET', '/api/campaign-briefs');
  out.briefId = briefs.json[0]?.id;

  const ed = await call(cookie, 'POST', '/api/campaign-edits', { meta_campaign_id: `${tag}_camp`, campaign_name: `${tag} edit`, changes: { budget: 5 } });
  out.editId = ed.json.id;

  const st = await call(cookie, 'POST', '/api/leads/stages', { name: `${tag} stage` });
  out.stageId = st.json.id;

  const ld = await call(cookie, 'POST', '/api/leads', { full_name: `${tag} lead`, phone: `9199999${tag === 'A' ? '1111' : '2222'}` });
  out.leadId = ld.json.id;

  const vw = await call(cookie, 'POST', '/api/leads/views', { name: `${tag} view`, filters: {} });
  out.viewId = vw.json.id;

  const tk = await call(cookie, 'POST', `/api/leads/${out.leadId}/tasks`, { title: `${tag} task` });
  out.taskId = tk.json.id;

  const rm = await call(cookie, 'POST', `/api/leads/${out.leadId}/remarks`, { body: `${tag} remark` });
  out.remarkId = rm.json.id;

  await call(cookie, 'POST', `/api/leads/${out.leadId}/messages`, { body: `${tag} message` });

  await call(cookie, 'PATCH', '/api/whatsapp/settings', { onlyExistingLeads: tag === 'A' });
  await call(cookie, 'POST', '/api/whatsapp/templates', { label: `${tag} tpl`, body: `Hi from ${tag}` });
  await call(cookie, 'POST', '/api/meta/shop-location', { lat: 19.07, lng: 72.87, label: `${tag} shop` });

  // a campaign row (sync needs Meta, so insert straight to the table for this user)
  const { rows: u } = await q('SELECT id FROM users WHERE username = $1', [`iso${tag}`]);
  await q(
    `INSERT INTO campaigns (id, user_id, name, status) VALUES ($1, $2, $3, 'PAUSED')
     ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [`${tag}_campaign_row`, u[0].id, `${tag} campaign row`]
  );

  return out;
}

const a = await seed(A, 'A');
const b = await seed(B, 'B');
console.log('seeded data for both users\n');

// ---- READ isolation: B must not see any of A's rows, and vice versa ----
async function listContains(cookie, path, pred, pick = (r) => r) {
  const { json } = await call(cookie, 'GET', path);
  const arr = Array.isArray(json) ? json : (json?.rows || json?.campaigns || []);
  return arr.map(pick).some(pred);
}

console.log('READ isolation');
expect(!(await listContains(B, '/api/creatives', (r) => r.id === a.creativeId)), 'B cannot list A creative');
expect(!(await listContains(A, '/api/creatives', (r) => r.id === b.creativeId)), 'A cannot list B creative');
expect(!(await listContains(B, '/api/campaign-briefs', (r) => r.id === a.briefId)), 'B cannot list A brief');
expect(!(await listContains(B, '/api/campaign-edits', (r) => r.id === a.editId)), 'B cannot list A edit');
expect(!(await listContains(B, '/api/campaigns', (r) => r.id === 'A_campaign_row')), 'B cannot list A campaign');
expect(!(await listContains(A, '/api/campaigns', (r) => r.id === 'B_campaign_row')), 'A cannot list B campaign');
expect(!(await listContains(B, '/api/leads/stages', (r) => r.id === a.stageId)), 'B cannot list A stage');
expect(!(await listContains(B, '/api/leads/views', (r) => r.id === a.viewId)), 'B cannot list A view');
expect(!(await listContains(B, '/api/leads/tasks', (r) => r.id === a.taskId)), 'B cannot list A task');

{
  const board = await call(B, 'GET', '/api/leads/board');
  expect(!board.json.leads.some((l) => l.id === a.leadId), 'B board excludes A lead');
  expect(!board.json.stages.some((s) => s.id === a.stageId), 'B board excludes A stage');
}
{
  const list = await call(B, 'GET', '/api/leads/list');
  expect(!list.json.rows.some((l) => l.id === a.leadId), 'B /list excludes A lead');
}
{
  const one = await call(B, 'GET', `/api/leads/${a.leadId}`);
  expect(one.status === 404, 'B GET A lead detail -> 404', `got ${one.status}`);
}
{
  const tpls = await call(B, 'GET', '/api/whatsapp/templates');
  expect(!tpls.json.some((t) => t.label === 'A tpl'), 'B templates exclude A template');
  expect(tpls.json.some((t) => t.label === 'B tpl'), 'B sees own template');
}
{
  const shop = await call(B, 'GET', '/api/meta/shop-location');
  expect(shop.json?.label === 'B shop', 'B shop-location is B\'s', JSON.stringify(shop.json));
  const sett = await call(B, 'GET', '/api/whatsapp/settings');
  expect(sett.json.onlyExistingLeads === false, 'B wa settings are B\'s (not A\'s true)');
}
{
  const an = await call(B, 'GET', '/api/leads/analytics');
  expect(an.json.total === 1, 'B analytics counts only B leads', `total=${an.json.total}`);
}

// ---- WRITE isolation: B cannot mutate/delete A's rows by id -----------
console.log('\nWRITE isolation');
async function cannotWrite(method, path, body, label, verifyStillThere) {
  const r = await call(B, method, path, body);
  expect(r.status === 404 || r.status === 403, label, `status ${r.status}`);
  if (verifyStillThere) expect(await verifyStillThere(), `${label} (row intact)`);
}
await cannotWrite('PATCH', `/api/leads/${a.leadId}`, { full_name: 'HACKED' }, 'B cannot PATCH A lead',
  async () => (await q('SELECT full_name FROM leads WHERE id=$1', [a.leadId])).rows[0]?.full_name === 'A lead');
await cannotWrite('DELETE', `/api/leads/${a.leadId}`, undefined, 'B cannot DELETE A lead',
  async () => (await q('SELECT 1 FROM leads WHERE id=$1', [a.leadId])).rows.length === 1);
await cannotWrite('PATCH', `/api/campaign-briefs/${a.briefId}`, { status: 'queued' }, 'B cannot PATCH A brief',
  async () => (await q('SELECT status FROM campaign_briefs WHERE id=$1', [a.briefId])).rows[0]?.status !== 'queued');
await cannotWrite('DELETE', `/api/campaign-briefs/${a.briefId}`, undefined, 'B cannot DELETE A brief',
  async () => (await q('SELECT 1 FROM campaign_briefs WHERE id=$1', [a.briefId])).rows.length === 1);
await cannotWrite('PATCH', `/api/creatives/${a.creativeId}`, { label: 'HACKED' }, 'B cannot PATCH A creative',
  async () => (await q('SELECT label FROM creatives WHERE id=$1', [a.creativeId])).rows[0]?.label !== 'HACKED');
await cannotWrite('PATCH', `/api/leads/stages/${a.stageId}`, { name: 'HACKED' }, 'B cannot PATCH A stage',
  async () => (await q('SELECT name FROM stages WHERE id=$1', [a.stageId])).rows[0]?.name === 'A stage');
await cannotWrite('DELETE', `/api/leads/views/${a.viewId}`, undefined, 'B cannot DELETE A view',
  async () => (await q('SELECT 1 FROM saved_views WHERE id=$1', [a.viewId])).rows.length === 1);
await cannotWrite('PATCH', `/api/leads/tasks/${a.taskId}`, { done: true }, 'B cannot PATCH A task',
  async () => (await q('SELECT done FROM tasks WHERE id=$1', [a.taskId])).rows[0]?.done === false);
await cannotWrite('PATCH', `/api/campaign-edits/${a.editId}`, { status: 'applied' }, 'B cannot PATCH A edit',
  async () => (await q('SELECT status FROM campaign_edits WHERE id=$1', [a.editId])).rows[0]?.status !== 'applied');
await cannotWrite('PATCH', `/api/campaigns/A_campaign_row`, { name: 'HACKED' }, 'B cannot PATCH A campaign',
  async () => (await q('SELECT name FROM campaigns WHERE id=$1', ['A_campaign_row'])).rows[0]?.name !== 'HACKED');
await cannotWrite('POST', `/api/leads/${a.leadId}/remarks`, { body: 'x' }, 'B cannot add remark to A lead');
await cannotWrite('POST', `/api/leads/${a.leadId}/messages`, { body: 'x' }, 'B cannot message A lead');
await cannotWrite('POST', `/api/leads/${a.leadId}/suggest-replies`, undefined, 'B cannot suggest-replies on A lead');

// ---- Meta connection isolation --------------------------------------
console.log('\nMeta connection isolation');
{
  const { rows: ua } = await q('SELECT id FROM users WHERE username = $1', ['isoA']);
  await q(
    `INSERT INTO meta_connections (user_id, access_token, fb_name, ad_account_id, page_id)
     VALUES ($1, 'A-secret-token', 'A FB', 'act_111', 'pageA')
     ON CONFLICT (user_id) DO UPDATE SET access_token = EXCLUDED.access_token`,
    [ua[0].id]
  );
  const sa = await call(A, 'GET', '/api/facebook/status');
  const sb = await call(B, 'GET', '/api/facebook/status');
  expect(sa.json.connection?.hasToken === true && sa.json.connection?.adAccountId === 'act_111', 'A facebook/status shows A connection');
  expect(!sb.json.connection?.hasToken && !sb.json.connection?.adAccountId, 'B facebook/status shows NO connection', JSON.stringify(sb.json.connection));
  const ca = await call(A, 'GET', '/api/campaigns/status');
  const cb = await call(B, 'GET', '/api/campaigns/status');
  expect(ca.json.account === 'act_111', 'A campaigns/status account is A\'s');
  expect(cb.json.connected === false && !cb.json.account, 'B campaigns/status not connected');
  // token never leaves the server
  expect(!JSON.stringify(sa.json).includes('A-secret-token'), 'A facebook/status does not leak the access token');
}

// ---- WhatsApp connection isolation ---------------------------------
console.log('\nWhatsApp connection isolation');
{
  await call(A, 'PATCH', '/api/whatsapp/cloud', { phoneNumberId: 'PN_A_123', token: 'wa-secret-A', verifyToken: 'verifyA' });
  const ca = await call(A, 'GET', '/api/whatsapp/cloud');
  const cb = await call(B, 'GET', '/api/whatsapp/cloud');
  expect(ca.json.phoneNumberId === 'PN_A_123' && ca.json.hasToken === true, 'A whatsapp/cloud shows A config');
  expect(!cb.json.phoneNumberId && !cb.json.hasToken, 'B whatsapp/cloud shows nothing', JSON.stringify(cb.json));
  expect(!JSON.stringify(ca.json).includes('wa-secret-A'), 'A whatsapp/cloud does not leak the token');
  const sa = await call(A, 'GET', '/api/whatsapp/status');
  const sb = await call(B, 'GET', '/api/whatsapp/status');
  expect(sa.json.cloud.connected === true && sa.json.cloud.phoneNumberId === 'PN_A_123', 'A whatsapp/status cloud is A\'s');
  expect(sb.json.cloud.connected === false && !sb.json.cloud.phoneNumberId, 'B whatsapp/status cloud not connected');
  // webhook routing: A's phone_number_id resolves to A, an unknown one to nobody
  const { userIdForPhoneNumberId, verifyTokenMatches } = await import('../server/services/waConnection.js');
  const { rows: ua } = await q('SELECT id FROM users WHERE username = $1', ['isoA']);
  expect((await userIdForPhoneNumberId('PN_A_123')) === ua[0].id, 'webhook routes PN_A_123 -> user A');
  expect((await userIdForPhoneNumberId('PN_UNKNOWN')) === null, 'webhook routes unknown phone_number_id -> nobody');
  expect((await verifyTokenMatches('verifyA')) === true, 'verify token A matches');
  expect((await verifyTokenMatches('nope')) === false, 'bogus verify token rejected');
}

// ---- sanity: A still sees its own stuff -------------------------------
console.log('\nself-access sanity');
expect(await listContains(A, '/api/creatives', (r) => r.id === a.creativeId), 'A sees own creative');
expect(await listContains(A, '/api/leads/views', (r) => r.id === a.viewId), 'A sees own view');
{
  const one = await call(A, 'GET', `/api/leads/${a.leadId}`);
  expect(one.status === 200 && one.json.lead.id === a.leadId, 'A sees own lead detail');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED ✓' : `${failures} CHECK(S) FAILED ✗`}`);

server.close();
await pool.end();
process.exit(failures === 0 ? 0 : 1);
