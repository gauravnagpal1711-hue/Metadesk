import crypto from 'node:crypto';
import express from 'express';
import { getSetting, setSetting } from '../db.js';
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
const STATE_MAX_AGE_MS = 600000; // 10 minutes

// Stateless, signed OAuth state (guards the round trip against CSRF) instead of an
// in-memory Map. A Map is per-process, so it gets wiped on every restart/redeploy
// and doesn't work across multiple replicas -- that was causing real users to see
// "login session expired" even on a normal login attempt. Signing the timestamp
// with FB_APP_SECRET means we don't need any server-side storage at all.
function makeState() {
    const ts = Date.now().toString();
    const sig = crypto.createHmac('sha256', process.env.FB_APP_SECRET).update(ts).digest('hex');
    return `${ts}.${sig}`;
}

function verifyState(state) {
    if (!state || typeof state !== 'string') return false;
    const [ts, sig] = state.split('.');
    if (!ts || !sig) return false;
    const expected = crypto.createHmac('sha256', process.env.FB_APP_SECRET).update(ts).digest('hex');
    if (sig.length !== expected.length) return false;
    const sigMatches = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!sigMatches) return false;
    return Date.now() - Number(ts) < STATE_MAX_AGE_MS;
}

/** Load a saved connection from the DB into the live meta service. Called on boot. */
export async function restoreConnection() {
    const saved = await getSetting(CONNECTION_KEY, null);
    if (saved?.accessToken) {
          setConnection(saved);
          console.log('Restored Meta connection for', saved.name || 'account');
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
    const state = makeState();
    res.json({ url: loginUrl(state) });
});

/** Step 2: Facebook redirects the browser back here with a code. */
facebookRouter.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    const close = (msg, ok) => {
          res.set('Cache-Control', 'no-store');
          res.send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center">
              <h2>${ok ? 'Connected ✓' : 'Connection failed'}</h2>
                  <p style="color:#555">${msg}</p>
                      <p style="color:#999">You can close this tab and return to Ads Desk.</p>
                          <script>try{window.opener&&window.opener.postMessage('fb-connected','*')}catch(e){}; setTimeout(()=>window.close(),1200)</script>
                              </body>`);
    };

                     if (error) return close(error_description || String(error), false);
    if (!verifyState(state)) return close('The login session expired. Please try again.', false);

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
                           await setSetting(CONNECTION_KEY, conn);
                           setConnection(conn);
                           close(`Signed in as ${me.name}. Choose your ad account and page back in the app.`, true);
                     } catch (e) {
                           console.error('Facebook OAuth callback failed:', e);
                           close(e.message, false);
                     }
});

/** After connecting, list what this user can choose from. */
facebookRouter.get('/accounts', async (req, res, next) => {
    try {
          const saved = await getSetting(CONNECTION_KEY, null);
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
          const saved = await getSetting(CONNECTION_KEY, null);
          if (!saved?.accessToken) return res.status(400).json({ error: 'Connect Facebook first.' });

      let pageToken = null;
          if (pageId) {
                  const pages = await fetchPages(saved.accessToken);
                  pageToken = pages.find((p) => p.id === pageId)?.access_token || null;
          }

      const conn = { ...saved, adAccountId: adAccountId || saved.adAccountId, pageId: pageId || saved.pageId, pageToken };
          await setSetting(CONNECTION_KEY, conn);
          setConnection(conn);
          res.json({ ok: true, connection: getConnection() });
    } catch (e) {
          next(e);
    }
});
