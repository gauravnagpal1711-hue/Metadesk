import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useOutsideClick } from '../hooks/useOutsideClick.js';

/** Fill {name} / {first_name} / {phone} / {city} (and {{...}}) from the lead. */
export function fillTemplate(body, lead) {
  const name = (lead?.full_name || '').trim();
  const first = name.split(/\s+/)[0] || '';
  return String(body || '')
    .replace(/\{\{?\s*first[_\s]?name\s*\}?\}/gi, first)
    .replace(/\{\{?\s*name\s*\}?\}/gi, name)
    .replace(/\{\{?\s*phone\s*\}?\}/gi, lead?.phone || '')
    .replace(/\{\{?\s*city\s*\}?\}/gi, lead?.city || '');
}

const BLANK = { label: '', body: '' };

/** ⚡ Quick-reply templates for the WhatsApp composer: pick one to insert, or
 *  add / edit / delete them inline. Templates are shared (one per account). */
export default function MessageTemplates({ lead, onInsert }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [list, setList] = useState([]);
  const [manage, setManage] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phoneList, setPhoneList] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const ref = useRef(null);

  useOutsideClick(ref, open, () => { setOpen(false); resetForm(); });

  useEffect(() => {
    if (!open || loaded) return;
    Promise.all([
      api.get('/whatsapp/templates'),
      api.get('/whatsapp/quick-replies').catch(() => [])
    ])
      .then(([templates, phone]) => {
        setList(Array.isArray(templates) ? templates : []);
        setPhoneList(Array.isArray(phone) ? phone : []);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [open, loaded]);

  async function syncFromPhone() {
    setSyncing(true);
    setError('');
    try {
      await api.post('/whatsapp/quick-replies/sync');
      // The phone reports its quick replies back asynchronously; re-poll a few times.
      let got = phoneList.length;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const fresh = await api.get('/whatsapp/quick-replies');
        setPhoneList(Array.isArray(fresh) ? fresh : []);
        if (fresh.length !== got) { got = fresh.length; break; }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  function resetForm() {
    setManage(false);
    setEditingId(null);
    setDraft(BLANK);
    setError('');
  }

  async function save() {
    if (!draft.body.trim()) { setError('Type the message.'); return; }
    setBusy(true);
    setError('');
    try {
      const next = editingId
        ? await api.patch(`/whatsapp/templates/${editingId}`, draft)
        : await api.post('/whatsapp/templates', draft);
      setList(next);
      resetForm();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setError('');
    try {
      setList(await api.del(`/whatsapp/templates/${id}`));
    } catch (e) {
      setError(e.message);
    }
  }

  function startEdit(t) {
    setEditingId(t.id);
    setDraft({ label: t.label || '', body: t.body || '' });
    setManage(true);
  }

  return (
    <div ref={ref} style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        type="button"
        className="wa-icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Quick replies"
        title="Quick replies"
      >
        ⚡
      </button>

      {open && (
        <div
          className="dropdown-pop"
          style={{ top: 'auto', bottom: 'calc(100% + 6px)', left: 0, width: 300, maxWidth: 320, maxHeight: 340, overflowY: 'auto', padding: 8 }}
        >
          {error && <div className="notice bad" style={{ margin: '0 0 6px' }}>{error}</div>}

          {!manage ? (
            <>
              {list.length === 0 && <div className="empty-mini">No templates yet. Add one below.</div>}
              {list.map((t) => (
                <div key={t.id} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', padding: '3px 0' }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    style={{ flex: 1, textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '5px 7px' }}
                    onClick={() => { onInsert(fillTemplate(t.body, lead)); setOpen(false); }}
                  >
                    <strong style={{ display: 'block' }}>{t.label || 'Untitled'}</strong>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {t.body.slice(0, 90)}{t.body.length > 90 ? '…' : ''}
                    </span>
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => startEdit(t)} aria-label="Edit template">✎</button>
                  <button type="button" className="btn ghost sm danger" onClick={() => remove(t.id)} aria-label="Delete template">×</button>
                </div>
              ))}
              <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => { setManage(true); setEditingId(null); setDraft(BLANK); }}>
                + New template
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px', paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                <span className="mono-label" style={{ flex: 1 }}>From your phone</span>
                <button type="button" className="btn ghost sm" onClick={syncFromPhone} disabled={syncing}>
                  {syncing ? 'Syncing…' : 'Sync'}
                </button>
              </div>
              {phoneList.length === 0 && (
                <div className="empty-mini">
                  No quick replies synced yet — set some up in WhatsApp Business (Settings → Business tools → Quick replies), then tap Sync.
                </div>
              )}
              {phoneList.map((q) => (
                <button
                  key={q.shortcut}
                  type="button"
                  className="btn ghost sm"
                  style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '5px 7px', marginBottom: 2 }}
                  onClick={() => { onInsert(fillTemplate(q.message, lead)); setOpen(false); }}
                >
                  <strong style={{ display: 'block' }}>/{q.shortcut}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {q.message.slice(0, 90)}{q.message.length > 90 ? '…' : ''}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              <input
                className="input"
                placeholder="Name (e.g. First hello)"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
              <textarea
                className="textarea"
                style={{ minHeight: 84 }}
                placeholder="Message… use {name}, {first_name}, {city}"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn primary sm" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add template'}
                </button>
                <button type="button" className="btn ghost sm" onClick={resetForm}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
