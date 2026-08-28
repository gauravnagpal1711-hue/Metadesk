import crypto from 'node:crypto';
import express from 'express';
import { getSetting, setSetting, q } from '../db.js';
import {
  oauthConfigured,
  loginUrl,
  exchangeCode,
  fetchMe,
  fetchAdAccounts,
  fetchPages
} from '../services/facebookAuth.js';
import { setConnection, getConnection } from '../services/meta.js';

export const facebookRouter = express.Router();

const CONNECTION_KEY = 'meta_connection';
// Short-lived states to guard the OAuth round trip against CSRF.
// value: { userId, ts }
const pendingStates = new Map();

async function firstUserId() {
  const { rows } = await q('SELECT id FROM users ORDER BY id LIMIT 1');
  return rows[0]?.id || null;
}

/**
 * Load a saved connection into the live meta service. Called on boot.
 * TODO(stage 3): the meta service holds a single global connection; until that
 * becomes per-user, we restore the first user's connection as the active one.
 */
export async function restoreConnection() {
  try {
    const uid = await firstUserId();
    if (!uid) return;
    const saved = await getSetting(uid, CONNECTION_KEY, null);
    if (saved?.accessToken) {
      setConnection(saved);
      console.log('Restored Meta connection for', saved.name || 'account');
    }
  } catch (e) {
    console.error('Restore connection failed:', e.message);
  }
}

facebookRouter.get('/status', (req, res) => {
  res.json({
    oauthConfigured: oauthConfigured(),
    connection: getConnection()
  });
});

/** Step 1: hand the browser a Facebook login URL. */
facebookRouter.get('/connect', (req, res) => {
  if (!oauthConfigured()) {
    return res.status(400).json({ error: 'Facebook login is not configured. Add FB_APP_ID and FB_APP_SECRET.' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { userId: req.user.id, ts: Date.now() });
  // Forget states older than 10 minutes.
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
    // Save the token immediately so the user can pick account/page next.
    const conn = {
      accessToken,
      name: me.name,
      userId: me.id,
      expiresIn,
      connectedAt: new Date().toISOString(),
      adAccountId: null,
      pageId: null,
      pageToken: null
    };
    await setSetting(pending.userId, CONNECTION_KEY, conn);
    setConnection(conn);
    close(`Signed in as ${me.name}. Choose your ad account and page back in the app.`, true);
  } catch (e) {
    close(e.message, false);
  }
});

/** After connecting, list what this user can choose from. */
facebookRouter.get('/accounts', async (req, res, next) => {
  try {
    const saved = await getSetting(req.user.id, CONNECTION_KEY, null);
    if (!saved?.accessToken) return res.status(400).json({ error: 'Connect Facebook first.' });
    const [adAccounts, pages] = await Promise.all([
      fetchAdAccounts(saved.accessToken),
      fetchPages(saved.accessToken)
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
    const saved = await getSetting(req.user.id, CONNECTION_KEY, null);
    if (!saved?.accessToken) return res.status(400).json({ error: 'Connect Facebook first.' });

    let pageToken = null;
    if (pageId) {
      const pages = await fetchPages(saved.accessToken);
      pageToken = pages.find((p) => p.id === pageId)?.access_token || null;
    }

    const conn = { ...saved, adAccountId: adAccountId || saved.adAccountId, pageId: pageId || saved.pageId, pageToken };
    await setSetting(req.user.id, CONNECTION_KEY, conn);
    setConnection(conn);
    res.json({ ok: true, connection: getConnection() });
  } catch (e) {
    next(e);
  }
});

facebookRouter.post('/disconnect', async (req, res, next) => {
  try {
    await setSetting(req.user.id, CONNECTION_KEY, {});
    setConnection({ accessToken: null, adAccountId: null, pageId: null, pageToken: null, name: null, connectedAt: null });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
