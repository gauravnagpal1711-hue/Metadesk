import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { relativeShort, shortDateTime } from '../lib/dateBuckets.js';

const DISMISSED_KEY = 'adsdesk.reminders.dismissed';
const SNOOZED_KEY = 'adsdesk.reminders.snoozed';
const SNOOZE_MS = 60 * 60 * 1000;
const MAX_VISIBLE = 5;

const KIND_ICON = { call: '📞', meeting: '🤝', whatsapp: '💬', email: '✉️', todo: '☑️' };
const TYPE_ICON = { followup: '🔔', appointment: '📅' };
const TYPE_LABEL = { followup: 'Follow-up due', appointment: 'Appointment due' };

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function writeStore(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* storage unavailable */ }
}

/** A due task/follow-up/appointment stops mattering once it's no longer in
 *  the server's "due" list (done, rescheduled, or the lead moved past it) —
 *  so pruning dismissed/snoozed state down to what's still due is enough
 *  bookkeeping; nothing to expire by hand. */
function prune(store, liveKeys) {
  const next = {};
  for (const k of Object.keys(store)) if (liveKeys.has(k)) next[k] = store[k];
  return next;
}

function reminderKey(r) {
  return `${r.type}:${r.id}:${r.due_at}`;
}

/**
 * App-wide "something is due" toasts — polls regardless of which tab is open,
 * so a follow-up or appointment actually gets surfaced instead of waiting to
 * be noticed as a red date chip. Dismiss/snooze state lives in localStorage
 * (per browser, not synced) since these are just "don't nag me again" flags.
 */
export default function ReminderPopups({ enabled, onOpenLead, onGoToLeads }) {
  const [due, setDue] = useState([]);
  const [dismissed, setDismissed] = useState(() => readStore(DISMISSED_KEY));
  const [snoozed, setSnoozed] = useState(() => readStore(SNOOZED_KEY));
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const rows = await api.get('/leads/reminders/due');
      setDue(rows);
      const liveKeys = new Set(rows.map(reminderKey));
      setDismissed((d) => { const p = prune(d, liveKeys); writeStore(DISMISSED_KEY, p); return p; });
      setSnoozed((s) => { const p = prune(s, liveKeys); writeStore(SNOOZED_KEY, p); return p; });
    } catch {
      // Silent — this is a background nicety, not a page the user is looking at.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [enabled, load]);

  // Re-check snoozes coming back due without waiting for the next server poll.
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [enabled]);

  if (!enabled) return null;

  const visible = due.filter((r) => {
    const key = reminderKey(r);
    if (dismissed[key]) return false;
    if (snoozed[key] && snoozed[key] > now) return false;
    return true;
  });

  if (visible.length === 0) return null;

  const shown = expanded ? visible : visible.slice(0, MAX_VISIBLE);
  const hiddenCount = visible.length - shown.length;

  function dismiss(r) {
    const key = reminderKey(r);
    setDismissed((d) => { const next = { ...d, [key]: true }; writeStore(DISMISSED_KEY, next); return next; });
  }
  function snooze(r) {
    const key = reminderKey(r);
    setSnoozed((s) => { const next = { ...s, [key]: Date.now() + SNOOZE_MS }; writeStore(SNOOZED_KEY, next); return next; });
  }
  async function markDone(r) {
    try {
      await api.patch(`/leads/tasks/${r.id}`, { done: true });
      setDue((rows) => rows.filter((x) => x !== r));
    } catch {
      // Leave it showing — the checkbox on the lead itself still works.
    }
  }

  return (
    <div className="reminder-stack">
      {shown.map((r) => (
        <div key={reminderKey(r)} className="reminder-toast">
          <span className="reminder-icon">{r.type === 'task' ? (KIND_ICON[r.kind] || '☑️') : TYPE_ICON[r.type]}</span>
          <div className="reminder-body">
            <div className="reminder-title">{r.type === 'task' ? r.title : TYPE_LABEL[r.type]}</div>
            <div className="reminder-sub">{r.lead_name || r.lead_phone || 'Lead'}</div>
            <div className="reminder-when" title={shortDateTime(r.due_at)}>{relativeShort(r.due_at)}</div>
            <div className="reminder-actions">
              <button className="btn primary sm" onClick={() => onOpenLead?.(r.lead_id ?? r.id)}>Open lead</button>
              {r.type === 'task' && <button className="btn ghost sm" onClick={() => markDone(r)}>Mark done</button>}
              <button className="btn ghost sm" onClick={() => snooze(r)}>Snooze 1h</button>
              <button className="btn ghost sm" onClick={() => dismiss(r)} aria-label="Dismiss">×</button>
            </div>
          </div>
        </div>
      ))}
      {hiddenCount > 0 && !expanded && (
        <button className="reminder-more" onClick={() => setExpanded(true)}>+{hiddenCount} more due</button>
      )}
      {visible.length > MAX_VISIBLE && expanded && (
        <button className="reminder-more" onClick={() => setExpanded(false)}>Show fewer</button>
      )}
      <button className="reminder-goto" onClick={onGoToLeads}>View in Leads</button>
    </div>
  );
}
