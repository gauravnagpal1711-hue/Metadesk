import express from 'express';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'change-me-in-railway-variables';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const COOKIE = 'mam_token';

export const authRouter = express.Router();

authRouter.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!APP_PASSWORD) {
    return res.status(500).json({ error: 'APP_PASSWORD is not set on the server.' });
  }
  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: 'That password does not match. Try again.' });
  }
  const token = jwt.sign({ sub: 'owner' }, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000
  });
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  try {
    jwt.verify(req.cookies?.[COOKIE] || '', SECRET);
    res.json({ authenticated: true });
  } catch {
    res.json({ authenticated: false });
  }
});

export function requireAuth(req, res, next) {
  // Webhooks authenticate with Meta's verify token instead of the cookie.
  if (req.path.startsWith('/whatsapp/webhook')) return next();
  // Facebook redirects the browser straight to the OAuth callback with no cookie.
  if (req.path.startsWith('/facebook/callback')) return next();
  try {
    jwt.verify(req.cookies?.[COOKIE] || '', SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sign in to continue.' });
  }
}
