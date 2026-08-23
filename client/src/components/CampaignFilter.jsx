import { useRef, useState } from 'react';
import { useOutsideClick } from '../hooks/useOutsideClick.js';

export default function CampaignFilter({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClick(ref, open, () => setOpen(false));

  function toggleOne(name) {
    onChange(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);
  }

  const label = selected.length === 0
    ? 'All campaigns'
    : selected.length === 1
      ? selected[0]
      : `${selected.length} campaigns`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="dropdown-pop" style={{ right: 0 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button className="btn ghost sm" onClick={() => onChange([])} disabled={selected.length === 0}>Clear</button>
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => onChange(options)} disabled={selected.length === options.length}>Select all</button>
          </div>
          {options.length === 0 && <div className="empty-mini">No campaigns on any lead yet.</div>}
          {options.map((name) => (
            <label key={name} className="dropdown-check-row">
              <input type="checkbox" checked={selected.includes(name)} onChange={() => toggleOne(name)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
