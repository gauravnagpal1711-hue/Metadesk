/**
 * Facebook Login (OAuth) flow.
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

// pages_manage_ads is required to read leadgen forms / leads on a Page via the
// Marketing API (Graph error "(#200) Requires pages_manage_ads permission").
// It was missing here, so tokens issued by login never had it even though the
// app itself had the permission enabled.
const SCOPES = [
    'ads_management',
    'ads_read',
    'leads_retrieval',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_ads',
    'business_management',
  ].join(',');

export function oauthConfigured() {
    return Boolean(process.env.FB_APP_ID && process.env.FB_APP_SECRET && process.env.FB_LOGIN_CONFIG_ID);
}

function redirectUri() {
    const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    return `${base}/api/facebook/callback`;
}

/** URL we send the browser to so the user can approve. `state` guards against CSRF.
 *
 * The Meta app only has the "Facebook Login for Business" product enabled (not
 * classic Facebook Login), which requires a `config_id` naming a saved Login
 * Configuration instead of a raw `scope` param — passing `scope` alone gets
 * rejected with a "Feature Unavailable" screen. The configured permissions must
 * match SCOPES above (kept for exchangeCode's docs/reference).
 */
export function loginUrl(state) {
    const url = new URL(OAUTH);
    url.searchParams.set('client_id', process.env.FB_APP_ID);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('state', state);
    url.searchParams.set('config_id', process.env.FB_LOGIN_CONFIG_ID);
    url.searchParams.set('response_type', 'code');
    return url.toString();
}

/** Exchange the short code for a short token, then upgrade it to a long-lived one. */
export async function exchangeCode(code) {
    const shortRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
          client_id: process.env.FB_APP_ID,
          client_secret: process.env.FB_APP_SECRET,
          redirect_uri: redirectUri(),
          code,
    }));
    const shortJson = await shortRes.json();
    if (!shortRes.ok) throw new Error(shortJson.error?.message || 'Could not exchange the login code.');

  const longRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.FB_APP_ID,
        client_secret: process.env.FB_APP_SECRET,
        fb_exchange_token: shortJson.access_token,
  }));
    const longJson = await longRes.json();
    if (!longRes.ok) throw new Error(longJson.error?.message || 'Could not extend the token.');

  return {
        accessToken: longJson.access_token,
        // Long-lived user tokens usually last ~60 days.
        expiresIn: longJson.expires_in || null,
  };
}

/** Who is this token for. */
export async function fetchMe(token) {
    const res = await fetch(`${GRAPH}/me?fields=id,name&access_token=${token}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Could not read the profile.');
    return json;
}

/** Ad accounts this user can manage. */
export async function fetchAdAccounts(token) {
    const res = await fetch(`${GRAPH}/me/adaccounts?fields=account_id,name,account_status&limit=200&access_token=${token}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Could not list ad accounts.');
    return json.data;
}

/** Pages this user manages, each with its own page token (handy for lead retrieval). */
export async function fetchPages(token) {
    const res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=200&access_token=${token}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Could not list pages.');
    return json.data;
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD']);

/** Money fields Meta returns in minor units (e.g. paise) -> major-unit numbers. */
export async function fetchAdBalance(token, adAccountId) {
    const act = `act_${String(adAccountId).replace(/^act_/, '')}`;
    const fields = 'name,currency,account_status,balance,amount_spent,spend_cap,is_prepay_account,funding_source_details{id,display_string,type}';
    const res = await fetch(`${GRAPH}/${act}?fields=${fields}&access_token=${token}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Could not read the ad account balance.');
    const div = ZERO_DECIMAL.has(json.currency) ? 1 : 100;
    const money = (v) => (v == null || v === '' ? null : Number(v) / div);
    const spendCap = money(json.spend_cap);
    return {
        name: json.name,
        currency: json.currency,
        accountStatus: Number(json.account_status),
        isPrepay: !!json.is_prepay_account,
        // For postpaid accounts `balance` is the amount owed and not yet charged.
        amountOwed: money(json.balance),
        amountSpent: money(json.amount_spent),
        spendCap: spendCap || null,
        // Prepaid accounts only expose the available funds inside this string.
        fundingLabel: json.funding_source_details?.display_string || null,
        fundingType: json.funding_source_details?.type ?? null,
    };
}

/**
 * One batched read of everything the onboarding checklist inspects: the profile,
 * ad accounts (with billing/status fields) and Pages (with the caller's task
 * list). Each sub-request is tolerated on its own so a single permission gap
 * doesn't blank the whole checklist.
 */
export async function fetchOnboardingSnapshot(token) {
    const adFields = 'account_id,name,account_status,disable_reason,currency,timezone_name,funding_source,funding_source_details{id,display_string,type}';
    const [meRes, adRes, pageRes] = await Promise.all([
        fetch(`${GRAPH}/me?fields=id,name&access_token=${token}`),
        fetch(`${GRAPH}/me/adaccounts?fields=${adFields}&limit=200&access_token=${token}`),
        fetch(`${GRAPH}/me/accounts?fields=id,name,tasks&limit=200&access_token=${token}`),
    ]);
    const [me, ad, page] = await Promise.all([meRes.json(), adRes.json(), pageRes.json()]);
    return {
        me: meRes.ok ? me : null,
        adAccounts: adRes.ok ? (ad.data || []) : [],
        pages: pageRes.ok ? (page.data || []) : [],
        errors: [
            !meRes.ok && (me.error?.message || 'profile read failed'),
            !adRes.ok && (ad.error?.message || 'ad-account read failed'),
            !pageRes.ok && (page.error?.message || 'page read failed'),
        ].filter(Boolean),
    };
}
