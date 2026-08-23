import { useCallback, useEffect, useState } from 'react';
import { api, when } from '../api.js';
import LeadDrawer from '../components/LeadDrawer.jsx';
import AddLeadModal from '../components/AddLeadModal.jsx';
import ManageStagesModal from '../components/ManageStagesModal.jsx';
import CampaignFilter from '../components/CampaignFilter.jsx';
import StageCampaignSummary from '../components/StageCampaignSummary.jsx';

export default function Leads({ query, onBoardLoaded, syncSignal, campaigns = [] }) {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState([]);
  const [sortState, setSortState] = useState({}); // { [stageId]: { field: 'created'|'updated'|'name'|'followup'|'appointment', dir: 'asc'|'desc' } }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [pendingDrop, setPendingDrop] = useState(null); // { leadId, stageId, stageName, needsAppointment, needsFollowup, appointmentDate, followupDate }

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

    const lead = leads.find((l) => l.id === id);
    const stage = stages.find((s) => s.id === stageId);
    const needsAppointment = !!stage?.requires_appointment_date && !lead?.appointment_date;
    const needsFollowup = !!stage?.requires_followup_date && !lead?.followup_date;
    if (needsAppointment || needsFollowup) {
      setPendingDrop({ leadId: id, stageId, stageName: stage?.name, needsAppointment, needsFollowup, appointmentDate: '', followupDate: '' });
      return;
    }

    setLeads((l) => l.map((x) => (x.id === id ? { ...x, stage_id: stageId } : x)));
    try {
      await api.patch(`/leads/${id}/move`, { stage_id: stageId });
    } catch (e) {
      setError(e.message);
      load().catch(() => {});
    }
  }

  async function confirmPendingDrop() {
    const { leadId, stageId, needsAppointment, needsFollowup, appointmentDate, followupDate } = pendingDrop;
    if (needsAppointment && !appointmentDate) return;
    if (needsFollowup && !followupDate) return;
    setError('');
    try {
      const body = { stage_id: stageId };
      if (needsAppointment) body.appointment_date = new Date(appointmentDate).toISOString();
      if (needsFollowup) body.followup_date = new Date(followupDate).toISOString();
      await api.patch(`/leads/${leadId}/move`, body);
      setPendingDrop(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  function copyPhone(e, phone, id) {
    e.stopPropagation();
    navigator.clipboard?.writeText(phone);
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
  }

  function onLeadCreated(created) {
    setLeads((l) => [created, ...l]);
    setAddOpen(false);
    setOpenId(created.id);
  }

  const distinctCampaigns = [...new Set(leads.map((l) => l.campaign_name).filter(Boolean))].sort();

  const DEFAULT_SORT = { field: 'created', dir: 'desc' };
  const SORT_FIELD_KEYS = { created: 'created_at', updated: 'updated_at', followup: 'followup_date', appointment: 'appointment_date' };

  function getSort(stageId) {
    return sortState[stageId] || DEFAULT_SORT;
  }

  function setSortField(stageId, field) {
    setSortState((s) => ({ ...s, [stageId]: { ...getSort(stageId), field } }));
  }

  function toggleSortDir(stageId) {
    setSortState((s) => {
      const cur = getSort(stageId);
      return { ...s, [stageId]: { ...cur, dir: cur.dir === 'asc' ? 'desc' : 'asc' } };
    });
  }

  function sortLeads(list, stageId) {
    const { field, dir } = getSort(stageId);
    const mul = dir === 'desc' ? -1 : 1;
    const sorted = [...list];
    if (field === 'name') {
      sorted.sort((a, b) => mul * (a.full_name || '').localeCompare(b.full_name || ''));
    } else {
      const key = SORT_FIELD_KEYS[field] || 'created_at';
      sorted.sort((a, b) => {
        const av = a[key] ? new Date(a[key]).getTime() : null;
        const bv = b[key] ? new Date(b[key]).getTime() : null;
        if (av === null && bv === null) return 0;
        if (av === null) return 1; // undated leads always sort last
        if (bv === null) return -1;
        return mul * (av - bv);
      });
    }
    return sorted;
  }

  const term = (query || '').trim().toLowerCase();
  const visible = leads
    .filter((l) => !term || [l.full_name, l.phone, l.email, l.city, l.campaign_name]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term)))
    .filter((l) => campaignFilter.length === 0 || campaignFilter.includes(l.campaign_name));

  const wonCount = leads.filter((l) => stages.find((s) => s.id === l.stage_id)?.is_won).length;

  return (
    <>
      <div className="board-bar">
        <div className="mono-label" style={{ textTransform: 'uppercase' }}>
          {leads.length} LEADS · {wonCount} WON · {stages.length} STAGES
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <CampaignFilter options={distinctCampaigns} selected={campaignFilter} onChange={setCampaignFilter} />
          <button className="btn" onClick={() => setStagesOpen(true)}>Manage stages</button>
          <button className="btn" onClick={() => setAddOpen(true)}>Add lead manually</button>
          <button className="btn primary" onClick={pullFromMeta} disabled={busy}>
            {busy ? 'Pulling…' : 'Pull from Meta'}
          </button>
        </div>
      </div>

      <StageCampaignSummary stages={stages} leads={visible} onPickCampaign={(name) => setCampaignFilter([name])} />

      {error && <div className="notice bad" style={{ margin: '12px 24px 0' }}>{error}</div>}

      <div className="board">
        {stages.map((stage) => {
          const stageLeads = leads.filter((l) => l.stage_id === stage.id);
          const items = sortLeads(visible.filter((l) => l.stage_id === stage.id), stage.id);
          const value = stageLeads.reduce((a, l) => a + Number(l.value || 0), 0);
          const sort = getSort(stage.id);
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

              <div className="col-sort">
                <select className="select" value={sort.field} onChange={(e) => setSortField(stage.id, e.target.value)}>
                  <option value="name">Name</option>
                  <option value="created">Created</option>
                  <option value="updated">Updated</option>
                  <option value="followup">Followup</option>
                  <option value="appointment">Appointment</option>
                </select>
                <button
                  className="dir-btn"
                  onClick={() => toggleSortDir(stage.id)}
                  title={sort.dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                  aria-label="Toggle sort direction"
                >
                  {sort.dir === 'asc' ? '↑' : '↓'}
                </button>
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
                    {lead.phone && (
                      <div className="meta phone-row">
                        <button
                          className="copy-btn"
                          onClick={(e) => copyPhone(e, lead.phone, lead.id)}
                          title="Copy phone number"
                          aria-label="Copy phone number"
                        >
                          {copiedId === lead.id ? '✓' : '📋'}
                        </button>
                        {lead.phone}
                      </div>
                    )}
                    {lead.campaign_name && <div className="campaign">{lead.campaign_name}</div>}
                    {lead.appointment_date && (
                      <div className="appointment-date">
                        📅 {new Date(lead.appointment_date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    {lead.followup_date && (
                      <div className="followup-date">
                        ⏰ {new Date(lead.followup_date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
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

      {addOpen && (
        <AddLeadModal
          stages={stages}
          campaigns={campaigns}
          onClose={() => setAddOpen(false)}
          onCreated={onLeadCreated}
          onBulkImported={() => load().catch(() => {})}
        />
      )}

      {stagesOpen && (
        <ManageStagesModal
          stages={stages}
          onClose={() => setStagesOpen(false)}
          onChanged={setStages}
        />
      )}

      {pendingDrop && (
        <>
          <div className="scrim" onClick={() => setPendingDrop(null)} />
          <div style={{ position: 'fixed', inset: 0, zIndex: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" style={{ width: '100%', maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ margin: 0 }}>Moving to {pendingDrop.stageName}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {pendingDrop.needsAppointment && (
                  <div className="field">
                    <label>Appointment date</label>
                    <input
                      type="datetime-local"
                      className="input"
                      value={pendingDrop.appointmentDate}
                      onChange={(e) => setPendingDrop((p) => ({ ...p, appointmentDate: e.target.value }))}
                      autoFocus
                    />
                  </div>
                )}
                {pendingDrop.needsFollowup && (
                  <div className="field">
                    <label>Followup date</label>
                    <input
                      type="datetime-local"
                      className="input"
                      value={pendingDrop.followupDate}
                      onChange={(e) => setPendingDrop((p) => ({ ...p, followupDate: e.target.value }))}
                      autoFocus={!pendingDrop.needsAppointment}
                    />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setPendingDrop(null)}>Cancel</button>
                <button
                  className="btn primary"
                  onClick={confirmPendingDrop}
                  disabled={(pendingDrop.needsAppointment && !pendingDrop.appointmentDate) || (pendingDrop.needsFollowup && !pendingDrop.followupDate)}
                >
                  Move lead
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
