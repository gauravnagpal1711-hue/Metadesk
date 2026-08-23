import { useState } from 'react';
import { api } from '../api.js';

const SWATCHES = ['#2B3AF0', '#6B4BE8', '#0E7C5A', '#B8860F', '#17a34a', '#dc2626', '#d97706', '#8A8F9B', '#1877f2', '#c9186b'];

export default function ManageStagesModal({ stages, onClose, onChanged }) {
  const [rows, setRows] = useState(stages);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const fresh = await api.get('/leads/stages');
    setRows(fresh);
    onChanged?.(fresh);
  }

  async function rename(stage, name) {
    if (name === stage.name) return;
    try {
      await api.patch(`/leads/stages/${stage.id}`, { name });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function recolor(stage, color) {
    try {
      await api.patch(`/leads/stages/${stage.id}`, { color });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleRequiresAppointment(stage, checked) {
    try {
      await api.patch(`/leads/stages/${stage.id}`, { requires_appointment_date: checked });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleRequiresFollowup(stage, checked) {
    try {
      await api.patch(`/leads/stages/${stage.id}`, { requires_followup_date: checked });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const a = rows[index];
    const b = rows[target];
    try {
      await api.patch(`/leads/stages/${a.id}`, { position: b.position });
      await api.patch(`/leads/stages/${b.id}`, { position: a.position });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(stage) {
    if (!window.confirm(`Delete "${stage.name}"? Leads in this stage will become unassigned, not deleted.`)) return;
    try {
      await api.del(`/leads/stages/${stage.id}`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addStage() {
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/leads/stages', { name: newName.trim(), color: newColor });
      setNewName('');
      await refresh();
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
        <div className="card" style={{ width: '100%', maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Manage pipeline stages</h2>
            <button className="close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">×</button>
          </div>

          {error && <div className="notice bad">{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {rows.map((stage, i) => (
              <div key={stage.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
                <input
                  type="color"
                  value={stage.color}
                  onChange={(e) => recolor(stage, e.target.value)}
                  style={{ width: 24, height: 24, padding: 0, border: 'none', borderRadius: 5, cursor: 'pointer', flex: '0 0 24px' }}
                  title="Stage color"
                />
                <input
                  className="input"
                  defaultValue={stage.name}
                  onBlur={(e) => rename(stage, e.target.value.trim() || stage.name)}
                  style={{ flex: 1 }}
                />
                <label
                  title="Require an appointment date to move leads into this stage"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--muted-2)', flex: '0 0 auto', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  <input
                    type="checkbox"
                    checked={!!stage.requires_appointment_date}
                    onChange={(e) => toggleRequiresAppointment(stage, e.target.checked)}
                  />
                  📅
                </label>
                <label
                  title="Require a followup date to move leads into this stage"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--muted-2)', flex: '0 0 auto', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  <input
                    type="checkbox"
                    checked={!!stage.requires_followup_date}
                    onChange={(e) => toggleRequiresFollowup(stage, e.target.checked)}
                  />
                  ⏰
                </label>
                {(stage.is_won || stage.is_lost) && (
                  <span className="tag off">{stage.is_won ? 'won' : 'lost'}</span>
                )}
                <button className="btn ghost sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="btn ghost sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
                <button className="btn ghost sm danger" onClick={() => remove(stage)} aria-label="Delete stage">Delete</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              style={{ width: 24, height: 24, padding: 0, border: 'none', borderRadius: 5, cursor: 'pointer', flex: '0 0 24px' }}
            />
            <input
              className="input"
              placeholder="New stage name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStage()}
              style={{ flex: 1 }}
            />
            <button className="btn primary" onClick={addStage} disabled={busy || !newName.trim()}>
              {busy ? 'Adding…' : 'Add stage'}
            </button>
          </div>

          <div style={{ display: 'flex', marginTop: 16 }}>
            <button className="btn" onClick={onClose} style={{ marginLeft: 'auto' }}>Done</button>
          </div>
        </div>
      </div>
    </>
  );
}
