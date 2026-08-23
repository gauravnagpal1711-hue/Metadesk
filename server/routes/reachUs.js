import express from 'express';
import { sendText, cloudConfigured } from '../services/whatsappCloud.js';
import { sendWebText, webStatus } from '../services/whatsappWeb.js';
import { normalisePhone } from '../services/meta.js';

export const reachUsRouter = express.Router();

const REACH_US_PHONE = '9560277217';

reachUsRouter.post('/', async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'Write your message first.' });

    const phone = normalisePhone(REACH_US_PHONE);
    const body = message.trim();

    if (cloudConfigured()) {
      await sendText(phone, body);
    } else if (webStatus().status === 'connected') {
      await sendWebText(phone, body);
    } else {
      return res.status(400).json({ error: 'WhatsApp is not connected right now — try again once it is.' });
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
