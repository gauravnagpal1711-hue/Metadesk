import express from 'express';
import {
  loadConnection,
  connConfigured,
  searchGeo,
  searchInterests,
  resolveWhatsappNumber,
  setWhatsappNumber,
  getShopLocation,
  setShopLocation,
  getPageInfo,
  listLeadForms,
  createLeadForm
} from '../services/meta.js';

export const metaTargetingRouter = express.Router();

/**
 * Lookups that let the in-app campaign builder ask for cities / interests /
 * forms in plain language. Everything here is a read except POST /lead-forms,
 * which creates an Instant Form on the user's Page.
 */

metaTargetingRouter.get('/geo', async (req, res, next) => {
  try {
    const conn = await loadConnection(req.user.id);
    if (!connConfigured(conn)) return res.json([]);
    res.json(await searchGeo(conn, req.query.q || ''));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/interests', async (req, res, next) => {
  try {
    const conn = await loadConnection(req.user.id);
    if (!connConfigured(conn)) return res.json([]);
    res.json(await searchInterests(conn, req.query.q || ''));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/whatsapp-number', async (req, res, next) => {
  try {
    res.json(await resolveWhatsappNumber(req.user.id));
  } catch (e) {
    next(e);
  }
});

/** Save a number to use for lead campaigns when auto-detection misses. */
metaTargetingRouter.post('/whatsapp-number', async (req, res, next) => {
  try {
    const digits = String(req.body?.number || '').replace(/\D/g, '');
    if (digits && (digits.length < 10 || digits.length > 15)) {
      return res.status(400).json({ error: 'Enter the number with country code, digits only (e.g. 919354260517).' });
    }
    res.json(await setWhatsappNumber(req.user.id, digits));
  } catch (e) {
    next(e);
  }
});

/** Clear the saved number and go back to auto-detection. */
metaTargetingRouter.delete('/whatsapp-number', async (req, res, next) => {
  try {
    res.json(await setWhatsappNumber(req.user.id, null));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/page', async (req, res, next) => {
  try {
    res.json(await getPageInfo(await loadConnection(req.user.id)));
  } catch (e) {
    next(e);
  }
});

/** The shopkeeper's saved shop location — campaigns default to "near here". */
metaTargetingRouter.get('/shop-location', async (req, res, next) => {
  try {
    res.json(await getShopLocation(req.user.id));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.post('/shop-location', async (req, res, next) => {
  try {
    res.json(await setShopLocation(req.user.id, req.body || {}));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.delete('/shop-location', async (req, res, next) => {
  try {
    res.json(await setShopLocation(req.user.id, null));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/lead-forms', async (req, res, next) => {
  try {
    const conn = await loadConnection(req.user.id);
    if (!connConfigured(conn) || !conn.pageId) return res.json([]);
    res.json(await listLeadForms(conn));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.post('/lead-forms', async (req, res, next) => {
  try {
    res.json(await createLeadForm(await loadConnection(req.user.id), req.body || {}));
  } catch (e) {
    next(e);
  }
});
