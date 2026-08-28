import express from 'express';
import {
  searchGeo,
  searchInterests,
  resolveWhatsappNumber,
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
