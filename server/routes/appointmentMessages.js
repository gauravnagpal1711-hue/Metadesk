import express from 'express';
import {
  loadAppointmentSettings, saveAppointmentSettings, renderTemplate, PLACEHOLDERS, DEFAULT_APPOINTMENT_SETTINGS
} from '../services/appointmentMessages.js';

export const appointmentMessagesRouter = express.Router();

appointmentMessagesRouter.get('/', async (req, res, next) => {
  try {
    res.json({ settings: await loadAppointmentSettings(req.user.id), placeholders: PLACEHOLDERS, defaults: DEFAULT_APPOINTMENT_SETTINGS });
  } catch (e) {
    next(e);
  }
});

appointmentMessagesRouter.patch('/', async (req, res, next) => {
  try {
    res.json({ settings: await saveAppointmentSettings(req.user.id, req.body || {}) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

/** Renders a template against a sample lead (tomorrow 11:30 AM) so the tab can show a live preview. */
appointmentMessagesRouter.post('/preview', async (req, res, next) => {
  try {
    const saved = await loadAppointmentSettings(req.user.id);
    const settings = { ...saved, ...(req.body?.settings || {}) };
    const sample = new Date(Date.now() + 24 * 3600 * 1000);
    // Sample time is 11:30 IST; for a preview that's close enough for any zone.
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(sample);
    const lead = { full_name: 'Priya Sharma', phone: '919800000000', appointment_date: new Date(`${ymd}T11:30:00+05:30`) };
    res.json({
      confirm: renderTemplate(settings.confirm_template, lead, settings),
      reminder: renderTemplate(settings.reminder_template, lead, settings)
    });
  } catch (e) {
    next(e);
  }
});
