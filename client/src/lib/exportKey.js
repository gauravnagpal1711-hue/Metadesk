import { api } from '../api.js';

/**
 * Prompts for the per-user key shared by "export all leads" and "delete leads".
 * First use sets it (with confirmation). Returns the key, or null if cancelled.
 * Throws if the two entries of a new key don't match.
 */
export async function askKey(action) {
  const { keySet } = await api.get('/leads/export/status');
  if (keySet) {
    return window.prompt(`Enter your key to ${action}`) || null;
  }
  const key = window.prompt(`First time — set a key (6+ characters). It is needed to ${action} and to export leads.`);
  if (!key) return null;
  if (window.prompt('Re-enter the key to confirm') !== key) throw new Error('Keys did not match — cancelled.');
  return key;
}
