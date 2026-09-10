import crypto from 'node:crypto';
import express from 'express';
import {
  oauthConfigured,
  loginUrl,
  exchangeCode,
  fetchMe,
  fetchAdAccounts,
  fetchPages,
  fetchOnboardingSnapshot
} from '../services/facebookAuth.js';
import { loadConnection, saveConnection, clearConnection, safeConn, resolveWhatsappNumber } from '../services/meta.js';

export const facebookRouter = express.Router();

// Short-lived states to guard the OAuth round trip against CSRF. value: { userId, ts }
const pendingStates = new Map();

facebookRouter.get('/status', async (req, res, next) => {
  try {
    res.json({
      oauthConfigured: oauthConfigured(),
      connection: safeConn(await loadConnection(req.user.id))
    });
  } catch (e) {
    next(e);
  }
});

/* ---------- onboarding checklist ---------- */

const FB = 'https://www.facebook.com';
// account_status: 1 ACTIVE, 2 DISABLED, 3 UNSETTLED, 7 PENDING_RISK_REVIEW,
// 8 PENDING_SETTLEMENT, 9 IN_GRACE_PERIOD, 100 PENDING_CLOSURE, 101 CLOSED.
const AD_STATUS_OK = new Set([1, 201]);
const AD_STATUS_LABEL = {
  2: 'This ad account is disabled by Meta.',
  3: 'This ad account has an unsettled balance.',
  7: 'Meta is reviewing this ad account for risk.',
  8: 'This ad account is pending settlement.',
  9: 'This ad account is past due (grace period).',
  100: 'This ad account is pending closure.',
  101: 'This ad account is closed.'
};
const bareActId = (id) => String(id || '').replace(/^act_/, '');

/**
 * Inspects the connected user's Meta setup and returns an ordered checklist.
 * Each step is { key, title, help, status: done|todo|warn, action }.
 * action is null, { type:'meta', url, label } (opens Meta in a popup), or
 * { type:'app', target, label } (handled inside the app).
 */
