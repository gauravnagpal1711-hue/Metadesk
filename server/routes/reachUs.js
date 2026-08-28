import express from 'express';
import { sendText, cloudConfigured } from '../services/whatsappCloud.js';
import { sendWebText, webStatus } from '../services/whatsappWeb.js';
import { normalisePhone } from '../services/meta.js';
import { loadWaConnection } from '../services/waConnection.js';

export const reachUsRouter = express.Router();

const REACH_US_PHONE = '9560277217';

reachUsRouter.post('/', async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'Write your message first.' });

    const phone = normalisePhone(REACH_US_PHONE);
    const body = message.trim();
    const wa = await loadWaConnection(req.user.id);

    if (cloudConfigured(wa.cloud)) {
      await sendText(wa.cloud, phone, body);
    } else if (webStatus(req.user.id).status === 'connected') {
      await sendWebText(req.user.id, phone, body);
    } else {
      return res.status(400).json({ error: 'Connect your WhatsApp first, then try again.' });
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
