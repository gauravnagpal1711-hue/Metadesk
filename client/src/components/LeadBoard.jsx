import { useState } from 'react';
import { api, when } from '../api.js';
import { bucketOf, shortDateTime } from '../lib/dateBuckets.js';

const DEFAULT_SORT = { field: 'created', dir: 'desc' };
const SORT_FIELD_KEYS = {
  created: 'created_at',
  updated: 'updated_at',
  followup: 'followup_date',
  appointment: 'appointment_date'
};

/**
 * Sort choices depend on the stage. Every stage sorts by Created / Updated; the
 * follow-up stage also sorts by its follow-up date, the appointment stage by its
 * appointment date. No other sort fields.
 */
const BASE_SORT_OPTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' }
];
function sortOptionsFor(stage) {
  const opts = [...BASE_SORT_OPTIONS];
  if (stage.requires_followup_date) opts.push({ value: 'followup', label: 'Follow-up date' });
  if (stage.requires_appointment_date) opts.push({ value: 'appointment', label: 'Appointment date' });
  return opts;
}

/** The Kanban layout. `leads` arrives already filtered by the container. */
export default function LeadBoard({ stages, leads, unreadFirst = false, onOpenLead, onReload, setError }) {
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [sortState, setSortState] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [pendingDrop, setPendingDrop] = useState(null);

  function getSort(stageId) {
    return sortState[stageId] || DEFAULT_SORT;
  }
  /** getSort clamped to a field this stage actually offers. */
  function resolvedSort(stage) {
    const cur = getSort(stage.id);
    return sortOptionsFor(stage).some((o) => o.value === cur.field) ? cur : { ...cur, field: 'created' };
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
  function sortLeads(list, stage) {
    const { field, dir } = resolvedSort(stage);
    const mul = dir === 'desc' ? -1 : 1;
    const key = SORT_FIELD_KEYS[field] || 'created_at';
    const sorted = [...list];
    sorted.sort((a, b) => {
      const av = a[key] ? new Date(a[key]).getTime() : null;
      const bv = b[key] ? new Date(b[key]).getTime() : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return mul * (av - bv);
    });
    return sorted;
  }

  async function drop(stageId) {
    setOverStage(null);
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    const lead = leads.find((l) => l.id === id);
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || lead?.stage_id === stageId) return;

    const needsAppointment = !!stage.requires_appointment_date && !lead?.appointment_date;
    const needsFollowup = !!stage.requires_followup_date && !lead?.followup_date;
    const needsLostReason = !!stage.is_lost && !lead?.lost_reason;
    if (needsAppointment || needsFollowup || needsLostReason) {
      setPendingDrop({ leadId: id, stageId, stageName: stage.name, needsAppointment, needsFollowup, needsLostReason, appointmentDate: '', followupDate: '', lostReason: '' });
      return;
    }

    try {
      await api.patch(`/leads/${id}/move`, { stage_id: stageId });
      onReload();
    } catch (e) {
      setError(e.message);
      onReload();
    }
  }

  async function confirmPendingDrop() {
    const { leadId, stageId, needsAppointment, needsFollowup, needsLostReason, appointmentDate, followupDate, lostReason } = pendingDrop;
    if (needsAppointment && !appointmentDate) return;
    if (needsFollowup && !followupDate) return;
    if (needsLostReason && !lostReason.trim()) return;
    setError('');
    try {
      const body = { stage_id: stageId };
      if (needsAppointment) body.appointment_date = new Date(appointmentDate).toISOString();
      if (needsFollowup) body.followup_date = new Date(followupDate).toISOString();
      if (needsLostReason) body.lost_reason = lostReason.trim();
      await api.patch(`/leads/${leadId}/move`, body);
      setPendingDrop(null);
      onReload();
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

  return (
    <>
      <div className="board">
        {stages.map((stage) => {
          const stageLeads = leads.filter((l) => l.stage_id === stage.id);
          let items = sortLeads(stageLeads, stage);
          if (unreadFirst) {
            // Stable partition: unread leads to the top, each group keeps its sort.
            items = [...items].sort(
              (a, b) => (b.unread_count > 0 ? 1 : 0) - (a.unread_count > 0 ? 1 : 0)
            );
          }
          const value = stageLeads.reduce((a, l) => a + Number(l.value || 0), 0);
          const sort = resolvedSort(stage);
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
                {stage.is_won ? 'PIPELINE CLOSED' : value > 0 ? `₹${value.toLocaleString('en-IN')} IN STAGE` : `${items.length} LEAD${items.length === 1 ? '' : 'S'}`}
              </div>

              <div className="col-sort">
                <select className="select" value={sort.field} onChange={(e) => setSortField(stage.id, e.target.value)}>
                  {sortOptionsFor(stage).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
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
                {items.map((lead) => {
                  const fBucket = bucketOf(lead.followup_date);
                  const aBucket = bucketOf(lead.appointment_date);
                  return (
                    <article
                      key={lead.id}
                      className={`lead ${dragId === lead.id ? 'dragging' : ''} ${lead.unread_count > 0 ? 'has-unread' : ''}`}
                      draggable
                      onDragStart={() => setDragId(lead.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => onOpenLead(lead.id)}
                    >
                      <div className="top-row">
                        {lead.unread_count > 0 && (
                          <span
                            className="unread-badge"
                            title={`${lead.unread_count} unread WhatsApp message${lead.unread_count === 1 ? '' : 's'}`}
                          >
                            {lead.unread_count}
                          </span>
                        )}
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
                      {lead.campaign_name && (
                        <div className="campaign">
                          {lead.campaign_name}
                          {lead.from_adsdesk && <span className="tag good" style={{ marginLeft: 5 }}>Ads Desk</span>}
                        </div>
                      )}
                      {lead.tags?.length > 0 && (
                        <div className="lead-tags">
                          {lead.tags.map((t) => <span key={t} className="tag off">{t}</span>)}
                        </div>
                      )}
                      {lead.appointment_date && (
                        <div className={`date-chip ${aBucket}`}>📅 {shortDateTime(lead.appointment_date)}</div>
                      )}
                      {lead.followup_date && (
                        <div className={`date-chip ${fBucket}`}>⏰ {shortDateTime(lead.followup_date)}</div>
                      )}
                      <div className="row">
                        {lead.message_count > 0 && <span className="tag">{lead.message_count} msg</span>}
                        <span className="tag off">{lead.remark_count || 0} note</span>
                        {lead.open_task_count > 0 && <span className="tag warn">{lead.open_task_count} task</span>}
                        {lead.last_contacted_at && <span className="city">talked {when(lead.last_contacted_at)}</span>}
                        {lead.city && <span className="city">{lead.city}</span>}
                      </div>
                    </article>
                  );
                })}
                {items.length === 0 && <div className="col-empty">Drop leads here</div>}
              </div>
            </section>
          );
        })}
      </div>

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
                {pendingDrop.needsLostReason && (
                  <div className="field">
                    <label>Lost reason</label>
                    <input
                      className="input"
                      placeholder="Budget too low / went with a competitor / no response…"
                      value={pendingDrop.lostReason}
                      onChange={(e) => setPendingDrop((p) => ({ ...p, lostReason: e.target.value }))}
                      autoFocus={!pendingDrop.needsAppointment && !pendingDrop.needsFollowup}
                    />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setPendingDrop(null)}>Cancel</button>
                <button
                  className="btn primary"
                  onClick={confirmPendingDrop}
                  disabled={
                    (pendingDrop.needsAppointment && !pendingDrop.appointmentDate) ||
                    (pendingDrop.needsFollowup && !pendingDrop.followupDate) ||
                    (pendingDrop.needsLostReason && !pendingDrop.lostReason.trim())
                  }
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
