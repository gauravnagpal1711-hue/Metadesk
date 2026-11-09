import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, money, when } from './api.js';
import Login from './components/Login.jsx';
import Creative from './tabs/Creative.jsx';
import Campaigns from './tabs/Campaigns.jsx';
import Leads from './tabs/Leads.jsx';
import Insights from './tabs/Insights.jsx';
import Connect from './tabs/Connect.jsx';
import Facebook from './tabs/Facebook.jsx';
import ReachUs from './tabs/ReachUs.jsx';
import Flowchart from './tabs/Flowchart.jsx';
import AppointmentMessages from './tabs/AppointmentMessages.jsx';
import ReminderPopups from './components/ReminderPopups.jsx';

const TABS = [
  { id: 'creative', label: 'Advertise your Brand', title: 'Advertise your Brand', sub: 'Brief, image prompts, and creative gallery' },
  { id: 'campaigns', label: 'Campaigns', title: 'Campaigns', sub: 'Live from Meta Marketing API · inline budget edit' },
  { id: 'leads', label: 'Leads', title: 'Leads', sub: 'Drag leads through the funnel · click for detail' },
  { id: 'insights', label: 'Insights', title: 'Insights', sub: 'Pipeline conversion, velocity and lead sources' },
  { id: 'facebook', label: 'Facebook', title: 'Facebook', sub: 'OAuth connection, account and lead form mapping' },
  { id: 'apptmsgs', label: 'Appointment messages', title: 'Appointment messages', sub: 'Auto WhatsApp confirmation + day-before reminder' },
  { id: 'connect', label: 'WhatsApp', title: 'WhatsApp', sub: 'Connect your WhatsApp Business number' },
  { id: 'flowchart', label: 'How it works', title: 'How it works', sub: 'Live, step-by-step map of what’s done and what’s left' },
  { id: 'reachus', label: 'Reach Us', title: 'Reach Us', sub: 'Send a query straight to WhatsApp' }
];

// Phone layout: the first four tabs live in the bottom bar, everything else
// is one tap away in the "More" sheet. (Desktop ignores all of this.)
const MOBILE_PRIMARY = ['leads', 'campaigns', 'insights', 'creative'];
const MOBILE_LABEL = { leads: 'Leads', campaigns: 'Campaigns', insights: 'Insights', creative: 'Create' };

