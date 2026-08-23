import { useCallback, useEffect, useRef, useState } from 'react';
import { api, when } from '../api.js';

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Renders text with any http(s) URLs turned into clickable links. */
function Linkified({ text }) {
  if (!text) return null;
  const parts = String(text).split(URL_RE);
  return parts.map((part, i) =>
    URL_RE.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function MessageMedia({ mime, data }) {
  if (!mime || !data) return null;
  if (mime.startsWith('image/')) return <img src={data} alt="" style={{ maxWidth: '100%', borderRadius: 8, display: 'block', marginBottom: 6 }} />;
  if (mime.startsWith('video/')) return <video src={data} controls style={{ maxWidth: '100%', borderRadius: 8, display: 'block', marginBottom: 6 }} />;
  if (mime.startsWith('audio/')) return <audio src={data} controls style={{ width: '100%', marginBottom: 6 }} />;
  return (
    <a href={data} download className="btn sm" style={{ display: 'inline-block', marginBottom: 6 }}>
      Download file
    </a>
  );
}

export default function LeadDrawer({ leadId, stages, onClose }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('chat');
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null); // { dataUrl, mime, name }
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const fileRef = useRef(null);

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

  async function send() {
    if (!draft.trim() && !attachment) return;
    setSending(true);
    setError('');
    try {
      await api.post(`/leads/${leadId}/messages`, {
        body: draft.trim() || undefined,
        mediaData: attachment?.dataUrl,
        mediaMime: attachment?.mime,
        fileName: attachment?.name
      });
      setDraft('');
      setAttachment(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function pickFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAttachment({ dataUrl: reader.result, mime: file.type, name: file.name });
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsDataURL(file);
  }

  async function addNote() {
    if (!note.trim()) return;
    await api.post(`/leads/${leadId}/remarks`, { body: note.trim() });
    setNote('');
    await load();
  }

  async function moveTo(stageId) {
    await api.patch(`/leads/${leadId}/move`, { stage_id: stageId });
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
        <div className="drawer-head">
          <div className="top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{lead.full_name || 'Unnamed lead'}</h2>
              <div className="meta">{lead.phone || 'No phone'}</div>
            </div>
            <button className="close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="stage-chips">
            <span className="mono-label">Stage</span>
            {stages.map((s) => (
              <button
                key={s.id}
                className={`stage-chip ${lead.stage_id === s.id ? 'on' : ''}`}
                onClick={() => moveTo(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <div className="drawer-info">
          <div className="cell">
            <div className="k">City</div>
            <div className="v">{lead.city || '—'}</div>
          </div>
          <div className="cell">
            <div className="k">Source</div>
            <div className="v">{lead.campaign_name || lead.source || '—'}</div>
          </div>
          <div className="cell">
            <div className="k">Received</div>
            <div className="v">{when(lead.created_at)}</div>
          </div>
        </div>

        <nav className="drawer-tabs">
          {[
            ['chat', `Conversation${messages.length ? ` (${messages.length})` : ''}`],
            ['notes', `Remarks${remarks.length ? ` (${remarks.length})` : ''}`],
            ['log', `Activity${activity.length ? ` (${activity.length})` : ''}`],
            ['details', 'Details']
          ].map(([id, label]) => (
            <button key={id} className={`drawer-tab ${view === id ? 'on' : ''}`} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className={`drawer-body ${view === 'chat' ? 'wa-chat' : ''}`}>
          {error && <div className="notice bad">{error}</div>}

          {view === 'chat' && (
            messages.length === 0 ? (
              <div className="empty"><h3>No messages yet</h3>Send the first WhatsApp message below.</div>
            ) : (
              <>
                {messages.map((m) => (
                  <div key={m.id} className={`wa-bubble ${m.direction === 'out' ? 'out' : 'in'}`}>
                    <MessageMedia mime={m.media_mime} data={m.media_data} />
                    {m.body && <Linkified text={m.body} />}
                    <span className="wa-meta">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
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
                  <div className="t">{r.author === 'upload' ? 'UPLOADED' : new Date(r.created_at).toLocaleString()}</div>
                </div>
              ))}
            </>
          )}

          {view === 'log' && (
            activity.length === 0 ? (
              <div className="empty"><h3>No activity yet</h3>Stage changes and syncs show up here.</div>
            ) : (
              activity.map((a) => (
                <div className="activity-row" key={a.id}>
                  <span className="dot" />
                  <div className="text">{a.detail}</div>
                  <span className="time">{when(a.created_at)}</span>
                </div>
              ))
            )
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
                  <div className="mono-label" style={{ margin: '4px 0 4px' }}>Form answers</div>
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
            </>
          )}
        </div>

        {view === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {attachment && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface-soft)' }}>
                {attachment.mime.startsWith('image/') ? (
                  <img src={attachment.dataUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
                ) : (
                  <span className="tag off">{attachment.mime.split('/')[0] || 'file'}</span>
                )}
                <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.name}</span>
                <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = ''; }}>
                  Remove
                </button>
              </div>
            )}
            <div className="wa-composer">
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => pickFile(e.target.files?.[0])} />
              <button className="wa-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach file" title="Attach file">
                📎
              </button>
              <input
                className="input"
                placeholder="Type a message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                style={{ flex: 1 }}
              />
              <button className="wa-send" onClick={send} disabled={sending || (!draft.trim() && !attachment)} aria-label="Send">
                {sending ? '…' : '➤'}
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
