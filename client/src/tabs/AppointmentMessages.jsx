import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: new Date(2000, 0, 1, h).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true })
}));

const PLACEHOLDER_HELP = {
  name: 'Lead’s first name',
  date: 'Appointment date',
  day: 'Weekday',
  time: 'Appointment time',
  studio: 'Studio name',
  address: 'Studio address',
  map: 'Google Maps link',
  phone: 'Lead’s phone'
};

/** One editable template card: on/off switch, textarea, placeholder chips, live preview. */
function TemplateCard({ title, hint, enabledKey, templateKey, draft, setDraft, placeholders, defaults, preview, children }) {
  const ref = useRef(null);

  function insert(token) {
    const el = ref.current;
    const text = draft[templateKey] || '';
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const next = text.slice(0, start) + `{${token}}` + text.slice(end);
    setDraft((d) => ({ ...d, [templateKey]: next }));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length + 2;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="provider-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 13 }}>{hint}</p>
        </div>
        <button
          type="button"
          className={`toggle ${draft[enabledKey] ? 'on' : ''}`}
          style={{ marginLeft: 'auto', flexShrink: 0 }}
          onClick={() => setDraft((d) => ({ ...d, [enabledKey]: !d[enabledKey] }))}
          aria-pressed={!!draft[enabledKey]}
          aria-label={`${title} ${draft[enabledKey] ? 'on' : 'off'}`}
        >
          <span />
        </button>
      </div>

      {children}

      <div className="field" style={{ marginTop: 14 }}>
        <label>Message</label>
        <textarea
          ref={ref}
          className="textarea"
          style={{ minHeight: 130 }}
          value={draft[templateKey] || ''}
          onChange={(e) => setDraft((d) => ({ ...d, [templateKey]: e.target.value }))}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Insert:</span>
        {placeholders.map((p) => (
          <button key={p} type="button" className="btn sm ghost" title={PLACEHOLDER_HELP[p]} onClick={() => insert(p)}>
            {`{${p}}`}
          </button>
        ))}
        <button
          type="button"
          className="btn sm ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => setDraft((d) => ({ ...d, [templateKey]: defaults[templateKey] }))}
        >
          Reset to default
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="mono-label" style={{ marginBottom: 6 }}>Preview</div>
        <div
          style={{
            whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.45, padding: '10px 12px',
            borderRadius: 10, background: 'var(--good-soft)', border: '1px solid var(--line)'
          }}
        >
          {preview || '—'}
        </div>
      </div>
    </div>
  );
}

export default function AppointmentMessages() {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [placeholders, setPlaceholders] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [preview, setPreview] = useState({ confirm: '', reminder: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.get('/appointment-messages')
      .then((r) => {
        setSaved(r.settings);
        setDraft(r.settings);
        setPlaceholders(r.placeholders || []);
        setDefaults(r.defaults || {});
      })
      .catch((e) => setError(e.message));
  }, []);

  // Live preview, debounced.
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      api.post('/appointment-messages/preview', { settings: draft }).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [draft]);

  const dirty = saved && draft && JSON.stringify(saved) !== JSON.stringify(draft);

  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await api.patch('/appointment-messages', draft);
      setSaved(r.settings);
      setDraft(r.settings);
      setNotice('Saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return error ? <div className="notice bad">{error}</div> : <div style={{ color: 'var(--muted)' }}>Loading…</div>;
  }

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div style={{ maxWidth: 720 }}>
      {error && <div className="notice bad" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && !dirty && <div className="notice good" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Studio details</h2>
        <p style={{ color: 'var(--muted)', margin: '6px 0 12px', fontSize: 13 }}>
          Used by <code>{'{studio}'}</code>, <code>{'{address}'}</code> and <code>{'{map}'}</code>. Lines left blank are dropped from the message.
        </p>
        <div className="field">
          <label htmlFor="appt-studio">Studio name</label>
          <input id="appt-studio" className="input" placeholder="e.g. Beauty Box Makeup Studio" value={draft.studio_name || ''} onChange={set('studio_name')} />
        </div>
        <div className="field">
          <label htmlFor="appt-address">Address</label>
          <textarea id="appt-address" className="textarea" style={{ minHeight: 60 }} value={draft.address || ''} onChange={set('address')} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="appt-map">Google Maps link</label>
          <input id="appt-map" className="input" placeholder="https://maps.app.goo.gl/…" value={draft.map_link || ''} onChange={set('map_link')} />
        </div>
      </div>

      <TemplateCard
        title="Appointment confirmation"
        hint="Sent on WhatsApp the moment you set (or change) a lead’s appointment date."
        enabledKey="confirm_enabled"
        templateKey="confirm_template"
        draft={draft}
        setDraft={setDraft}
        placeholders={placeholders}
        defaults={defaults}
        preview={preview.confirm}
      />

      <TemplateCard
        title="Day-before reminder"
        hint="Sent on WhatsApp the day before the appointment, reminding the lead to visit the studio."
        enabledKey="reminder_enabled"
        templateKey="reminder_template"
        draft={draft}
        setDraft={setDraft}
        placeholders={placeholders}
        defaults={defaults}
        preview={preview.reminder}
      >
        <div className="field" style={{ marginTop: 14, marginBottom: 0, maxWidth: 260 }}>
          <label htmlFor="appt-hour">Send the reminder at</label>
          <select
            id="appt-hour"
            className="input"
            value={draft.reminder_hour}
            onChange={(e) => setDraft((d) => ({ ...d, reminder_hour: Number(e.target.value) }))}
          >
            {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label} (India time)</option>)}
          </select>
        </div>
      </TemplateCard>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', position: 'sticky', bottom: 0, padding: '10px 0', background: 'var(--canvas)' }}>
        <button className="btn primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {dirty && (
          <button className="btn ghost" onClick={() => setDraft(saved)} disabled={saving}>Discard changes</button>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Messages go out from your connected WhatsApp and show in the lead’s chat and timeline.
        </span>
      </div>
    </div>
  );
}
