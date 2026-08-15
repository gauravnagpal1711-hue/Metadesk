import { useCallback, useEffect, useRef, useState } from 'react';
import { api, when } from '../api.js';

export default function LeadDrawer({ leadId, stages, onClose }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('chat');
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const load = useCallback(async () => {
    setData(await api.get(`/leads/${leadId}`));
  }, [leadId]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  useEffect(() => {
    if (view === 'chat') endRef.current?.scrollIntoView({ block: 'end' });
  }, [data, view]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!data) return null;
  const { lead, messages, remarks, activity } = data;
  const stage = stages.find((s) => s.id === lead.stage_id);

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.post(`/leads/${leadId}/messages`, { body: draft.trim() });
      setDraft('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    await api.post(`/leads/${leadId}/remarks`, { body: note.trim() });
    setNote('');
    await load();
  }

  async function moveTo(stageId) {
    await api.patch(`/leads/${leadId}/move`, { stage_id: Number(stageId) });
    await load();
  }

  async function saveField(key, value) {
    if (value === (lead[key] ?? '')) return;
    await api.patch(`/leads/${leadId}`, { [key]: value });
    await load();
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={lead.full_name || 'Lead'}>
        <header className="drawer-head">
          <div style={{ display: 'flex', alignItems: 'start', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <h2>{lead.full_name || 'Unnamed lead'}</h2>
              <div className="meta">{lead.phone || 'No phone'} {lead.city ? `· ${lead.city}` : ''}</div>
            </div>
            <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <select className="select" style={{ maxWidth: 190 }} value={lead.stage_id || ''} onChange={(e) => moveTo(e.target.value)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {stage && <span className="col-dot" style={{ background: stage.color }} />}
            {lead.campaign_name && <span className="tag off">{lead.campaign_name}</span>}
          </div>
        </header>

        <nav className="drawer-tabs">
          {[
            ['chat', `Conversation ${messages.length ? `(${messages.length})` : ''}`],
            ['notes', `Remarks ${remarks.length ? `(${remarks.length})` : ''}`],
            ['details', 'Details']
          ].map(([id, label]) => (
            <button key={id} className={`drawer-tab ${view === id ? 'on' : ''}`} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="drawer-body">
          {error && <div className="notice bad">{error}</div>}

          {view === 'chat' && (
            messages.length === 0 ? (
              <div className="empty"><h3>No messages yet</h3>Send the first WhatsApp message below.</div>
            ) : (
              <>
                {messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.direction}`}>
                    <div>{m.body}</div>
                    <div className="t">{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                ))}
                <div ref={endRef} />
              </>
            )
          )}

          {view === 'notes' && (
            <>
              <div className="field">
                <textarea
                  className="textarea"
                  placeholder="Quoted ₹45,000. Wants to visit showroom Saturday."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className="btn primary" onClick={addNote} disabled={!note.trim()}>Add remark</button>
              </div>
              {remarks.map((r) => (
                <div className="remark" key={r.id}>
                  <div>{r.body}</div>
                  <div className="t">{when(r.created_at)}</div>
                </div>
              ))}
            </>
          )}

          {view === 'details' && (
            <>
              {[
                ['full_name', 'Name'],
                ['phone', 'Phone'],
                ['email', 'Email'],
                ['city', 'City'],
                ['value', 'Deal value']
              ].map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={`f-${key}`}>{label}</label>
                  <input
                    id={`f-${key}`}
                    className="input"
                    defaultValue={lead[key] ?? ''}
                    onBlur={(e) => saveField(key, e.target.value)}
                  />
                </div>
              ))}

              {lead.fields && Object.keys(lead.fields).length > 0 && (
                <>
                  <h3 style={{ fontFamily: 'var(--display)', fontSize: 14, margin: '18px 0 8px' }}>Form answers</h3>
                  <dl className="kv">
                    {Object.entries(lead.fields).map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}

              {activity.length > 0 && (
                <>
                  <h3 style={{ fontFamily: 'var(--display)', fontSize: 14, margin: '18px 0 8px' }}>History</h3>
                  {activity.map((a) => (
                    <div key={a.id} style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 5 }}>
                      {a.detail} · {when(a.created_at)}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {view === 'chat' && (
          <div className="drawer-foot">
            <input
              className="input"
              placeholder="Message on WhatsApp"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button className="btn primary" onClick={send} disabled={sending || !draft.trim()}>
              {sending ? '…' : 'Send'}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