const ICONS = {
  leads: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.4-3.2 3-5 6-5s5.6 1.8 6 5" /><path d="M16 5.2a3 3 0 0 1 0 5.6M18.5 14.4c1.5.7 2.3 2.2 2.5 4.6" /></>,
  campaigns: <><path d="M4 13v-2.5a1.5 1.5 0 0 1 1.5-1.5H9l8-4v13l-8-4H5.5A1.5 1.5 0 0 1 4 13z" /><path d="M9 15l1 4.5h2.2L11.5 16" /></>,
  insights: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>,
  creative: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  facebook: <><path d="M14 8.5h2.5V5H14a3.5 3.5 0 0 0-3.5 3.5V11H8v3.5h2.5V21H14v-6.5h2.4l.6-3.5H14V8.8c0-.2.1-.3.3-.3z" /></>,
  apptmsgs: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  connect: <><path d="M4 20l1.2-4.1A8 8 0 1 1 8.2 19z" /><path d="M9 9.5c.3 2.4 2.6 4.7 5.5 5.5l1.3-1.3-2-1-1 .8c-.9-.4-1.7-1.2-2.1-2.1l.8-1-1-2z" /></>,
  flowchart: <><rect x="3.5" y="4" width="7" height="5" rx="1.2" /><rect x="13.5" y="15" width="7" height="5" rx="1.2" /><path d="M7 9v3.5a2 2 0 0 0 2 2h4.5" /></>,
  reachus: <><path d="M21 4L10.5 14.5" /><path d="M21 4l-6.5 17-4-6.5L4 10.5z" /></>,
  sync: <><path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4" /><path d="M5.5 3v4h4M18.5 21v-4h-4" /></>,
  logout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" /></>
};
function Icon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('leads');
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openLeadId, setOpenLeadId] = useState(null);
  const [leadCount, setLeadCount] = useState(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsConn, setCampaignsConn] = useState({ connected: false });
  const [fbConnected, setFbConnected] = useState(false);
  const [waConnected, setWaConnected] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncSignal, setSyncSignal] = useState(0);

  useEffect(() => {
    api.get('/auth/me').then((r) => setAuthed(r.authenticated)).catch(() => setAuthed(false));
  }, []);

  const refreshCampaigns = useCallback(async () => {
    const [rows, conn] = await Promise.all([
      api.get('/campaigns').catch(() => []),
      api.get('/campaigns/status').catch(() => ({ connected: false }))
    ]);
    setCampaigns(rows);
    setCampaignsConn(conn);
    setLastSyncedAt(new Date());
    return rows;
  }, []);

  const refreshConnections = useCallback(async () => {
    const [fb, wa] = await Promise.all([
      api.get('/facebook/status').catch(() => ({ connection: {} })),
      api.get('/whatsapp/status').catch(() => ({ web: {}, cloud: {} }))
    ]);
    setFbConnected(!!fb.connection?.hasToken);
    setWaConnected(wa.web?.status === 'connected' || !!wa.cloud?.connected);
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshCampaigns().catch(() => {});
    refreshConnections().catch(() => {});
    const t = setInterval(() => refreshConnections().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [authed, refreshCampaigns, refreshConnections]);

  const onBoardLoaded = useCallback((leads) => {
    setLeadCount(leads.length);
    setUnreadTotal(leads.reduce((n, l) => n + (l.unread_count || 0), 0));
    setLastSyncedAt(new Date());
  }, []);

  async function syncNow() {
    setSyncing(true);
    try {
      await refreshCampaigns();
      if (fbConnected) await api.post('/leads/meta/sync').catch(() => {});
      setSyncSignal((n) => n + 1);
    } finally {
      setSyncing(false);
    }
  }

  const totals = useMemo(
    () =>
      campaigns.reduce(
        (a, c) => ({
          spend: a.spend + Number(c.spend || 0),
          leads: a.leads + Number(c.leads_count || 0),
          active: a.active + (c.status === 'ACTIVE' ? 1 : 0)
        }),
        { spend: 0, leads: 0, active: 0 }
      ),
    [campaigns]
  );
  const cpl = totals.leads ? totals.spend / totals.leads : 0;

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const active = TABS.find((t) => t.id === tab);
  const showMetrics = tab === 'campaigns';
  const moreTabs = TABS.filter((t) => !MOBILE_PRIMARY.includes(t.id));
  const moreActive = !MOBILE_PRIMARY.includes(tab);
  const moreAttention = !fbConnected || !waConnected;
  const goTab = (id) => { setTab(id); setMoreOpen(false); window.scrollTo(0, 0); };
  const signOut = () => api.post('/auth/logout').then(() => setAuthed(false));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-mark">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M4 5.5H20M12 5.5V19" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="sidebar-title">Trustura Digital</div>
            <div className="sidebar-sub">Meta control room</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`sidebar-btn ${tab === t.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
              {t.id === 'leads' && leadCount != null && <span className="count">{leadCount}</span>}
              {t.id === 'leads' && unreadTotal > 0 && (
                <span className="unread-badge" title={`${unreadTotal} unread WhatsApp message${unreadTotal === 1 ? '' : 's'}`}>
                  {unreadTotal}
                </span>
              )}
              {t.id === 'facebook' && (
                <span className="conn-dot" style={{ background: fbConnected ? 'var(--good)' : 'var(--muted-2)' }} />
              )}
              {t.id === 'connect' && (
                <span className="conn-dot" style={{ background: waConnected ? 'var(--good)' : 'var(--warn)' }} />
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="mono-label">Last sync</div>
          <div className="sync-row">
            <span className="sync-dot" />
            {syncing ? 'syncing…' : lastSyncedAt ? when(lastSyncedAt) : '—'}
          </div>
          <button className="btn sm" onClick={syncNow} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            className="btn ghost sm"
            onClick={() => api.post('/auth/logout').then(() => setAuthed(false))}
          >
            Sign out
          </button>
          <div className="legal-links">
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            <span>·</span>
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-mark" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 5.5H20M12 5.5V19" stroke="white" strokeWidth="2.8" strokeLinecap="round" /></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1>{active.title}</h1>
            <div className="sub">{active.sub}</div>
          </div>
          <button className="icon-btn mobile-only" onClick={syncNow} disabled={syncing} aria-label="Sync now">
            <span className={syncing ? 'spin' : ''}><Icon name="sync" size={20} /></span>
          </button>
          <div className="actions">
            {tab === 'leads' && (
              <input
                className="input search"
                placeholder="Search name, phone, city"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <span className={`pill-status ${fbConnected ? 'good' : ''}`}>
              <span className="dot" />
              {fbConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
        </header>

        {showMetrics && (
          <div className="metrics-strip">
            <div className="cell">
              <div className="k">Spend · 30d</div>
              <div className="v">₹{money(totals.spend)}</div>
            </div>
            <div className="cell">
              <div className="k">Leads</div>
              <div className="v">{leadCount != null ? leadCount : money(totals.leads)}</div>
            </div>
            <div className="cell">
              <div className="k">Cost per lead</div>
              <div className="v">{cpl ? `₹${money(cpl)}` : '—'}</div>
            </div>
            <div className="cell">
              <div className="k">Running</div>
              <div className="v">{totals.active} <span className="sub">of {campaigns.length}</span></div>
            </div>
          </div>
        )}

        <div className="page" style={tab === 'leads' ? { padding: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 } : undefined}>
          {tab === 'creative' && <Creative />}
          {tab === 'campaigns' && (
            <Campaigns rows={campaigns} setRows={setCampaigns} conn={campaignsConn} onSynced={refreshCampaigns} />
          )}
          {tab === 'leads' && (
            <Leads
              query={query}
              onQueryChange={setQuery}
              onBoardLoaded={onBoardLoaded}
              syncSignal={syncSignal}
              campaigns={campaigns}
              openLeadId={openLeadId}
              onLeadOpened={() => setOpenLeadId(null)}
            />
          )}
          {tab === 'insights' && <Insights campaigns={campaigns} syncSignal={syncSignal} />}
          {tab === 'facebook' && <Facebook onConnectionChange={refreshConnections} onNavigate={setTab} />}
          {tab === 'connect' && <Connect onConnectionChange={refreshConnections} />}
          {tab === 'apptmsgs' && <AppointmentMessages />}
          {tab === 'flowchart' && <Flowchart />}
          {tab === 'reachus' && <ReachUs />}
        </div>
      </main>

      {/* ---- phone-only: bottom tab bar + "More" sheet ---- */}
      <nav className="tabbar" aria-label="Main">
        {MOBILE_PRIMARY.map((id) => (
          <button key={id} className={`tabbar-btn ${tab === id ? 'on' : ''}`} onClick={() => goTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <span className="tabbar-ico">
              <Icon name={id} />
              {id === 'leads' && unreadTotal > 0 && <span className="tabbar-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>}
            </span>
            <span className="tabbar-lbl">{MOBILE_LABEL[id]}</span>
          </button>
        ))}
        <button className={`tabbar-btn ${moreActive || moreOpen ? 'on' : ''}`} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
          <span className="tabbar-ico">
            <Icon name="more" />
            {moreAttention && <span className="tabbar-dot" />}
          </span>
          <span className="tabbar-lbl">More</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="more-scrim" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet" role="dialog" aria-label="More">
            <div className="sheet-grab" />
            <div className="more-grid">
              {moreTabs.map((t) => (
                <button key={t.id} className={`more-item ${tab === t.id ? 'on' : ''}`} onClick={() => goTab(t.id)}>
                  <span className="more-ico">
                    <Icon name={t.id} size={22} />
                    {t.id === 'facebook' && <span className="conn-dot" style={{ background: fbConnected ? 'var(--good)' : 'var(--warn)' }} />}
                    {t.id === 'connect' && <span className="conn-dot" style={{ background: waConnected ? 'var(--good)' : 'var(--warn)' }} />}
                  </span>
                  <span className="more-lbl">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="more-actions">
              <button className="more-row" onClick={() => { setMoreOpen(false); syncNow(); }} disabled={syncing}>
                <Icon name="sync" size={18} />
                <span>{syncing ? 'Syncing…' : 'Sync now'}</span>
                <span className="more-row-sub">{lastSyncedAt ? when(lastSyncedAt) : '—'}</span>
              </button>
              <button className="more-row danger" onClick={signOut}>
                <Icon name="logout" size={18} />
                <span>Sign out</span>
              </button>
            </div>
            <div className="legal-links" style={{ justifyContent: 'center' }}>
              <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              <span>·</span>
              <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            </div>
          </div>
        </>
      )}

      <ReminderPopups
        enabled={!!authed}
        onOpenLead={(id) => { setTab('leads'); setOpenLeadId(id); }}
        onGoToLeads={() => setTab('leads')}
      />
    </div>
  );
}
