import express from 'express';
import {
  searchGeo,
  searchInterests,
  resolveWhatsappNumber,
  getPageInfo,
  listLeadForms,
  metaConfigured
} from '../services/meta.js';

export const metaTargetingRouter = express.Router();

/**
 * Read-only lookups that let the in-app campaign builder ask for cities /
 * interests / an existing form in plain language instead of raw Meta IDs.
 * Nothing here writes to Meta — Claude Code's MCP connector does all creation.
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