facebookRouter.get('/onboarding', async (req, res, next) => {
  try {
    const oauthOk = oauthConfigured();
    const conn = await loadConnection(req.user.id);

    const signIn = {
      key: 'signin',
      title: 'Connect your Facebook',
      oneLiner: conn.accessToken
        ? `Connected${conn.name ? ` as ${conn.name}` : ''}.`
        : 'Log in with the Facebook account you use for your shop.',
      why: 'This lets Ads Desk make and manage ads for you. You stay in charge — you can disconnect any time.',
      how: oauthOk
        ? [
            'Tap the button below.',
            'Log into Facebook and tap "Allow" on every screen.',
            'The window closes on its own when it is done.'
          ]
        : ['Facebook login is not switched on for this app yet. Contact support.'],
      status: conn.accessToken ? 'done' : 'todo',
      action: conn.accessToken || !oauthOk ? null : { type: 'app', target: 'signin', label: 'Continue with Facebook' }
    };

    if (!conn.accessToken) {
      return res.json({ connected: false, ready: false, steps: [signIn], errors: [] });
    }

    const snap = await fetchOnboardingSnapshot(conn.accessToken);

    const anyPage = snap.pages.length > 0;
    const selectedPage = snap.pages.find((p) => p.id === conn.pageId);
    const firstPageName = (selectedPage || snap.pages[0])?.name;
    const canAdvertisePage = !selectedPage
      || (selectedPage.tasks || []).some((t) => t === 'ADVERTISE' || t === 'MANAGE');

    const anyAdAccount = snap.adAccounts.length > 0;
    const activeAdAccounts = snap.adAccounts.filter((a) => AD_STATUS_OK.has(Number(a.account_status)));
    const selectedAdAccount = snap.adAccounts.find(
      (a) => bareActId(a.account_id) === bareActId(conn.adAccountId)
    );
    const selectedActIsOk = !selectedAdAccount || AD_STATUS_OK.has(Number(selectedAdAccount.account_status));
    const hasFunding = !!(selectedAdAccount?.funding_source || selectedAdAccount?.funding_source_details?.id);
    const billingActId = bareActId(conn.adAccountId || selectedAdAccount?.account_id || activeAdAccounts[0]?.account_id);

    const wa = await resolveWhatsappNumber(req.user.id).catch(() => ({ number: null }));

    const steps = [signIn];

    steps.push({
      key: 'page',
      title: 'Get a Facebook Page for your shop',
      oneLiner: anyPage
        ? `Found your Page${firstPageName ? `: ${firstPageName}` : ''}.`
        : "You don't have a shop Page yet — it's free and takes a minute.",
      why: 'Every ad runs from a Page. This is your shop on Facebook, separate from your personal profile.',
      how: [
        'Tap "Create a Page on Meta" — a Facebook window opens.',
        'Type your shop name and pick a category (like "Beauty salon" or "Furniture shop").',
        'Tap Create Page. You can skip the photo and description steps.',
        'Close that window and come back — this list updates on its own.'
      ],
      status: anyPage ? 'done' : 'todo',
      action: anyPage ? null : { type: 'meta', url: `${FB}/pages/create`, label: 'Create a Page on Meta' }
    });

    steps.push({
      key: 'select_page',
      title: 'Pick your Page here',
      oneLiner: !conn.pageId
        ? 'Tell Ads Desk which Page to use.'
        : !canAdvertisePage
          ? `You can see "${selectedPage?.name || 'this Page'}" but cannot run ads on it.`
          : `Using ${selectedPage?.name || 'your Page'}.`,
      why: canAdvertisePage
        ? 'If you have more than one Page, choose the one for this shop.'
        : 'You need the Admin (or Advertiser) role on this Page. Ask whoever created it to add you on Facebook, then check again.',
      how: [
        'Scroll down to the "Choose account & page" box.',
        'Pick your Page from the dropdown.',
        'Tap "Save & start syncing".'
      ],
      status: !conn.pageId ? 'todo' : canAdvertisePage ? 'done' : 'warn',
      action: !anyPage ? null : { type: 'app', target: 'picker', label: 'Go to the picker' }
    });

    steps.push({
      key: 'adaccount',
      title: 'Get an advertising account',
      oneLiner: !anyAdAccount
        ? "Facebook makes one for you the first time you open Ads Manager."
        : activeAdAccounts.length
          ? 'Your advertising account is ready.'
          : 'Your advertising account needs attention on Facebook.',
      why: 'This is the account Facebook uses to run and bill your ads. You usually get one automatically — you just need to open Ads Manager once so it appears here.',
      how: activeAdAccounts.length
        ? ['Nothing to do — this is already set.']
        : [
            'Tap "Open Meta Ads Manager" — a window opens.',
            'Let it load fully (you may need to accept Facebook\'s terms once).',
            'Close the window and come back here.'
          ],
      status: !anyAdAccount ? 'todo' : activeAdAccounts.length ? 'done' : 'warn',
      action: anyAdAccount && activeAdAccounts.length
        ? null
        : { type: 'meta', url: `${FB}/adsmanager/`, label: 'Open Meta Ads Manager' }
    });

    steps.push({
      key: 'select_adaccount',
      title: 'Pick your advertising account here',
      oneLiner: !conn.adAccountId
        ? 'Tell Ads Desk which account to spend from.'
        : !selectedActIsOk
          ? (AD_STATUS_LABEL[Number(selectedAdAccount?.account_status)] || 'This account is not usable right now.')
          : `Using ${selectedAdAccount?.name || 'your account'}.`,
      why: selectedActIsOk
        ? 'This is the account your ad spend is charged to.'
        : 'Open Meta Ads Manager to sort this out with Facebook, then check again here.',
      how: [
        'Scroll down to the "Choose account & page" box.',
        'Pick your advertising account from the dropdown.',
        'Tap "Save & start syncing".'
      ],
      status: !conn.adAccountId ? 'todo' : selectedActIsOk ? 'done' : 'warn',
      action: !anyAdAccount ? null : { type: 'app', target: 'picker', label: 'Go to the picker' }
    });

    steps.push({
      key: 'payment',
      title: 'Add a way to pay',
      oneLiner: hasFunding
        ? `Payment method saved${selectedAdAccount?.funding_source_details?.display_string ? `: ${selectedAdAccount.funding_source_details.display_string}` : ''}.`
        : 'Add a card or UPI so Facebook can charge for your ads.',
      why: 'Ads Desk can build your campaign without this, but it cannot go live until Facebook has a way to bill you. For your security, Facebook only takes payment details on its own page — never inside Ads Desk.',
      how: [
        'Tap "Add payment on Meta" — your billing page opens.',
        'Add a card, UPI, or another method Facebook offers in your country.',
        'Close the window and check back here.'
      ],
      status: !conn.adAccountId ? 'todo' : hasFunding ? 'done' : 'todo',
      action: hasFunding
        ? null
        : {
            type: 'meta',
            url: billingActId
              ? `${FB}/ads/manager/account_settings/account_billing/?act=${billingActId}`
              : `${FB}/adsmanager/`,
            label: 'Add payment on Meta'
          }
    });

    steps.push({
      key: 'whatsapp',
      title: 'Connect your WhatsApp number',
      oneLiner: wa.number
        ? `Customers will message ${wa.number}.`
        : 'The number customers reach when they tap your ad.',
      why: 'Your ads send people straight into a WhatsApp chat. Use the number you actually reply on for your shop.',
      how: [
        'Open the WhatsApp tab (button below).',
        'Scan the QR code with the phone that has your business number — or enter your WhatsApp Cloud API details.',
        'Come back here — this turns green once it is linked.'
      ],
      status: wa.number ? 'done' : 'todo',
      action: wa.number ? null : { type: 'app', target: 'whatsapp', label: 'Open WhatsApp tab' }
    });

    const ready = steps.every((s) => s.status === 'done');
    res.json({ connected: true, ready, steps, errors: snap.errors });
  } catch (e) {
    next(e);
  }
});

