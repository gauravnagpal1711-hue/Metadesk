import { useRef, useState } from 'react';
import { useTypeahead } from '../hooks/useTypeahead.js';
import { useOutsideClick } from '../hooks/useOutsideClick.js';

/**
 * Multi-select city/region picker. `value` is [{ key, name, type, radius_km }].
 * The shopkeeper types a city name; we resolve the Meta geo key behind the scenes.
 */
export default function CityPicker({ value = [], onChange }) {
  const { query, setQuery, results, loading } = useTypeahead('/meta/geo');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClick(ref, open, () => setOpen(false));

  function add(g) {
    if (value.some((v) => v.key === g.key)) return;
    onChange([...value, { key: g.key, name: g.name, type: g.type, region: g.region, radius_km: 5 }]);
    setQuery('');
    setOpen(false);
  }
  function remove(key) {
    onChange(value.filter((v) => v.key !== key));
  }
  function setRadius(key, km) {
    onChange(value.map((v) => (v.key === key ? { ...v, radius_km: Number(km) || 1 } : v)));
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="lead-tags" style={{ marginBottom: value.length ? 8 : 0 }}>
        {value.map((v) => (
          <span key={v.key} className="tag off" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {v.name}{v.region ? `, ${v.region}` : ''}
            <input
              type="number" min={1} value={v.radius_km}
              onChange={(e) => setRadius(v.key, e.target.value)}
              style={{ width: 44, padding: '1px 4px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 4 }}
              title="Radius in km"
            />
            km
            <button onClick={() => remove(v.key)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} aria-label="Remove">×</button>
          </span>
        ))}
      </div>
      <input
        className="input"
        placeholder="Type a city — e.g. Mumbai"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && (query.trim().length >= 2) && (
        <div className="dropdown-pop" style={{ left: 0, right: 0, maxHeight: 220, overflowY: 'auto' }}>
          {loading && <div className="empty-mini">Searching…</div>}
          {!loading && results.length === 0 && <div className="empty-mini">No matches.</div>}
          {results.map((g) => (
            <button
              key={g.key}
              className="dropdown-check-row"
              style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              onClick={() => add(g)}
            >
              {g.name}{g.region ? `, ${g.region}` : ''} <span className="tag off">{g.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
