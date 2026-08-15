/**
 * Facebook Login (OAuth) flow.
 *
 * Instead of pasting a system-user token into Railway, the user clicks "Connect
 * Facebook", approves permissions in Facebook's own popup, and we exchange the
 * returned code for a long-lived token. That token — plus the chosen ad account
 * and page — is saved in the settings table via saveMetaConnection().
 *
 * Requires FB_APP_ID and FB_APP_SECRET. PUBLIC_URL should be the app's own https
 * origin so the redirect_uri matches what's registered in the Meta app.
 */
const VERSION = process.env.META_API_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const OAUTH = `https://www.facebook.com/${VERSION}/dialog/oauth`;

const SCOPES = [
  'ads_management',
  'ads_read',
  'leads_retrieval',
  'pages_show_list',
  'pages_read_engagement',
  'business_management'
].join(',');

export function oauthConfigured() {
  return Boolean(process.env.FB_APP_ID && process.env.FB_APP_SECRET);
}

function redirectUri() {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/api/facebook/callback`;
}

/** URL we send the browser to so the user can approve. `state` guards against CSRF. */
export function loginUrl(state) {
  const url = new URL(OAUTH);
  url.searchParams.set('client_id', process.env.FB_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

/** Exchange the short code for a short token, then upgrade it to a long-lived one. */
export async function exchangeCode(code) {
  const shortRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.FB_APP_ID,
        client_secret: process.env.FB_APP_SECRET,
        redirect_uri: redirectUri(),
        code
      })
  );
  const shortJson = await shortRes.json();
  if (!shortRes.ok) throw new Error(shortJson?.error?.message || 'Could not exchange the login code.');

  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.FB_APP_ID,
        client_secret: process.env.FB_APP_SECRET,
        fb_exchange_token: shortJson.access_token
      })
  );
  const longJson = await longRes.json();
  if (!longRes.ok) throw new Error(longJson?.error?.message || 'Could not extend the token.');

  return {
    accessToken: longJson.access_token,
    // Long-lived user tokens usually last ~60 days.
    expiresIn: longJson.expires_in || null
  };
}

/** Who is this token for. */
export async function fetchMe(token) {
  const res = await fetch(`${GRAPH}/me?fields=id,name&access_token=${token}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Could not read the profile.');
  return json;
}

/** Ad accounts this user can manage. */
export async function fetchAdAccounts(token) {
  const res = await fetch(
    `${GRAPH}/me/adaccounts?fields=account_id,name,account_status&limit=200&access_token=${token}`
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Could not list ad accounts.');
  return json.data || [];
}

/** Pages this user manages, each with its own page token (handy for lead retrieval). */
export async function fetchPages(token) {
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token&limit=200&access_token=${token}`
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'Could not list pages.');
  return json.data || [];
}
