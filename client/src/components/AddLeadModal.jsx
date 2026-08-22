import { useState } from 'react';
import { api } from '../api.js';

export default function AddLeadModal({ stages, campaigns, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!name.trim() || !phone.trim()) {
      setError('Name and number are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api.post('/leads', {
        full_name: name.trim(),
        phone: phone.trim(),
        campaign_name: campaignName.trim() || null,
        stage_id: stageId || undefined
      });
      onCreated(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 42,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
      }}>
        <div className="card" style={{ width: '100%', maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
          <h2>Add lead manually</h2>

          {error && <div className="notice bad">{error}</div>}

          <div className="field">
            <label htmlFor="al-name">Name</label>
            <input
              id="al-name"
              className="input"
              autoFocus
              placeholder="Priya Nair"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="al-phone">Number</label>
            <input
              id="al-phone"
              className="input"
              placeholder="+91 98204 41209"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="al-campaign">Campaign to tag</label>
            <input
              id="al-campaign"
              className="input"
              list="al-campaign-list"
              placeholder="Interiors — Lead Form A"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
            />
            <datalist id="al-campaign-list">
              {campaigns.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="al-stage">Current status</label>
            <select id="al-stage" className="select" value={stageId} onChange={(e) => setStageId(Number(e.target.value))}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={busy}>
              {busy ? 'Adding…' : 'Add lead'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