/** Step 1: hand the browser a Facebook login URL, tagged with who asked. */
facebookRouter.get('/connect', (req, res) => {
  if (!oauthConfigured()) {
    return res.status(400).json({ error: 'Facebook login is not configured. Add FB_APP_ID and FB_APP_SECRET.' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { userId: req.user.id, ts: Date.now() });
  for (const [s, v] of pendingStates) if (Date.now() - v.ts > 600000) pendingStates.delete(s);
  res.json({ url: loginUrl(state) });
});

/** Step 2: Facebook redirects the browser back here with a code. */
facebookRouter.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const close = (msg, ok) =>
    res.send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center">
      <h2>${ok ? 'Connected ✓' : 'Connection failed'}</h2>
      <p style="color:#555">${msg}</p>
      <p style="color:#999">You can close this tab and return to Ads Desk.</p>
      <script>try{window.opener&&window.opener.postMessage('fb-connected','*')}catch(e){}; setTimeout(()=>window.close(),1200)</script>
      </body>`);

  if (error) return close(error_description || String(error), false);
  const pending = state && pendingStates.get(state);
  if (!pending) return close('The login session expired. Please try again.', false);
  pendingStates.delete(state);

  try {
    const { accessToken, expiresIn } = await exchangeCode(code);
    const me = await fetchMe(accessToken);
    await saveConnection(pending.userId, {
      accessToken,
      name: me.name,
      fbUserId: me.id,
      expiresAt: expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null,
      adAccountId: null,
      pageId: null,
      pageToken: null
    });
    close(`Signed in as ${me.name}. Choose your ad account and page back in the app.`, true);
  } catch (e) {
    close(e.message, false);
  }
});

/** After connecting, list what this user can choose from. */
facebookRouter.get('/accounts', async (req, res, next) => {
  try {
    const conn = await loadConnection(req.user.id);
    if (!conn.accessToken) return res.status(400).json({ error: 'Connect Facebook first.' });
    const [adAccounts, pages] = await Promise.all([
      fetchAdAccounts(conn.accessToken),
      fetchPages(conn.accessToken)
    ]);
    res.json({ adAccounts, pages });
  } catch (e) {
    next(e);
  }
});

/** Persist the chosen ad account and page (with its page token). */
facebookRouter.post('/select', async (req, res, next) => {
  try {
    const { adAccountId, pageId } = req.body || {};
    const conn = await loadConnection(req.user.id);
    if (!conn.accessToken) return res.status(400).json({ error: 'Connect Facebook first.' });

    let pageToken = conn.pageToken;
    if (pageId) {
      const pages = await fetchPages(conn.accessToken);
      pageToken = pages.find((p) => p.id === pageId)?.access_token || null;
    }

    const updated = await saveConnection(req.user.id, {
      adAccountId: adAccountId || conn.adAccountId,
      pageId: pageId || conn.pageId,
      pageToken
    });
    res.json({ ok: true, connection: safeConn(updated) });
  } catch (e) {
    next(e);
  }
});

facebookRouter.post('/disconnect', async (req, res, next) => {
  try {
    await clearConnection(req.user.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
