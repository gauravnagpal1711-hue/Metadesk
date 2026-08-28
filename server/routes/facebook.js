import crypto from 'node:crypto';
import express from 'express';
import {
  oauthConfigured,
  loginUrl,
  exchangeCode,
  fetchMe,
  fetchAdAccounts,
  fetchPages
} from '../services/facebookAuth.js';
import { loadConnection, saveConnection, clearConnection, safeConn } from '../services/meta.js';

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
