import { useEffect, useState } from 'react';
import { api, money, when } from '../api.js';
import CreateCampaignModal from '../components/CreateCampaignModal.jsx';
import WhatsAppNumberSetting from '../components/WhatsAppNumberSetting.jsx';

export default function Campaigns({ rows, setRows, conn, onSynced }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [creatives, setCreatives] = useState([]);
  const [briefs, setBriefs] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    api.get('/creatives').then(setCreatives).catch(() => {});
    api.get('/campaign-briefs').then(setBriefs).catch(() => {});
  }, []);

  async function deleteBrief(id) {
    if (!window.confirm('Delete this campaign brief?')) return;
    try {
      await api.del(`/campaign-briefs/${id}`);
      setBriefs((b) => b.filter((x) => x.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

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

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <button className="btn primary" onClick={sync} disabled={busy || !conn.connected}>
          {busy ? 'Syncing…' : 'Sync from Meta'}
        </button>
        <button className="btn" onClick={() => setCreateOpen(true)}>Create campaign</button>
        {rows[0]?.synced_at && <span className="sub" style={{ color: 'var(--muted)' }}>Updated {when(rows[0].synced_at)}</span>}
      </div>

      <div className="card" style={{ marginBottom: 14, padding: '10px 14px' }}>
        <WhatsAppNumberSetting />
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

      {briefs.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Campaign briefs</h2>
            <span className="mono-label">{briefs.length}</span>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Creative</th><th style={{ textAlign: 'right' }}>Daily ₹</th><th>Status</th><th>Next step</th><th></th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td><div className="name">{b.name}</div><div className="num" style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>brief #{b.id}</div></td>
                    <td>{b.creative_label || b.creative_headline || (b.creative_id ? `#${b.creative_id}` : '—')}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{b.daily_budget ? money(b.daily_budget) : '—'}</td>
                    <td><span className={`tag ${b.status === 'created' || b.status === 'live' ? 'good' : b.status === 'ready' ? 'warn' : 'off'}`}>{b.status}</span></td>
                    <td style={{ fontSize: 12.5 }}>
                      {b.status === 'ready' && <>Tell Claude: <code>create campaign brief #{b.id}</code></>}
                      {b.status === 'draft' && 'Finish the brief (needs an approved creative + budget)'}
                      {b.status === 'created' && <>PAUSED on Meta · <span className="num">{b.meta_campaign_id}</span> · say <code>turn on brief #{b.id}</code></>}
                      {b.status === 'live' && <>Live · <span className="num">{b.meta_campaign_id}</span></>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn sm ghost danger" onClick={() => deleteBrief(b.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateCampaignModal
          creatives={creatives}
          onClose={() => setCreateOpen(false)}
          onSaved={(saved) => { setBriefs((b) => [saved, ...b]); setCreateOpen(false); }}
        />
      )}
    </>
  );
}
