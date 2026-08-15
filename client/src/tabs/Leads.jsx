import { useCallback, useEffect, useState } from 'react';
import { api, when } from '../api.js';
import LeadDrawer from '../components/LeadDrawer.jsx';

export default function Leads() {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const board = await api.get('/leads/board');
    setStages(board.stages);
    setLeads(board.leads);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [load]);

  async function pullFromMeta() {
    setBusy(true);
    setError('');
    try {
      const out = await api.post('/leads/meta/sync');
      await load();
      if (out.imported === 0) setError('No new leads on Meta right now.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function drop(stageId) {
    setOverStage(null);
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    setLeads((l) => l.map((x) => (x.id === id ? { ...x, stage_id: stageId } : x)));
    try {
      await api.patch(`/leads/${id}/move`, { stage_id: stageId });
    } catch (e) {
      setError(e.message);
      load().catch(() => {});
    }
  }

  async function addLead() {
    const name = window.prompt('Lead name');
    if (!name) return;
    const phone = window.prompt('Phone number (with country code)') || '';
    const created = await api.post('/leads', { full_name: name, phone });
    setLeads((l) => [created, ...l]);
    setOpenId(created.id);
  }

  const term = query.trim().toLowerCase();
  const visible = term
    ? leads.filter((l) =>
        [l.full_name, l.phone, l.email, l.city, l.campaign_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
      )
    : leads;

  return (
    <>
      {error && <div className="notice bad">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn primary" onClick={pullFromMeta} disabled={busy}>
          {busy ? 'Pulling…' : 'Pull leads from Meta'}
        </button>
        <button className="btn" onClick={addLead}>Add lead</button>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="Search name, phone, city"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span style={{ color: 'var(--muted)' }} className="num">{visible.length} leads</span>
      </div>

      <div className="board">
        {stages.map((stage) => {
          const items = visible.filter((l) => l.stage_id === stage.id);
          return (
            <section
              key={stage.id}
              className={`col ${overStage === stage.id ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id); }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={() => drop(stage.id)}
            >
              <header className="col-head">
                <span className="col-dot" style={{ background: stage.color }} />
                <span className="col-name">{stage.name}</span>
                <span className="col-count">{items.length}</span>
              </header>
              <div className="col-body">
                {items.map((lead) => (
                  <article
                    key={lead.id}
                    className={`lead ${dragId === lead.id ? 'dragging' : ''}`}
                    style={{ '--spine': stage.color }}
                    draggable
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setOpenId(lead.id)}
                  >
                    <div className="who">{lead.full_name || 'Unnamed lead'}</div>
                    {lead.phone && <div className="meta">{lead.phone}</div>}
                    {lead.campaign_name && <div className="campaign">{lead.campaign_name}</div>}
                    <div className="row">
                      {lead.wants_whatsapp && <span className="tag good">WhatsApp</span>}
                      {lead.source === 'meta' && <span className="tag">Meta</span>}
                      {lead.source === 'manual' && <span className="tag off">Manual</span>}
                      {lead.message_count > 0 && <span className="tag off">{lead.message_count} msg</span>}
                      {lead.remark_count > 0 && <span className="tag off">{lead.remark_count} note</span>}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                        {when(lead.last_message_at || lead.created_at)}
                      </span>
                    </div>
                  </article>
                ))}
                {items.length === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: 12, padding: '10px 6px' }}>
                    Drop a lead here.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {openId && (
        <LeadDrawer
          leadId={openId}
          stages={stages}
          onClose={() => { setOpenId(null); load().catch(() => {}); }}
        />
      )}
    </>
  );
}
