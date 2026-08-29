import { useEffect, useMemo, useState } from 'react';
import { api, money, when } from '../api.js';
import CreateCampaignModal from '../components/CreateCampaignModal.jsx';
import CampaignEditModal from '../components/CampaignEditModal.jsx';
import WhatsAppNumberSetting from '../components/WhatsAppNumberSetting.jsx';

const BRIEF_PILL = {
  draft: { cls: 'off', text: 'Draft' },
  ready: { cls: 'off', text: 'Paused' },
  queued: { cls: 'warn', text: 'Setup in Process' },
  info_needed: { cls: 'warn', text: 'Information needed' },
  created: { cls: 'off', text: 'Paused' },
  live: { cls: 'good', text: 'Running' }
};

export default function Campaigns({ rows, setRows, conn, onSynced }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState({});
  const [creatives, setCreatives] = useState([]);
  const [briefs, setBriefs] = useState([]);
  const [edits, setEdits] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFor, setCreateFor] = useState(null); // creative id to preselect
  const [editing, setEditing] = useState(null); // a campaign row
  const [openQuestion, setOpenQuestion] = useState(null); // brief id whose question panel is expanded
  const [briefBusy, setBriefBusy] = useState(null); // brief id currently mutating

  useEffect(() => {
    api.get('/creatives').then(setCreatives).catch(() => {});
    api.get('/campaign-briefs').then(setBriefs).catch(() => {});
    api.get('/campaign-edits').then(setEdits).catch(() => {});
  }, []);

  // Campaigns that were built in Ads Desk (brief -> real campaign id).
  const adsDeskIds = useMemo(
    () => new Set(briefs.map((b) => b.meta_campaign_id).filter(Boolean)),
    [briefs]
  );

  // Briefs that aren't yet represented by a synced Meta campaign row — shown as
  // paused placeholder rows in the main table so a ready campaign "lands" here.
  const syncedIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const pendingBriefs = useMemo(
    () => briefs.filter(
      (b) => b.status !== 'archived' && !(b.meta_campaign_id && syncedIds.has(b.meta_campaign_id))
    ),
    [briefs, syncedIds]
  );

  function replaceBrief(b) {
    setBriefs((list) => [b, ...list.filter((x) => x.id !== b.id)]);
  }

  async function deleteBrief(id) {
    if (!window.confirm('Delete this campaign brief?')) return;
    try {
      await api.del(`/campaign-briefs/${id}`);
      setBriefs((b) => b.filter((x) => x.id !== id));
    } catch (e) { setError(e.message); }
  }
  async function deleteEdit(id) {
    try {
      await api.del(`/campaign-edits/${id}`);
      setEdits((e) => e.filter((x) => x.id !== id));
    } catch (e) { setError(e.message); }
  }

  // "Set campaign" — build the brief on Meta now, all PAUSED.
  async function setCampaign(brief) {
    if (!window.confirm(`Create "${brief.name}" on Meta now? It is created PAUSED — nothing spends until you press "Start campaign".`)) return;
    setBriefBusy(brief.id);
    setError('');
    setNotice('');
    try {
      // Flip to 'queued' first so the pill reads "Setup in Process" while Meta works.
      replaceBrief(await api.patch(`/campaign-briefs/${brief.id}`, { status: 'queued' }));
      const created = await api.post(`/campaign-briefs/${brief.id}/launch`);
      replaceBrief(created);
      setNotice(`"${brief.name}" is created on Meta and paused. Press "Start campaign" when you want it live.`);
      sync(); // pull the new paused campaign into the table below
    } catch (e) {
      setError(e.message);
      // Reflect whatever status the server left the brief in (info_needed on failure).
      try {
        const fresh = await api.get(`/campaign-briefs/${brief.id}`);
        replaceBrief(fresh);
      } catch { /* ignore */ }
    } finally {
      setBriefBusy(null);
    }
  }

  // "Start campaign" — only for a brief Claude has already created (paused) on Meta.
  async function startCampaign(brief) {
    if (!brief.meta_campaign_id) return;
    setBriefBusy(brief.id);
    setError('');
    try {
      await api.patch(`/campaigns/${brief.meta_campaign_id}`, { status: 'ACTIVE' });
      const updated = await api.patch(`/campaign-briefs/${brief.id}`, { status: 'live' });
      replaceBrief(updated);
      setRows((r) => r.map((x) => (x.id === brief.meta_campaign_id ? { ...x, status: 'ACTIVE', effective_status: 'ACTIVE' } : x)));
      setNotice(`"${brief.name}" is now running.`);
      onSynced?.();
    } catch (e) { setError(e.message); } finally { setBriefBusy(null); }
  }

  function openDetails(creativeId) {
    setCreateFor(creativeId || null);
    setCreateOpen(true);
  }

  async function sync() {
    setBusy(true);
    setError('');
    try {
      const out = await api.post('/campaigns/sync');
      setRows(out.campaigns);
      onSynced?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function toggle(c) {
    const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setError('');
    try {
      await api.patch(`/campaigns/${c.id}`, { status: next });
      setRows((r) => r.map((x) => (x.id === c.id ? { ...x, status: next, effective_status: next } : x)));
    } catch (e) { setError(e.message); }
  }

  async function saveBudget(c) {
    const value = drafts[c.id];
    if (value == null || value === '' || Number(value) === Number(c.daily_budget)) return;
    setError('');
    try {
      await api.patch(`/campaigns/${c.id}`, { daily_budget: Number(value) });
      setRows((r) => r.map((x) => (x.id === c.id ? { ...x, daily_budget: Number(value) } : x)));
    } catch (e) { setError(e.message); }
  }

  function applyInstant(patch) {
    // CampaignEditModal already called PATCH /campaigns/:id for name/budget/status.
    setRows((r) => r.map((x) => (x.id === patch.id ? { ...x, ...patch } : x)));
  }

  function briefAction(b) {
    if (briefBusy === b.id) return <span className="sub" style={{ color: 'var(--muted-2)' }}>Working…</span>;
    if (b.status === 'draft') {
      return <button className="btn sm" onClick={() => openDetails(b.creative_id)}>Add campaign details</button>;
    }
    if (b.status === 'ready') {
      return <button className="btn sm primary" onClick={() => setCampaign(b)}>Set campaign</button>;
    }
    if (b.status === 'queued') {
      return <span className="sub" style={{ color: 'var(--muted)' }}>Creating on Meta…</span>;
    }
    if (b.status === 'info_needed') {
      return (
        <button className="btn sm" onClick={() => setOpenQuestion((id) => (id === b.id ? null : b.id))}>
          {openQuestion === b.id ? 'Hide question' : 'Information needed'}
        </button>
      );
    }
    if (b.status === 'created') {
      return <button className="btn sm primary" onClick={() => startCampaign(b)}>Start campaign</button>;
    }
    return null;
  }

  return (
    <>
      {!conn.connected && (
        <div className="notice">
          <strong>Meta not connected.</strong> Open the <strong>Facebook</strong> tab and sign in to pull your campaigns.
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}
      {notice && (
        <div className="notice" style={{ borderLeftColor: 'var(--good)' }}>
          {notice}
          <button className="close" style={{ marginLeft: 8 }} onClick={() => setNotice('')} aria-label="Dismiss">×</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <button className="btn primary" onClick={sync} disabled={busy || !conn.connected}>
          {busy ? 'Syncing…' : 'Sync from Meta'}
        </button>
        <button className="btn" onClick={() => openDetails(null)}>Create campaign</button>
        {rows[0]?.synced_at && <span className="sub" style={{ color: 'var(--muted)' }}>Updated {when(rows[0].synced_at)}</span>}
      </div>

      <div className="card" style={{ marginBottom: 14, padding: '10px 14px' }}>
        <WhatsAppNumberSetting />
      </div>

      {rows.length === 0 && pendingBriefs.length === 0 ? (
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
                <th style={{ textAlign: 'right' }}>Per day</th>
                <th style={{ textAlign: 'right' }}>Spent</th>
                <th style={{ textAlign: 'right' }}>Leads</th>
                <th style={{ textAlign: 'right' }} title="Cost per lead — spend ÷ leads">Cost / lead</th>
                <th style={{ textAlign: 'right' }} title="Click-through rate">CTR</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingBriefs.map((b) => {
                const pill = BRIEF_PILL[b.status] || BRIEF_PILL.draft;
                return (
                  <tr key={`brief-${b.id}`}>
                    <td>
                      <div className="name">
                        {b.name}
                        <span className="tag good" style={{ marginLeft: 6 }}>Ads Desk</span>
                      </div>
                      <div className="num" style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 2 }}>brief #{b.id}</div>
                      {b.status === 'info_needed' && openQuestion === b.id && (
                        <div className="notice" style={{ margin: '8px 0 2px', borderLeftColor: 'var(--warn)' }}>
                          <strong>Claude needs to know:</strong>
                          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{b.notes || 'Claude has a question — check your Claude Code chat.'}</div>
                          <div className="sub" style={{ color: 'var(--muted-2)', marginTop: 6 }}>
                            Answer in your Claude Code chat, then it will continue with <code>create campaign brief #{b.id}</code>.
                          </div>
                        </div>
                      )}
                    </td>
                    <td><span className={`tag ${pill.cls}`}>{pill.text}</span></td>
                    <td className="num" style={{ textAlign: 'right' }}>{b.daily_budget ? `₹${money(b.daily_budget)}` : '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>—</td>
                    <td className="num" style={{ textAlign: 'right' }}>—</td>
                    <td className="num" style={{ textAlign: 'right' }}>—</td>
                    <td className="num" style={{ textAlign: 'right' }}>—</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {briefAction(b)}{' '}
                      <button className="btn sm ghost danger" onClick={() => deleteBrief(b.id)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="name">
                      {c.name}
                      {adsDeskIds.has(c.id) && <span className="tag good" style={{ marginLeft: 6 }}>Ads Desk</span>}
                    </div>
                    <div className="num" style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 2 }}>{c.id}</div>
                  </td>
                  <td><span className={`tag ${c.status === 'ACTIVE' ? 'good' : 'off'}`}>{c.status === 'ACTIVE' ? 'Running' : 'Paused'}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      className="input budget-input num" type="number" min="0"
                      value={drafts[c.id] ?? (c.daily_budget ?? '')}
                      onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
                      onBlur={() => saveBudget(c)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      placeholder="—"
                    />
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>₹{money(c.spend)}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{money(c.leads_count)}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{Number(c.cpl) ? `₹${money(c.cpl)}` : '—'}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{Number(c.ctr).toFixed(2)}%</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setEditing(c)}>Edit</button>{' '}
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

      {edits.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Campaign changes</h2>
            <span className="mono-label">{edits.length}</span>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr><th>What</th><th>Status</th><th>Next step</th><th></th></tr>
              </thead>
              <tbody>
                {edits.map((e) => (
                  <tr key={`e${e.id}`}>
                    <td><div className="name">Edit: {e.campaign_name || e.meta_campaign_id}</div><div className="num" style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>change #{e.id}</div></td>
                    <td><span className={`tag ${e.status === 'applied' ? 'good' : e.status === 'ready' ? 'warn' : 'off'}`}>{e.status}</span></td>
                    <td style={{ fontSize: 12.5 }}>
                      {e.status === 'ready' && <>Tell Claude: <code>apply campaign edit #{e.id}</code></>}
                      {e.status === 'applied' && 'Applied on Meta'}
                    </td>
                    <td style={{ textAlign: 'right' }}><button className="btn sm ghost danger" onClick={() => deleteEdit(e.id)}>Delete</button></td>
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
          initialCreativeId={createFor}
          onClose={() => { setCreateOpen(false); setCreateFor(null); }}
          onSaved={(saved) => {
            replaceBrief(saved);
            setCreateOpen(false);
            setCreateFor(null);
            setNotice(
              saved.status === 'ready'
                ? `"${saved.name}" is ready. It's listed below as Paused — press Set campaign to send it to Claude, then Start campaign once it's built on Meta.`
                : `Saved. Add a daily budget and a location to make "${saved.name}" ready.`
            );
          }}
        />
      )}

      {editing && (
        <CampaignEditModal
          campaign={editing}
          creatives={creatives}
          onClose={() => setEditing(null)}
          onInstant={applyInstant}
          onQueued={(edit) => { setEdits((e) => [edit, ...e]); }}
        />
      )}
    </>
  );
}
