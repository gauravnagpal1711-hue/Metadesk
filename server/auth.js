import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './db.js';

const SECRET = process.env.JWT_SECRET || 'change-me-in-railway-variables';
const COOKIE = 'mam_token';
const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

// Self-serve signup is off unless explicitly enabled. Keep it off in production
// until per-tenant data isolation is in place.
const SIGNUP_ENABLED = process.env.SIGNUP_ENABLED === 'true';

export const authRouter = express.Router();

function issueCookie(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: THIRTY_DAYS_MS
  });
}

function publicUser(u) {
  return { id: u.id, username: u.username, business_name: u.business_name };
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;

authRouter.post('/signup', async (req, res, next) => {
  try {
    if (!SIGNUP_ENABLED) return res.status(403).json({ error: 'Signups are closed right now.' });
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const businessName = String(req.body?.business_name || '').trim() || null;

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'User ID must be 3–40 letters, numbers, dot, dash or underscore.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const { rows: exists } = await q('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]);
    if (exists.length) return res.status(409).json({ error: 'That User ID is taken.' });

    const { rows } = await q(
      'INSERT INTO users (username, password_hash, business_name) VALUES ($1, $2, $3) RETURNING *',
      [username, bcrypt.hashSync(password, 10), businessName]
    );
    issueCookie(res, rows[0].id);
    res.json({ ok: true, user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(400).json({ error: 'Enter your User ID and password.' });
    }
    const { rows } = await q('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'That User ID or password does not match. Try again.' });
    }
    await q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    issueCookie(res, user.id);
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  try {
    const { sub } = jwt.verify(req.cookies?.[COOKIE] || '', SECRET);
    const id = Number(sub);
    if (!Number.isInteger(id) || id <= 0) return res.json({ authenticated: false });
    const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows.length) return res.json({ authenticated: false });
    res.json({ authenticated: true, user: publicUser(rows[0]), signupEnabled: SIGNUP_ENABLED });
  } catch {
    res.json({ authenticated: false, signupEnabled: SIGNUP_ENABLED });
  }
});

export function requireAuth(req, res, next) {
  // Webhooks authenticate with Meta's verify token instead of the cookie.
  if (req.path.startsWith('/whatsapp/webhook')) return next();
  // Facebook redirects the browser straight to the OAuth callback with no cookie.
  if (req.path.startsWith('/facebook/callback')) return next();
  try {
    const { sub } = jwt.verify(req.cookies?.[COOKIE] || '', SECRET);
    const id = Number(sub);
    if (!Number.isInteger(id) || id <= 0) throw new Error('stale session');
    req.user = { id };
    next();
  } catch {
    res.status(401).json({ error: 'Sign in to continue.' });
  }
}
