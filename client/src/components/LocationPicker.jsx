import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useTypeahead } from '../hooks/useTypeahead.js';
import { useOutsideClick } from '../hooks/useOutsideClick.js';
import CityPicker from './CityPicker.jsx';

/**
 * Where the ad shows. Two shopkeeper-friendly modes:
 *  - "nearby": a radius around the shop (current location or a PIN code)
 *  - "cities": whole cities / areas
 * `value` = { mode, center:{lat,lng,label}, radius_km, cities:[], who }.
 */
export default function LocationPicker({ value, onChange }) {
  const v = {
    mode: 'nearby',
    center: null,
    radius_km: 5,
    cities: [],
    who: 'residents',
    ...(value || {})
  };
  const set = (patch) => onChange({ ...v, ...patch });

  const [savedShop, setSavedShop] = useState(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const { query, setQuery, results, loading } = useTypeahead('/meta/geo');
  const [open, setOpen] = useState(false);
  const pinRef = useRef(null);
  useOutsideClick(pinRef, open, () => setOpen(false));

  useEffect(() => {
    api.get('/meta/shop-location').then(setSavedShop).catch(() => {});
  }, []);

  function useCurrentLocation() {
    if (!navigator.geolocation) { setError('Your browser can’t share location. Type a PIN code instead.'); return; }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ mode: 'nearby', center: { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'My location' } });
        setLocating(false);
      },
      () => { setError('Could not get your location. Type a PIN code instead.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function pickPin(g) {
    if (g.latitude == null || g.longitude == null) { setError('That place has no exact point — pick a city below instead.'); return; }
    set({ mode: 'nearby', center: { lat: g.latitude, lng: g.longitude, label: g.name } });
    setQuery('');
    setOpen(false);
  }

  async function saveAsShop() {
    if (!v.center) return;
    try {
      const saved = await api.post('/meta/shop-location', { ...v.center, radius_km: v.radius_km });
      setSavedShop(saved);
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {error && <div className="notice bad" style={{ margin: 0 }}>{error}</div>}

      <div className="layout-toggle">
        <button className={`btn sm ${v.mode === 'nearby' ? 'primary' : ''}`} onClick={() => set({ mode: 'nearby' })}>Near my shop</button>
        <button className={`btn sm ${v.mode === 'cities' ? 'primary' : ''}`} onClick={() => set({ mode: 'cities' })}>Whole city</button>
      </div>

      {v.mode === 'nearby' ? (
        <>
          {savedShop && (!v.center || v.center.label !== savedShop.label) && (
            <button
              className="btn ghost sm"
              style={{ justifySelf: 'start' }}
              onClick={() => set({ center: { lat: savedShop.lat, lng: savedShop.lng, label: savedShop.label }, radius_km: savedShop.radius_km || v.radius_km })}
            >
              Use saved shop: {savedShop.label} ({savedShop.radius_km} km)
            </button>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={useCurrentLocation} disabled={locating}>
              {locating ? 'Getting location…' : '📍 Use my current location'}
            </button>
            <span style={{ color: 'var(--muted-2)', fontSize: 12 }}>or</span>
            <div ref={pinRef} style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <input
                className="input"
                placeholder="Type your PIN code — e.g. 400053"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
              />
              {open && query.trim().length >= 3 && (
                <div className="dropdown-pop" style={{ left: 0, right: 0, maxHeight: 200, overflowY: 'auto' }}>
                  {loading && <div className="empty-mini">Searching…</div>}
                  {!loading && results.length === 0 && <div className="empty-mini">No match.</div>}
                  {results.map((g) => (
                    <button key={g.key} className="dropdown-check-row" style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }} onClick={() => pickPin(g)}>
                      {g.name}{g.primary_city ? `, ${g.primary_city}` : g.region ? `, ${g.region}` : ''} <span className="tag off">{g.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {v.center && (
            <>
              <div style={{ fontSize: 13 }}>
                Centred on <strong>{v.center.label}</strong>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="range" min={1} max={40} value={v.radius_km}
                  onChange={(e) => set({ radius_km: Number(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <span className="mono-label" style={{ whiteSpace: 'nowrap' }}>{v.radius_km} km</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>
                Shows to people within about {v.radius_km} km {v.radius_km <= 3 ? '(walking distance)' : v.radius_km <= 10 ? '(a short drive)' : '(around town)'}.
              </div>
              <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={saveAsShop}>Save this as my shop</button>
            </>
          )}
        </>
      ) : (
        <CityPicker value={v.cities} onChange={(cities) => set({ cities })} />
      )}

      <label className="filter-inline" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>
        Show to&nbsp;
        <select className="select" value={v.who} onChange={(e) => set({ who: e.target.value })}>
          <option value="residents">people who live here</option>
          <option value="anyone">anyone here, including visitors</option>
        </select>
      </label>
    </div>
  );
}
