import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api.js';
import LocationPicker from './LocationPicker.jsx';
import InterestPicker from './InterestPicker.jsx';

function toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function kmFrom(radius, unit) {
  const r = Number(radius) || 5;
  return Math.max(1, Math.round(unit === 'mile' ? r * 1.60934 : r));
}

/** Read a Meta ad-set into the shape this modal's fields use. */
function parseAdSet(adset) {
  const t = adset?.targeting || {};
  const geo = t.geo_locations || {};
  const who = Array.isArray(geo.location_types) && geo.location_types.length === 1 && geo.location_types[0] === 'home' ? 'residents' : 'anyone';

  let loc;
  if (Array.isArray(geo.custom_locations) && geo.custom_locations.length) {
    const c = geo.custom_locations[0];
    loc = {
      mode: 'nearby',
      center: c.latitude != null ? { lat: Number(c.latitude), lng: Number(c.longitude), label: c.name || 'Current area' } : null,
      radius_km: kmFrom(c.radius, c.distance_unit),
      cities: [],
      who
    };
  } else if (Array.isArray(geo.cities) && geo.cities.length) {
    loc = {
      mode: 'cities',
      center: null,
      radius_km: 5,
      cities: geo.cities.map((c) => ({ key: c.key, name: c.name || String(c.key), type: 'city', region: c.region || null, radius_km: kmFrom(c.radius, c.distance_unit) })),
      who
    };
  } else {
    loc = { mode: 'nearby', center: null, radius_km: 5, cities: [], who };
  }

  const g = Array.isArray(t.genders) ? t.genders : [];
  const genders = [];
  if (g.includes(1)) genders.push('male');
  if (g.includes(2)) genders.push('female');

  const interests = [
    ...(Array.isArray(t.interests) ? t.interests : []),
    ...(Array.isArray(t.flexible_spec) ? t.flexible_spec.flatMap((s) => s.interests || []) : [])
  ].map((i) => ({ id: i.id, name: i.name })).filter((i) => i.id);

  return {
    loc,
    ageMin: t.age_min != null ? String(t.age_min) : '',
    ageMax: t.age_max != null ? String(t.age_max) : '',
    genders,
    interests,
    endAt: toDatetimeLocal(adset?.end_time),
    adsetBudget: adset?.daily_budget ?? null
  };
}

/**
 * Edit a live campaign. Name / status / daily budget apply instantly through
 * PATCH /api/campaigns/:id. Audience / schedule / creative swaps are queued as a
 * campaign_edit for Claude Code's MCP connector to apply. All fields pre-fill
 * from the campaign's current ad set.
 */
