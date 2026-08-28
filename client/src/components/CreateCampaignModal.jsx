import { useMemo, useState } from 'react';
import { api, money } from '../api.js';

const MIN_BUDGET = 100;

const DEST_LABEL = {
  whatsapp: 'Leads → WhatsApp',
  lead_form: 'Leads → Instant form',
  website: 'Leads → Website'
};

/** Assembles a campaign brief. Does NOT call Meta — Claude Code creates the
 *  real campaign from the saved brief. */
export default function CreateCampaignModal({ creatives, onClose, onSaved }) {
  const ready = useMemo(
    () => creatives.filter((c) => c.status === 'approved' && c.destination_type && c.destination_value),
    [creatives]
  );

  const [creativeId, setCreativeId] = useState(ready[0]?.id || '');
  const chosen = ready.find((c) => c.id === Number(creativeId));

  const [name, setName] = useState(ready[0]?.label || ready[0]?.headline || '');
  const [budget, setBudget] = useState(300);
  const [cities, setCities] = useState('');
  const [radius, setRadius] = useState(5);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genders, setGenders] = useState(['all']);
  const [startMode, setStartMode] = useState('now');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function pickCreative(id) {
    setCreativeId(id);
    const c = ready.find((x) => x.id === Number(id));
    if (c && (!name.trim() || name === chosen?.label || name === chosen?.headline)) {
      setName(c.label || c.headline || '');
    }
  }

  function toggleGender(g) {
    if (g === 'all') return setGenders(['all']);
    setGenders((cur) => {
      const without = cur.filter((x) => x !== 'all' && x !== g);
      return cur.includes(g) ? (without.length ? without : ['all']) : [...without, g];
    });
  }

  async function save() {
    if (!name.trim()) return setError('Name the campaign.');
    if (!chosen) return setError('Pick a campaign-ready creative.');
    if (Number(budget) < MIN_BUDGET) return setError(`Daily budget must be at least ₹${MIN_BUDGET}.`);
    setBusy(true);
    setError('');
    try {
      const audience = {
        cities: cities.split(',').map((s) => s.trim()).filter(Boolean),
        radius_km: Number(radius) || null,
        age_min: Number(ageMin),
        age_max: Number(ageMax),
        genders: genders.includes('all') ? ['all'] : genders
      };
      const saved = await api.post('/campaign-briefs', {
        name: name.trim(),
        creative_id: chosen.id,
        daily_budget: Number(budget),
        audience,
        start_at: startMode === 'now' ? null : (startAt ? new Date(startAt).toISOString() : null),
        end_at: endAt ? new Date(endAt).toISOString() : null
      });
      onSaved(saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Create campaign</h2>
            <button className="close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">×</button>
          </div>

          {error && <div className="notice bad">{error}</div>}

          {ready.length === 0 ? (
            <div className="notice">
              No campaign-ready creatives yet. In <strong>Build Your Brand</strong>, approve a creative and set its
              destination (WhatsApp / Instant form / Website).
            </div>
          ) : (
            <>
              <div className="field">
                <label>Creative</label>
                <select className="select" value={creativeId} onChange={(e) => pickCreative(e.target.value)}>
                  {ready.map((c) => (
                    <option key={c.id} value={c.id}>{c.label || c.headline || `Creative ${c.id}`}</option>
                  ))}
                </select>
                {chosen && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
                    {chosen.image_data && <img src={chosen.image_data} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />}
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      <div><strong style={{ color: 'var(--ink)' }}>{chosen.headline || '—'}</strong></div>
                      <div>{DEST_LABEL[chosen.destination_type]} · {chosen.destination_value}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="cc-name">Campaign name</label>
                <input id="cc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="field">
                <label htmlFor="cc-budget">Daily budget (₹)</label>
                <input id="cc-budget" className="input" type="number" min={MIN_BUDGET} value={budget} onChange={(e) => setBudget(e.target.value)} />
                <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 4 }}>
                  You'll spend up to ₹{money(Number(budget) || 0)}/day (~₹{money((Number(budget) || 0) * 30)}/month).
                </div>
              </div>

              <div className="mono-label" style={{ margin: '6px 0 4px' }}>Audience</div>
              <div className="field">
                <label htmlFor="cc-cities">Cities (comma-separated)</label>
                <input id="cc-cities" className="input" placeholder="Mumbai, Pune" value={cities} onChange={(e) => setCities(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="field"><label>Radius (km)</label><input className="input" type="number" min={1} value={radius} onChange={(e) => setRadius(e.target.value)} /></div>
                <div className="field"><label>Age min</label><input className="input" type="number" min={13} max={65} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
                <div className="field"><label>Age max</label><input className="input" type="number" min={13} max={65} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
              </div>
              <div className="field">
                <label>Gender</label>
                <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                  {['all', 'male', 'female'].map((g) => (
                    <label key={g} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer', textTransform: 'capitalize' }}>
                      <input type="checkbox" checked={genders.includes(g)} onChange={() => toggleGender(g)} />
                      {g}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mono-label" style={{ margin: '6px 0 4px' }}>Schedule</div>
              <div className="field">
                <div style={{ display: 'flex', gap: 12, fontSize: 13, marginBottom: 6 }}>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="radio" name="cc-start" checked={startMode === 'now'} onChange={() => setStartMode('now')} /> Start now
                  </label>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="radio" name="cc-start" checked={startMode === 'date'} onChange={() => setStartMode('date')} /> Pick a date
                  </label>
                </div>
                {startMode === 'date' && (
                  <input className="input" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                )}
              </div>
              <div className="field">
                <label>End date (optional)</label>
                <input className="input" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save brief'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
