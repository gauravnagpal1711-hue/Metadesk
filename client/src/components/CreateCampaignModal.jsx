import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api.js';
import LocationPicker from './LocationPicker.jsx';
import InterestPicker from './InterestPicker.jsx';

const BLANK_LOC = { mode: 'nearby', center: null, radius_km: 5, cities: [], who: 'residents' };

const MIN_BUDGET = 100;

const DEST_LABEL = {
  whatsapp: 'People message you on WhatsApp',
  lead_form: 'People fill your form',
  website: 'People visit your website'
};
const OPT_GOALS = {
  whatsapp: [['CONVERSATIONS', 'More conversations (default)'], ['LINK_CLICKS', 'More clicks'], ['REACH', 'Reach more people']],
  lead_form: [['LEAD_GENERATION', 'More leads (default)'], ['QUALITY_LEAD', 'Higher-quality leads'], ['LINK_CLICKS', 'More clicks']],
  website: [['LINK_CLICKS', 'More clicks (default)'], ['LANDING_PAGE_VIEWS', 'More page views'], ['REACH', 'Reach more people']]
};

function toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Turn a creative's saved campaign_defaults blob back into this form's fields. */
function fromDefaults(d) {
  const a = (d && d.audience) || {};
  return {
    budget: d?.daily_budget != null ? d.daily_budget : 400,
    loc: {
      mode: a.location_mode || 'nearby',
      center: a.radius_center || null,
      radius_km: a.radius_km || 5,
      cities: Array.isArray(a.locations) ? a.locations : [],
      who: a.who || 'residents'
    },
    startMode: d?.start_at ? 'date' : 'now',
    startAt: d?.start_at ? toDatetimeLocal(d.start_at) : '',
    endAt: d?.end_at ? toDatetimeLocal(d.end_at) : '',
    ageMin: a.age_min ?? 18,
    ageMax: a.age_max ?? 65,
    genders: Array.isArray(a.genders) && a.genders.length ? a.genders : ['all'],
    interests: Array.isArray(a.interests) ? a.interests : [],
    optGoal: a.advanced?.optimization_goal || '',
    bidCap: a.advanced?.bid_cap_rupees ?? ''
  };
}

/**
 * Assembles a campaign brief in plain language. No Meta call — the app PATCHes
 * the chosen creative with these details (campaign_defaults) so they travel with
 * the artwork and pre-fill next time, and the server keeps one brief per creative
 * in step. Claude Code's MCP connector creates the real campaign from the brief.
 */
