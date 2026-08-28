import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useOutsideClick } from '../hooks/useOutsideClick.js';

/**
 * Named filter+layout presets. `currentFilters` / `currentLayout` are what
 * "Save current view" captures; `onApply({ filters, layout })` is called when
 * the user picks a saved view.
 */
export default function SavedViews({ currentFilters, currentLayout, onApply }) {
  const [views, setViews] = useState([]);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const ref = useRef(null);
  useOutsideClick(ref, open, () => { setOpen(false); setNaming(false); });

  async function load() {
    try {
      setViews(await api.get('/leads/views'));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!name.trim()) return;
    try {
      await api.post('/leads/views', { name: name.trim(), filters: currentFilters, layout: currentLayout });
      setName('');
      setNaming(false);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(id) {
    try {
      await api.del(`/leads/views/${id}`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>Views {open ? '▲' : '▼'}</button>
      {open && (
        <div className="dropdown-pop" style={{ right: 0, minWidth: 220 }}>
          {error && <div className="notice bad" style={{ margin: '0 0 6px' }}>{error}</div>}
          {views.length === 0 && <div className="empty-mini">No saved views yet.</div>}
          {views.map((v) => (
            <div key={v.id} className="dropdown-check-row" style={{ justifyContent: 'space-between' }}>
              <button
                style={{ flex: 1, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                onClick={() => { onApply({ filters: v.filters, layout: v.layout }); setOpen(false); }}
              >
                {v.name} <span className="tag off">{v.layout}</span>
              </button>
              <button className="btn ghost sm danger" onClick={() => remove(v.id)} aria-label="Delete view">×</button>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--line-soft)', marginTop: 6, paddingTop: 6 }}>
            {naming ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input" autoFocus placeholder="View name"
                  value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  style={{ flex: 1 }}
                />
                <button className="btn primary sm" onClick={save} disabled={!name.trim()}>Save</button>
              </div>
            ) : (
              <button className="btn sm" style={{ width: '100%' }} onClick={() => setNaming(true)}>+ Save current view</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
