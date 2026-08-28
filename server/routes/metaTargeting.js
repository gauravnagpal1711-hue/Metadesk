import express from 'express';
import {
  searchGeo,
  searchInterests,
  resolveWhatsappNumber,
  setWhatsappNumber,
  getPageInfo,
  listLeadForms,
  createLeadForm,
  metaConfigured
} from '../services/meta.js';

export const metaTargetingRouter = express.Router();

/**
 * Lookups that let the in-app campaign builder ask for cities / interests /
 * forms in plain language instead of raw Meta IDs. Everything here is a
 * read except POST /lead-forms, which creates an Instant Form on the Page
 * (the one Meta write the app makes — the MCP connector has no such tool).
 */

metaTargetingRouter.get('/geo', async (req, res, next) => {
  try {
    res.json(await searchGeo(req.query.q || ''));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/interests', async (req, res, next) => {
  try {
    res.json(await searchInterests(req.query.q || ''));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/whatsapp-number', async (req, res, next) => {
  try {
    res.json(await resolveWhatsappNumber());
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
    res.json(await setWhatsappNumber(digits));
  } catch (e) {
    next(e);
  }
});

/** Clear the saved number and go back to auto-detection. */
metaTargetingRouter.delete('/whatsapp-number', async (req, res, next) => {
  try {
    res.json(await setWhatsappNumber(null));
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/page', async (req, res, next) => {
  try {
    res.json(await getPageInfo());
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.get('/lead-forms', async (req, res, next) => {
  try {
    if (!metaConfigured()) return res.json([]);
    res.json(await listLeadForms());
  } catch (e) {
    next(e);
  }
});

metaTargetingRouter.post('/lead-forms', async (req, res, next) => {
  try {
    res.json(await createLeadForm(req.body || {}));
  } catch (e) {
    next(e);
  }
});
