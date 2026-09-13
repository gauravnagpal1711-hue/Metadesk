import express from 'express';
import crypto from 'crypto';
import { q } from '../db.js';
import { clearConnection } from '../services/meta.js';

/**
 * Public, no-auth Meta Platform callbacks:
 *   POST /deauthorize    — fired when a user removes the app from their FB settings.
 *   POST /data-deletion  — fired when a user requests deletion via FB's "Apps and websites".
 *   GET  /data-deletion/status — the status-check page Meta's response points at.
 *
 * Both callbacks arrive as application/x-www-form-urlencoded with one field,
 * `signed_request`, that must be verified against FB_APP_SECRET before trusting
 * the embedded Facebook user id. Scope of what we delete: only the Meta
 * connection (access token, ad account, page) tied to that Facebook user — the
 * business's own leads/campaigns/WhatsApp history are that tenant's data, not
 * Facebook Platform Data obtained through login, so they are left alone here;
 * a full account deletion is a separate, deliberate action the account holder
 * takes themselves.
 */
export const dataDeletionRouter = express.Router();
dataDeletionRouter.use(express.urlencoded({ extended: false }));

function base64UrlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseSignedRequest(signedRequest, secret) {
  const [encodedSig, encodedPayload] = String(signedRequest || '').split('.');
  if (!encodedSig || !encodedPayload) return null;

  const sig = base64UrlDecode(encodedSig);
  const expectedSig = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) return null;

  try {
    const data = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    if (String(data.algorithm || '').toUpperCase() !== 'HMAC-SHA256') return null;
    return data;
  } catch {
    return null;
  }
}

async function clearConnectionForFbUser(fbUserId) {
  const { rows } = await q('SELECT user_id FROM meta_connections WHERE fb_user_id = $1', [fbUserId]);
  for (const row of rows) await clearConnection(row.user_id);
  return rows.length;
}

dataDeletionRouter.post('/deauthorize', async (req, res) => {
  const secret = process.env.FB_APP_SECRET;
  const data = secret && parseSignedRequest(req.body.signed_request, secret);
  if (data?.user_id) await clearConnectionForFbUser(data.user_id).catch(() => {});
  res.sendStatus(200);
});

dataDeletionRouter.post('/data-deletion', async (req, res) => {
  const secret = process.env.FB_APP_SECRET;
  const data = secret && parseSignedRequest(req.body.signed_request, secret);
  if (!data?.user_id) return res.status(400).json({ error: 'invalid signed_request' });

  await clearConnectionForFbUser(data.user_id).catch(() => {});

  const confirmationCode = crypto.randomBytes(8).toString('hex');
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  res.json({
    url: `${base}/data-deletion/status?id=${confirmationCode}`,
    confirmation_code: confirmationCode
  });
});

dataDeletionRouter.get('/data-deletion/status', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Data Deletion Status</title></head>
<body style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#1c1c1e;">
<h1>Data deletion complete</h1>
<p>Request <code>${String(req.query.id || '').replace(/[^a-f0-9]/gi, '')}</code> has been processed. The Facebook connection
data associated with this request has been deleted from our servers.</p>
</body></html>`);
});
