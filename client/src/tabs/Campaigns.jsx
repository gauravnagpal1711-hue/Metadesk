import { useEffect, useState } from 'react';
import { api, money, when } from '../api.js';

export default function Campaigns() {
  const [rows, setRows] = useState([]);
  const [conn, setConn] = useState({ connected: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    api.get('/campaigns/status').then(setConn).catch(() => {});
    api.get('/campaigns').then(setRows).catch(() => {});
  }, []);

  async function sync() {
    setBusy(true);
    setError('');
    try {
      const out = await api.post('/campaigns/sync');
      setRows(out.campaigns);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c) {
    const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setError('');
    try {
      await api.patch(`/campaigns/${c.id}`, { status: next });
      setRows((r) => r.map((x) => (x.id === c.id ? { ...x, status: next, effective_status: next } : x)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveBudget(c) {
    const value = drafts[c.id];
    if (value == null || value === '' || Number(value) === Number(c.daily_budget)) return;
    setError('');
    try {
      await api.patch(`/campaigns/${c.id}`, { daily_budget: Number(value) });
      setRows((r) => r.map((x) => (x.id === c.id ? { ...x, daily_budget: Number(value) } : x)));
    } catch (e) {
      setError(e.message);
    }
  }

  const totals = rows.reduce(
    (a, c) => ({
      spend: a.spend + Number(c.spend || 0),
      leads: a.leads + Number(c.leads_count || 0),
      clicks: a.clicks + Number(c.clicks || 0),
      active: a.active + (c.status === 'ACTIVE' ? 1 : 0)
    }),
    { spend: 0, leads: 0, clicks: 0, active: 0 }
  );
  const cpl = totals.leads ? totals.spend / totals.leads : 0;

  return (
    <>
      {!conn.connected && (
        <div className="notice">
          <strong>Meta not connected.</strong> Open the <strong>Facebook</strong> tab and sign in to pull your campaigns.
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}

      <div className="stats">
        <div className="stat"><div className="k">Spend · 30d</div><div className="v num">{money(totals.spend)}</div></div>
        <div className="stat"><div className="k">Leads</div><div className="v num">{money(totals.leads)}</div></div>
        <div className="stat"><div className="k">Cost per lead</div><div className="v num">{cpl ? money(cpl) : '—'}</div></div>
        <div className="stat"><div className="k">Running</div><div className="v num">{totals.active}/{rows.length}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <button className="btn primary" onClick={sync} disabled={busy || !conn.connected}>
          {busy ? 'Syncing…' : 'Sync from Meta'}
        </button>
        {rows[0]?.synced_at && <span className="sub" style={{ color: 'var(--muted)' }}>Updated {when(rows[0].synced_at)}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>No campaigns yet</h3>
          Connect your ad account and hit Sync from Meta to pull everything in.
        </div>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Daily budget</th>
                <th>Spend</th>
                <th>Leads</th>
                <th>CPL</th>
                <th>CTR</th>
                <th>Clicks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="name">{c.name}</div>
                    <div className="num" style={{ fontSize: 11, color: 'var(--muted)' }}>{c.objective || '—'}</div>
                  </td>
                  <td>
                    <span className={`tag ${c.status === 'ACTIVE' ? 'good' : 'off'}`}>{c.status || '—'}</span>
                  </td>
                  <td>
                    <input
                      className="input budget-input num"
                      type="number"
                      min="0"
                      value={drafts[c.id] ?? (c.daily_budget ?? '')}
                      onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
                      onBlur={() => saveBudget(c)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      placeholder="—"
                    />
                  </td>
                  <td className="num">{money(c.spend)}</td>
                  <td className="num">{money(c.leads_count)}</td>
                  <td className="num">{Number(c.cpl) ? money(c.cpl) : '—'}</td>
                  <td className="num">{Number(c.ctr).toFixed(2)}%</td>
                  <td className="num">{money(c.clicks)}</td>
                  <td>
                    <button className="btn sm" onClick={() => toggle(c)}>
                      {c.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
