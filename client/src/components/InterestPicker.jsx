import { useRef, useState } from 'react';
import { useTypeahead } from '../hooks/useTypeahead.js';
import { useOutsideClick } from '../hooks/useOutsideClick.js';

/** Optional interest targeting. `value` is [{ id, name }]. */
export default function InterestPicker({ value = [], onChange }) {
  const { query, setQuery, results, loading } = useTypeahead('/meta/interests');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClick(ref, open, () => setOpen(false));

  function add(i) {
    if (value.some((v) => v.id === i.id)) return;
    onChange([...value, { id: i.id, name: i.name }]);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {value.length > 0 && (
        <div className="lead-tags" style={{ marginBottom: 8 }}>
          {value.map((v) => (
            <span key={v.id} className="tag off">
              {v.name}
              <button onClick={() => onChange(value.filter((x) => x.id !== v.id))}
                style={{ marginLeft: 4, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }} aria-label="Remove">×</button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        placeholder="Optional — e.g. Home decor, Weddings"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className="dropdown-pop" style={{ left: 0, right: 0, maxHeight: 220, overflowY: 'auto' }}>
          {loading && <div className="empty-mini">Searching…</div>}
          {!loading && results.length === 0 && <div className="empty-mini">No matches.</div>}
          {results.map((i) => (
            <button key={i.id} className="dropdown-check-row"
              style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              onClick={() => add(i)}>
              {i.name}{i.path?.length > 1 ? <span className="tag off"> {i.path[i.path.length - 2]}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
