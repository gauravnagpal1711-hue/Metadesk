import { useRef, useState } from 'react';
import { useOutsideClick } from '../hooks/useOutsideClick.js';

export const EMPTY_FILTERS = {
  stages: [],
  sources: [],
  campaigns: [],
  tags: [],
  followup: '',
  appointment: '',
  valueMin: '',
  valueMax: '',
  createdAfter: '',
  adsDeskOnly: false
};

export function countActiveFilters(f) {
  return (
    f.stages.length + f.sources.length + f.campaigns.length + f.tags.length +
    (f.followup ? 1 : 0) + (f.appointment ? 1 : 0) +
    (f.valueMin !== '' ? 1 : 0) + (f.valueMax !== '' ? 1 : 0) + (f.createdAfter ? 1 : 0) +
    (f.adsDeskOnly ? 1 : 0)
  );
}

const DATE_BUCKETS = [
  ['', 'Any'],
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['next7', 'Next 7 days'],
  ['none', 'Not set']
];

function MultiPick({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClick(ref, open, () => setOpen(false));
  const toggle = (val) =>
    onChange(selected.includes(val) ? selected.filter((x) => x !== val) : [...selected, val]);
  const text = selected.length === 0 ? label : `${label}: ${selected.length}`;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>{text} {open ? '▲' : '▼'}</button>
      {open && (
        <div className="dropdown-pop" style={{ left: 0, minWidth: 180 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button className="btn ghost sm" onClick={() => onChange([])} disabled={selected.length === 0}>Clear</button>
          </div>
          {options.length === 0 && <div className="empty-mini">Nothing to pick.</div>}
          {options.map((opt) => (
            <label key={opt.value} className="dropdown-check-row">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Filter bar shared by the board and table layouts. `filters` is the object
 * above; `onChange` receives the whole updated object.
 */
export default function LeadFilterBar({ filters, onChange, stages, campaigns, tags }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const active = countActiveFilters(filters);

  return (
    <div className="filter-bar">
      <MultiPick
        label="Stage"
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
        selected={filters.stages}
        onChange={(v) => set({ stages: v })}
      />
      <MultiPick
        label="Source"
        options={[{ value: 'meta', label: 'Meta' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'manual', label: 'Manual' }]}
        selected={filters.sources}
        onChange={(v) => set({ sources: v })}
      />
      <MultiPick
        label="Campaign"
        options={campaigns.map((c) => ({ value: c, label: c }))}
        selected={filters.campaigns}
        onChange={(v) => set({ campaigns: v })}
      />
      {tags.length > 0 && (
        <MultiPick
          label="Tag"
          options={tags.map((t) => ({ value: t, label: t }))}
          selected={filters.tags}
          onChange={(v) => set({ tags: v })}
        />
      )}

      <label className="filter-inline">
        Followup
        <select className="select" value={filters.followup} onChange={(e) => set({ followup: e.target.value })}>
          {DATE_BUCKETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="filter-inline">
        Appt
        <select className="select" value={filters.appointment} onChange={(e) => set({ appointment: e.target.value })}>
          {DATE_BUCKETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      <label className="filter-inline">
        Value
        <input
          className="input" type="number" placeholder="min" style={{ width: 68 }}
          value={filters.valueMin} onChange={(e) => set({ valueMin: e.target.value })}
        />
        <input
          className="input" type="number" placeholder="max" style={{ width: 68 }}
          value={filters.valueMax} onChange={(e) => set({ valueMax: e.target.value })}
        />
      </label>
      <label className="filter-inline">
        Since
        <input
          className="input" type="date" style={{ width: 140 }}
          value={filters.createdAfter} onChange={(e) => set({ createdAfter: e.target.value })}
        />
      </label>

      <label className="filter-inline" style={{ textTransform: 'none', letterSpacing: 0 }}>
        <input type="checkbox" checked={filters.adsDeskOnly} onChange={(e) => set({ adsDeskOnly: e.target.checked })} />
        Ads Desk campaigns only
      </label>

      {active > 0 && (
        <button className="btn ghost sm" onClick={() => onChange({ ...EMPTY_FILTERS })}>
          Clear all ({active})
        </button>
      )}
    </div>
  );
}
