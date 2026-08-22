import { useCallback, useEffect, useState } from 'react';
import { api, when } from '../api.js';
import LeadDrawer from '../components/LeadDrawer.jsx';

export default function Leads({ query, onBoardLoaded, syncSignal }) {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const board = await api.get('/leads/board');
    setStages(board.stages);
    setLeads(board.leads);
    onBoardLoaded?.(board.leads);
  }, [onBoardLoaded]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [load, syncSignal]);

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

  const term = (query || '').trim().toLowerCase();
  const visible = term
    ? leads.filter((l) =>
        [l.full_name, l.phone, l.email, l.city, l.campaign_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
      )
    : leads;

  const wonCount = leads.filter((l) => stages.find((s) => s.id === l.stage_id)?.is_won).length;

  return (
    <>
      <div className="board-bar">
        <div className="mono-label" style={{ textTransform: 'uppercase' }}>
          {leads.length} LEADS · {wonCount} WON · {stages.length} STAGES
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={addLead}>Add lead manually</button>
          <button className="btn primary" onClick={pullFromMeta} disabled={busy}>
            {busy ? 'Pulling…' : 'Pull from Meta'}
          </button>
        </div>
      </div>

      {error && <div className="notice bad" style={{ margin: '12px 24px 0' }}>{error}</div>}

      <div className="board">
        {stages.map((stage) => {
          const stageLeads = leads.filter((l) => l.stage_id === stage.id);
          const items = visible.filter((l) => l.stage_id === stage.id);
          const value = stageLeads.reduce((a, l) => a + Number(l.value || 0), 0);
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
              <div className="col-value">
                {stage.is_won ? 'PIPELINE CLOSED' : `${items.length} OF ${stageLeads.length} SHOWN`}
              </div>

              <div className="col-body">
                {items.map((lead) => (
                  <article
                    key={lead.id}
                    className={`lead ${dragId === lead.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setOpenId(lead.id)}
                  >
                    <div className="top-row">
                      <span className="who">{lead.full_name || 'Unnamed lead'}</span>
                      <span className="age">{when(lead.created_at)}</span>
                    </div>
                    {lead.phone && <div className="meta">{lead.phone}</div>}
                    {lead.campaign_name && <div className="campaign">{lead.campaign_name}</div>}
                    <div className="row">
                      {lead.message_count > 0 && <span className="tag">{lead.message_count} msg</span>}
                      <span className="tag off">{lead.remark_count || 0} note</span>
                      {lead.city && <span className="city">{lead.city}</span>}
                    </div>
                  </article>
                ))}
                {items.length === 0 && <div className="col-empty">Drop leads here</div>}
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