export default function CreateCampaignModal({ creatives, initialCreativeId, onClose, onSaved }) {
  const ready = useMemo(
    () => creatives.filter((c) => c.status === 'approved' && c.destination_type && c.destination_value),
    [creatives]
  );

  const first = ready.find((c) => c.id === Number(initialCreativeId)) || ready[0];
  const [creativeId, setCreativeId] = useState(first?.id || '');
  const chosen = ready.find((c) => c.id === Number(creativeId));

  const seed = fromDefaults(first?.campaign_defaults);
  const [name, setName] = useState(
    first?.campaign_defaults?.name || first?.label || first?.headline || ''
  );
  const [budget, setBudget] = useState(seed.budget);
  const [loc, setLoc] = useState(seed.loc);
  const [startMode, setStartMode] = useState(seed.startMode);
  const [startAt, setStartAt] = useState(seed.startAt);
  const [endAt, setEndAt] = useState(seed.endAt);

  const [advanced, setAdvanced] = useState(false);
  const [ageMin, setAgeMin] = useState(seed.ageMin);
  const [ageMax, setAgeMax] = useState(seed.ageMax);
  const [genders, setGenders] = useState(seed.genders);
  const [interests, setInterests] = useState(seed.interests);
  const [optGoal, setOptGoal] = useState(seed.optGoal);
  const [bidCap, setBidCap] = useState(seed.bidCap);

  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.get('/meta/page').then(setPage).catch(() => {}); }, []);
  useEffect(() => {
    api.get('/meta/shop-location').then((s) => {
      if (s?.lat != null) setLoc((v) => (v.center ? v : { ...v, center: { lat: s.lat, lng: s.lng, label: s.label }, radius_km: s.radius_km || 5 }));
    }).catch(() => {});
  }, []);

  function pickCreative(id) {
    setCreativeId(id);
    const c = ready.find((x) => x.id === Number(id));
    if (!c) return;
    const d = c.campaign_defaults;
    const s = fromDefaults(d);
    // A creative with saved details refills the whole form; otherwise just the name.
    setName(d?.name || c.label || c.headline || '');
    if (d) {
      setBudget(s.budget);
      setLoc(s.loc);
      setStartMode(s.startMode);
      setStartAt(s.startAt);
      setEndAt(s.endAt);
      setAgeMin(s.ageMin);
      setAgeMax(s.ageMax);
      setGenders(s.genders);
      setInterests(s.interests);
      setOptGoal(s.optGoal);
      setBidCap(s.bidCap);
    }
  }
  function toggleGender(g) {
    if (g === 'all') return setGenders(['all']);
    setGenders((cur) => {
      const without = cur.filter((x) => x !== 'all' && x !== g);
      return cur.includes(g) ? (without.length ? without : ['all']) : [...without, g];
    });
  }

  const needsTos = chosen?.destination_type === 'lead_form' && page && page.leadgen_tos_accepted === false;

  async function save() {
    if (!name.trim()) return setError('Give the campaign a name.');
    if (!chosen) return setError('Pick a creative that is set up for campaigns.');
    if (Number(budget) < MIN_BUDGET) return setError(`Daily budget must be at least ₹${MIN_BUDGET}.`);
    if (loc.mode === 'nearby' && !loc.center) return setError('Set where your shop is (current location or PIN code).');
    if (loc.mode === 'cities' && loc.cities.length === 0) return setError('Add at least one city.');
    setBusy(true);
    setError('');
    try {
      const audience = {
        location_mode: loc.mode,
        radius_center: loc.mode === 'nearby' ? loc.center : null,
        radius_km: loc.mode === 'nearby' ? loc.radius_km : null,
        locations: loc.mode === 'cities'
          ? loc.cities.map((l) => ({ key: l.key, name: l.name, type: l.type, region: l.region, radius_km: l.radius_km }))
          : [],
        who: loc.who,
        age_min: Number(ageMin),
        age_max: Number(ageMax),
        genders: genders.includes('all') ? ['all'] : genders,
        interests,
        advanced: {
          optimization_goal: optGoal || null,
          bid_cap_rupees: bidCap ? Number(bidCap) : null
        }
      };
      const campaign_defaults = {
        name: name.trim(),
        daily_budget: Number(budget),
        audience,
        start_at: startMode === 'now' ? null : (startAt ? new Date(startAt).toISOString() : null),
        end_at: endAt ? new Date(endAt).toISOString() : null
      };
      // Save the details onto the artwork; the server syncs this creative's brief.
      const updated = await api.patch(`/creatives/${chosen.id}`, { campaign_defaults });
      if (updated.brief) onSaved(updated.brief);
      else onClose();
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
        <div className="card" style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Campaign details</h2>
            <button className="close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">×</button>
          </div>

          {error && <div className="notice bad">{error}</div>}

          {ready.length === 0 ? (
            <div className="notice">
              No creatives are set up for campaigns yet. In <strong>Advertise your Brand</strong>, approve a creative and choose
              what happens when someone taps the ad.
            </div>
          ) : (
            <>
              <div className="field">
                <label>Which ad picture &amp; text?</label>
                <select className="select" value={creativeId} onChange={(e) => pickCreative(e.target.value)}>
                  {ready.map((c) => <option key={c.id} value={c.id}>{c.label || c.headline || `Creative ${c.id}`}</option>)}
                </select>
                {chosen && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
                    {chosen.image_data && <img src={chosen.image_data} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />}
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      <div><strong style={{ color: 'var(--ink)' }}>{chosen.headline || '—'}</strong></div>
                      <div>
                        {DEST_LABEL[chosen.destination_type] || chosen.destination_type}
                        {chosen.destination_type === 'whatsapp' && chosen.destination_value ? ` (+${chosen.destination_value})` : ''}
                        {chosen.destination_type === 'lead_form' && chosen.link_url ? ` — ${chosen.link_url}` : ''}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {needsTos && (
                <div className="notice bad">
                  Your Page hasn't accepted Meta's lead-form terms yet. Accept them once at{' '}
                  <a href="https://www.facebook.com/legal/leadgen/tos" target="_blank" rel="noreferrer">facebook.com/legal/leadgen/tos</a>,
                  or use a WhatsApp creative instead.
                </div>
              )}

              <div className="field">
                <label htmlFor="cc-name">Campaign name</label>
                <input id="cc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="field">
                <label htmlFor="cc-budget">How much to spend per day (₹)</label>
                <input id="cc-budget" className="input" type="number" min={MIN_BUDGET} value={budget} onChange={(e) => setBudget(e.target.value)} />
                <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 4 }}>
                  Up to ₹{money(Number(budget) || 0)}/day (~₹{money((Number(budget) || 0) * 30)}/month). Most shops start at ₹300–₹500.
                </div>
              </div>

              <div className="field">
                <label>Where should the ad show?</label>
                <LocationPicker value={loc} onChange={setLoc} />
              </div>

              <div className="mono-label" style={{ margin: '6px 0 4px' }}>When</div>
              <div className="field">
                <div style={{ display: 'flex', gap: 12, fontSize: 13, marginBottom: 6 }}>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="radio" name="cc-start" checked={startMode === 'now'} onChange={() => setStartMode('now')} /> Start when turned on
                  </label>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="radio" name="cc-start" checked={startMode === 'date'} onChange={() => setStartMode('date')} /> Pick a date
                  </label>
                </div>
                {startMode === 'date' && <input className="input" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />}
              </div>
              <div className="field">
                <label>Stop date (optional)</label>
                <input className="input" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>

              <button className="btn ghost sm" style={{ justifySelf: 'start', marginBottom: 6 }} onClick={() => setAdvanced((a) => !a)}>
                {advanced ? '▾' : '▸'} Advanced (age, gender, interests, tuning)
              </button>
              {advanced && (
                <div style={{ display: 'grid', gap: 10, padding: '0 0 4px 10px', borderLeft: '2px solid var(--line-soft)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="field" style={{ margin: 0 }}><label>Age from</label><input className="input" type="number" min={13} max={65} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
                    <div className="field" style={{ margin: 0 }}><label>Age to</label><input className="input" type="number" min={13} max={65} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Gender</label>
                    <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                      {['all', 'male', 'female'].map((g) => (
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
                    <label>What to optimise for</label>
                    <select className="select" value={optGoal} onChange={(e) => setOptGoal(e.target.value)}>
                      <option value="">Recommended</option>
                      {(OPT_GOALS[chosen?.destination_type] || OPT_GOALS.whatsapp).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Max cost per result (₹, optional)</label>
                    <input className="input" type="number" min={1} value={bidCap} onChange={(e) => setBidCap(e.target.value)} placeholder="Leave blank to let Meta decide" />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save details'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
