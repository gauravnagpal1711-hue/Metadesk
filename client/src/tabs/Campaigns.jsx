import { useState } from 'react';
import { api, money, when } from '../api.js';

export default function Campaigns({ rows, setRows, conn, onSynced }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});

  async function sync() {
    setBusy(true);
    setError('');
    try {
      const out = await api.post('/campaigns/sync');
      setRows(out.campaigns);
      onSynced?.();
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

  return (
    <>
      {!conn.connected && (
        <div className="notice">
          <strong>Meta not connected.</strong> Open the <strong>Facebook</strong> tab and sign in to pull your campaigns.
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}

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
                <th style={{ textAlign: 'right' }}>Daily budget</th>
                <th style={{ textAlign: 'right' }}>Spend</th>
                <th style={{ textAlign: 'right' }}>Leads</th>
                <th style={{ textAlign: 'right' }}>CPL</th>
                <th style={{ textAlign: 'right' }}>CTR</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="name">{c.name}</div>
                    <div className="num" style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 2 }}>{c.id}</div>
                  </td>
                  <td>
                    <span className={`tag ${c.status === 'ACTIVE' ? 'good' : 'off'}`}>{c.status || '—'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
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
                  <td className="num" style={{ textAlign: 'right' }}>{money(c.spend)}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{money(c.leads_count)}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{Number(c.cpl) ? money(c.cpl) : '—'}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{Number(c.ctr).toFixed(2)}%</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm" onClick={() => toggle(c)}>
                      {c.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-foot">
            <span>SYNCED FROM META MARKETING API · EVERY 10 MIN</span>
            {rows[0]?.synced_at && <span style={{ marginLeft: 'auto' }}>{when(rows[0].synced_at)}</span>}
          </div>
        </div>
      )}
    </>
  );
}
