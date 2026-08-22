import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, money, when } from './api.js';
import Login from './components/Login.jsx';
import Creative from './tabs/Creative.jsx';
import Campaigns from './tabs/Campaigns.jsx';
import Leads from './tabs/Leads.jsx';
import Connect from './tabs/Connect.jsx';
import Facebook from './tabs/Facebook.jsx';

const TABS = [
  { id: 'creative', label: 'Build Your Brand', title: 'Build Your Brand', sub: 'Brief, image prompts, and creative gallery' },
  { id: 'campaigns', label: 'Campaigns', title: 'Campaigns', sub: 'Live from Meta Marketing API · inline budget edit' },
  { id: 'leads', label: 'Leads', title: 'Leads', sub: 'Drag leads through the funnel · click for detail' },
  { id: 'facebook', label: 'Facebook', title: 'Facebook', sub: 'OAuth connection, account and lead form mapping' },
  { id: 'connect', label: 'WhatsApp', title: 'WhatsApp', sub: 'Pair a device or point the Cloud API webhook here' }
];

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('leads');
  const [query, setQuery] = useState('');
  const [leadCount, setLeadCount] = useState(null);
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
  const showMetrics = tab === 'leads' || tab === 'campaigns';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-mark">A</div>
          <div>
            <div className="sidebar-title">Ads Desk</div>
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
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            <h1>{active.title}</h1>
            <div className="sub">{active.sub}</div>
          </div>
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
            <Leads query={query} onQueryChange={setQuery} onBoardLoaded={onBoardLoaded} syncSignal={syncSignal} campaigns={campaigns} />
          )}
          {tab === 'facebook' && <Facebook onConnectionChange={refreshConnections} />}
          {tab === 'connect' && <Connect onConnectionChange={refreshConnections} />}
        </div>
      </main>
    </div>
  );
}
