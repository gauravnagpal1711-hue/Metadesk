import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import LeadDrawer from '../components/LeadDrawer.jsx';
import AddLeadModal from '../components/AddLeadModal.jsx';
import ManageStagesModal from '../components/ManageStagesModal.jsx';
import StageCampaignSummary from '../components/StageCampaignSummary.jsx';
import LeadBoard from '../components/LeadBoard.jsx';
import LeadTable from '../components/LeadTable.jsx';
import LeadFilterBar, { EMPTY_FILTERS } from '../components/LeadFilterBar.jsx';
import SavedViews from '../components/SavedViews.jsx';
import TaskStrip from '../components/TaskStrip.jsx';
import { bucketOf } from '../lib/dateBuckets.js';

const LAYOUT_KEY = 'adsdesk.leads.layout';

function dateBucketMatch(iso, bucket) {
  if (bucket === 'none') return !iso;
  if (!iso) return false;
  if (bucket === 'overdue') return bucketOf(iso) === 'overdue';
  if (bucket === 'today') return bucketOf(iso) === 'today';
  if (bucket === 'next7') {
    const d = new Date(iso);
    return d >= new Date() && d < new Date(Date.now() + 7 * 86400000);
  }
  return true;
}

function matchesFilters(lead, f, term) {
  if (term && ![lead.full_name, lead.phone, lead.email, lead.city, lead.campaign_name]
    .filter(Boolean).some((v) => String(v).toLowerCase().includes(term))) return false;
  if (f.stages.length && !f.stages.includes(lead.stage_id)) return false;
  if (f.sources.length && !f.sources.includes(lead.source)) return false;
  if (f.campaigns.length && !f.campaigns.includes(lead.campaign_name)) return false;
  if (f.tags.length && !(lead.tags || []).some((t) => f.tags.includes(t))) return false;
  if (f.followup && !dateBucketMatch(lead.followup_date, f.followup)) return false;
  if (f.appointment && !dateBucketMatch(lead.appointment_date, f.appointment)) return false;
  if (f.valueMin !== '' && Number(lead.value || 0) < Number(f.valueMin)) return false;
  if (f.valueMax !== '' && Number(lead.value || 0) > Number(f.valueMax)) return false;
  if (f.createdAfter && new Date(lead.created_at) < new Date(f.createdAfter)) return false;
  if (f.adsDeskOnly && !lead.from_adsdesk) return false;
  return true;
}

export default function Leads({ query, onBoardLoaded, syncSignal, campaigns = [] }) {
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState(() => localStorage.getItem(LAYOUT_KEY) || 'board');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [tableReload, setTableReload] = useState(0);

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

  function setLayoutPersist(next) {
    setLayout(next);
    localStorage.setItem(LAYOUT_KEY, next);
  }

  function reloadAll() {
    load().catch((e) => setError(e.message));
    setTableReload((n) => n + 1);
  }

  async function pullFromMeta() {
    setBusy(true);
    setError('');
    try {
      const out = await api.post('/leads/meta/sync');
      reloadAll();
      if (out.imported === 0) setError('No new leads on Meta right now.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function onLeadCreated(created) {
    setLeads((l) => [created, ...l]);
    setAddOpen(false);
    setOpenId(created.id);
  }

  const term = (query || '').trim().toLowerCase();
  const distinctCampaigns = useMemo(
    () => [...new Set([...leads.map((l) => l.campaign_name), ...campaigns.map((c) => c.name)].filter(Boolean))].sort(),
    [leads, campaigns]
  );
  const distinctTags = useMemo(
    () => [...new Set(leads.flatMap((l) => l.tags || []))].sort(),
    [leads]
  );

  const visibleLeads = useMemo(
    () => leads.filter((l) => matchesFilters(l, filters, term)),
    [leads, filters, term]
  );

  const wonCount = leads.filter((l) => stages.find((s) => s.id === l.stage_id)?.is_won).length;

  return (
    <>
      <div className="board-bar">
        <div className="layout-toggle">
          <button className={`btn sm ${layout === 'board' ? 'primary' : ''}`} onClick={() => setLayoutPersist('board')}>Board</button>
          <button className={`btn sm ${layout === 'table' ? 'primary' : ''}`} onClick={() => setLayoutPersist('table')}>Table</button>
        </div>
        <div className="mono-label" style={{ textTransform: 'uppercase' }}>
          {leads.length} LEADS · {wonCount} WON · {stages.length} STAGES
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <SavedViews
            currentFilters={filters}
            currentLayout={layout}
            onApply={({ filters: f, layout: l }) => { setFilters({ ...EMPTY_FILTERS, ...f }); if (l) setLayoutPersist(l); }}
          />
          <button className="btn" onClick={() => setStagesOpen(true)}>Manage stages</button>
          <button className="btn" onClick={() => setAddOpen(true)}>Add lead manually</button>
          <button className="btn primary" onClick={pullFromMeta} disabled={busy}>
            {busy ? 'Pulling…' : 'Pull from Meta'}
          </button>
        </div>
      </div>

      <LeadFilterBar
        filters={filters}
        onChange={setFilters}
        stages={stages}
        campaigns={distinctCampaigns}
        tags={distinctTags}
      />

      <TaskStrip reloadSignal={tableReload} onOpenLead={setOpenId} onChanged={reloadAll} />

      {layout === 'board' && (
        <StageCampaignSummary stages={stages} leads={visibleLeads} onPickCampaign={(name) => setFilters((f) => ({ ...f, campaigns: [name] }))} />
      )}

      {error && <div className="notice bad" style={{ margin: '12px 24px 0' }}>{error}</div>}

      {layout === 'board' ? (
        <LeadBoard
          stages={stages}
          leads={visibleLeads}
          onOpenLead={setOpenId}
          onReload={reloadAll}
          setError={setError}
        />
      ) : (
        <LeadTable
          filters={filters}
          query={term}
          stages={stages}
          onOpenLead={setOpenId}
          reloadSignal={tableReload}
          onChanged={() => load().catch(() => {})}
          setError={setError}
        />
      )}

      {openId && (
        <LeadDrawer
          leadId={openId}
          stages={stages}
          onClose={() => { setOpenId(null); reloadAll(); }}
        />
      )}

      {addOpen && (
        <AddLeadModal
          stages={stages}
          campaigns={campaigns}
          onClose={() => setAddOpen(false)}
          onCreated={onLeadCreated}
          onBulkImported={() => reloadAll()}
        />
      )}

      {stagesOpen && (
        <ManageStagesModal
          stages={stages}
          onClose={() => setStagesOpen(false)}
          onChanged={setStages}
        />
      )}
    </>
  );
}