export default function CampaignEditModal({ campaign, creatives, onClose, onInstant, onQueued }) {
  const ready = useMemo(
    () => creatives.filter((c) => c.status === 'approved' && c.destination_type && c.destination_value),
    [creatives]
  );

  const [name, setName] = useState(campaign.name || '');
  const [status, setStatus] = useState(campaign.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED');
  const [budget, setBudget] = useState(campaign.daily_budget ?? '');
  const [savingInstant, setSavingInstant] = useState(false);

  const [advanced, setAdvanced] = useState(false);
  const [loadingAudience, setLoadingAudience] = useState(true);
  const [loc, setLoc] = useState({ mode: 'nearby', center: null, radius_km: 5, cities: [], who: 'residents' });
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [genders, setGenders] = useState([]);
  const [interests, setInterests] = useState([]);
  const [endAt, setEndAt] = useState('');
  const [swapCreative, setSwapCreative] = useState('');
  const [savingQueued, setSavingQueued] = useState(false);

  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    let alive = true;
    api.get(`/campaigns/${campaign.id}/adsets`)
      .then((adsets) => {
        if (!alive) return;
        const first = Array.isArray(adsets) && adsets[0];
        if (first) {
          const p = parseAdSet(first);
          setLoc(p.loc);
          setAgeMin(p.ageMin);
          setAgeMax(p.ageMax);
          setGenders(p.genders);
          setInterests(p.interests);
          setEndAt(p.endAt);
          if ((campaign.daily_budget == null || campaign.daily_budget === '') && p.adsetBudget != null) setBudget(p.adsetBudget);
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoadingAudience(false));
    return () => { alive = false; };
  }, [campaign.id, campaign.daily_budget]);

  function toggleGender(g) {
    setGenders((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  }

  async function saveInstant() {
    setSavingInstant(true);
    setError('');
    setOk('');
    try {
      const patch = {};
      if (name.trim() && name.trim() !== campaign.name) patch.name = name.trim();
      if (status !== campaign.status) patch.status = status;
      if (budget !== '' && Number(budget) !== Number(campaign.daily_budget)) patch.daily_budget = Number(budget);
      if (!Object.keys(patch).length) { setOk('Nothing changed.'); setSavingInstant(false); return; }
      await api.patch(`/campaigns/${campaign.id}`, patch);
      onInstant({ id: campaign.id, ...patch, ...(patch.status ? { effective_status: patch.status } : {}) });
      setOk('Saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingInstant(false);
    }
  }

  async function saveQueued() {
    const changes = { location_mode: loc.mode, who: loc.who };
    if (loc.mode === 'nearby') {
      if (!loc.center) { setError('Set where the ad should show (current location or PIN code).'); return; }
      changes.radius_center = loc.center;
      changes.radius_km = loc.radius_km;
    } else {
      if (!loc.cities.length) { setError('Add at least one city.'); return; }
      changes.locations = loc.cities.map((l) => ({ key: l.key, name: l.name, type: l.type, region: l.region, radius_km: l.radius_km }));
    }
    if (ageMin !== '') changes.age_min = Number(ageMin);
    if (ageMax !== '') changes.age_max = Number(ageMax);
    changes.genders = genders;
    if (interests.length) changes.interests = interests;
    if (endAt) changes.end_at = new Date(endAt).toISOString();
    if (swapCreative) changes.creative_id = Number(swapCreative);

    setSavingQueued(true);
    setError('');
    setOk('');
    try {
      const edit = await api.post('/campaign-edits', {
        meta_campaign_id: campaign.id,
        campaign_name: campaign.name,
        changes
      });
      onQueued(edit);
      setOk(`Change queued — tell Claude: apply campaign edit #${edit.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingQueued(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Edit campaign</h2>
            <button className="close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="num" style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 8 }}>{campaign.id}</div>

          {error && <div className="notice bad">{error}</div>}
          {ok && <div className="notice" style={{ borderLeftColor: 'var(--good)' }}>{ok}</div>}

          <div className="field">
            <label>Campaign name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Running?</label>
            <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="ce-status" checked={status === 'ACTIVE'} onChange={() => setStatus('ACTIVE')} /> Running
              </label>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="ce-status" checked={status === 'PAUSED'} onChange={() => setStatus('PAUSED')} /> Paused
              </label>
            </div>
          </div>
          <div className="field">
            <label>Spend per day (₹)</label>
            <input className="input" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
            {budget !== '' && <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 4 }}>Up to ₹{money((Number(budget) || 0) * 30)}/month.</div>}
          </div>
          <button className="btn primary" onClick={saveInstant} disabled={savingInstant}>
            {savingInstant ? 'Saving…' : 'Save these'}
          </button>

          <button className="btn ghost sm" style={{ display: 'block', margin: '14px 0 6px' }} onClick={() => setAdvanced((a) => !a)}>
            {advanced ? '▾' : '▸'} Change audience, schedule or the picture
          </button>
          {advanced && (
            <div style={{ display: 'grid', gap: 10, padding: '0 0 4px 10px', borderLeft: '2px solid var(--line-soft)' }}>
              <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>
                {loadingAudience ? 'Loading the campaign’s current settings…' : 'Current settings are filled in below — change what you want, then Save.'}
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Where the ad shows</label>
                <LocationPicker value={loc} onChange={setLoc} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field" style={{ margin: 0 }}><label>Age from</label><input className="input" type="number" placeholder="—" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
                <div className="field" style={{ margin: 0 }}><label>Age to</label><input className="input" type="number" placeholder="—" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Gender (both off = everyone)</label>
                <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                  {['male', 'female'].map((g) => (
                    <label key={g} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer', textTransform: 'capitalize' }}>
                      <input type="checkbox" checked={genders.includes(g)} onChange={() => toggleGender(g)} /> {g}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Interests</label>
                <InterestPicker value={interests} onChange={setInterests} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Stop date</label>
                <input className="input" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Swap the picture &amp; text</label>
                <select className="select" value={swapCreative} onChange={(e) => setSwapCreative(e.target.value)}>
                  <option value="">Keep current</option>
                  {ready.map((c) => <option key={c.id} value={c.id}>{c.label || c.headline || `Creative ${c.id}`}</option>)}
                </select>
              </div>
              <button className="btn primary sm" onClick={saveQueued} disabled={savingQueued || loadingAudience} style={{ justifySelf: 'start' }}>
                {savingQueued ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', marginTop: 16 }}>
            <button className="btn" onClick={onClose} style={{ marginLeft: 'auto' }}>Done</button>
          </div>
        </div>
      </div>
    </>
  );
}
