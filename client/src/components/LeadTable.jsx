import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, when, money } from '../api.js';
import { bucketOf, shortDateTime } from '../lib/dateBuckets.js';

const PAGE_SIZE = 50;

/** Build a query string, repeating keys for array values. */
function toQuery(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.append(k, v);
  }
  return p.toString();
}

/** filters (from LeadFilterBar) + text query -> /leads/list query params */
function filtersToParams(filters, query, sort, page) {
  return {
    stage_id: filters.stages,
    source: filters.sources,
    campaign: filters.campaigns,
    tag: filters.tags,
    followup: filters.followup,
    appointment: filters.appointment,
    value_min: filters.valueMin,
    value_max: filters.valueMax,
    created_after: filters.createdAfter ? `${filters.createdAfter}T00:00:00` : '',
    adsdesk: filters.adsDeskOnly ? '1' : '',
    q: query || '',
    sort: `${sort.field}:${sort.dir}`,
    page,
    pageSize: PAGE_SIZE
  };
}

const COLUMNS = [
  ['name', 'Name'],
  ['phone', 'Phone', true],
  ['stage', 'Stage'],
  ['campaign', 'Campaign', true],
  ['value', 'Value'],
  ['tags', 'Tags', true],
  ['last_contacted', 'Last contacted'],
  ['followup', 'Followup'],
  ['appointment', 'Appointment'],
  ['created', 'Created']
];
const SORTABLE = new Set(['name', 'value', 'last_contacted', 'followup', 'appointment', 'created', 'stage']);

export default function LeadTable({ filters, query, stages, onOpenLead, reloadSignal, onChanged, setError }) {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [sort, setSort] = useState({ field: 'created', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [bulkStage, setBulkStage] = useState('');
  const [bulkTag, setBulkTag] = useState('');

  useEffect(() => { setPage(1); }, [filters, query, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = toQuery(filtersToParams(filters, query, sort, page));
      const res = await api.get(`/leads/list?${qs}`);
      setData(res);
      setSelected(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, query, sort, page, setError]);

  useEffect(() => { load(); }, [load, reloadSignal]);

  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);

  function clickSort(field) {
    if (!SORTABLE.has(field)) return;
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }));
  }

  function toggleRow(id) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === data.rows.length ? new Set() : new Set(data.rows.map((r) => r.id))));
  }

  async function moveOne(id, stageId) {
    try {
      await api.patch(`/leads/${id}/move`, { stage_id: Number(stageId) });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
      load();
    }
  }

  async function runBulk(patch) {
    if (selected.size === 0) return;
    try {
      await api.patch('/leads/bulk-update', { ids: [...selected], ...patch });
      setBulkStage('');
      setBulkTag('');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} lead${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      await api.post('/leads/bulk-delete', { ids: [...selected] });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  }

  function exportCsv() {
    const qs = toQuery(filtersToParams(filters, query, sort, 1));
    const a = document.createElement('a');
    a.href = `/api/leads/export.csv?${qs}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Cross-account Excel export, gated by a per-user export key (set on first use).
  async function exportExcel() {
    try {
      const { keySet } = await api.get('/leads/export/status');
      let key;
      if (keySet) {
        key = window.prompt('Enter your export key');
        if (!key) return;
      } else {
        key = window.prompt('First time — set an export key (6+ characters). You will need this exact key for every future export.');
        if (!key) return;
        if (window.prompt('Re-enter the key to confirm') !== key) {
          setError('Keys did not match — export cancelled.');
          return;
        }
      }
      const { rows } = await api.post('/leads/export/all', { key });
      if (!rows.length) { setError('No leads to export.'); return; }
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'All leads');
      XLSX.writeFile(wb, `all-leads-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setError(e.message);
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const allTags = useMemo(() => {
    const set = new Set();
    data.rows.forEach((r) => (r.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [data.rows]);

  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        <div className="mono-label">
          {data.total} LEAD{data.total === 1 ? '' : 'S'}{loading ? ' · loading…' : ''}
          {selected.size > 0 ? ` · ${selected.size} selected` : ''}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {selected.size > 0 && (
            <>
              <select className="select" value={bulkStage} onChange={(e) => { setBulkStage(e.target.value); if (e.target.value) runBulk({ stage_id: Number(e.target.value) }); }}>
                <option value="">Move to…</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input
                className="input" placeholder="Add tag + Enter" style={{ width: 130 }}
                value={bulkTag}
                onChange={(e) => setBulkTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && bulkTag.trim()) runBulk({ add_tags: [bulkTag.trim()] }); }}
              />
              {allTags.length > 0 && (
                <select className="select" value="" onChange={(e) => e.target.value && runBulk({ remove_tags: [e.target.value] })}>
                  <option value="">Remove tag…</option>
                  {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <button className="btn sm danger" onClick={bulkDelete}>Delete</button>
            </>
          )}
          <button className="btn sm" onClick={exportCsv}>Export CSV</button>
          <button className="btn sm" onClick={exportExcel}>Export Excel (all accounts)</button>
        </div>
      </div>

      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={data.rows.length > 0 && selected.size === data.rows.length} onChange={toggleAll} aria-label="Select all" />
              </th>
              {COLUMNS.map(([field, label]) => (
                <th
                  key={field}
                  onClick={() => clickSort(field)}
                  style={{ cursor: SORTABLE.has(field) ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
                >
                  {label}{sort.field === field ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((lead) => {
              const stage = stageById[lead.stage_id];
              return (
                <tr key={lead.id} onClick={() => onOpenLead(lead.id)} style={{ cursor: 'pointer' }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleRow(lead.id)} aria-label={`Select ${lead.full_name || 'lead'}`} />
                  </td>
                  <td className="name">
                    {lead.full_name || 'Unnamed lead'}
                    {lead.open_task_count > 0 && <span className="tag warn" style={{ marginLeft: 6 }}>{lead.open_task_count}</span>}
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="copy-btn"
                      onClick={() => navigator.clipboard?.writeText(lead.phone || '')}
                      title="Copy phone" aria-label="Copy phone"
                    >📋</button>
                    {lead.phone || '—'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className="select" value={lead.stage_id || ''}
                      onChange={(e) => moveOne(lead.id, e.target.value)}
                      style={{ padding: '3px 6px', fontSize: 12, borderColor: stage?.color || 'var(--line)' }}
                    >
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td>
                    {lead.campaign_name || '—'}
                    {lead.from_adsdesk && <span className="tag good" style={{ marginLeft: 5 }}>Ads Desk</span>}
                  </td>
                  <td className="num">{lead.value ? `₹${money(lead.value)}` : '—'}</td>
                  <td>
                    {(lead.tags || []).length === 0 ? '—' : lead.tags.map((t) => <span key={t} className="tag off">{t}</span>)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{lead.last_contacted_at ? when(lead.last_contacted_at) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {lead.followup_date ? <span className={`date-chip ${bucketOf(lead.followup_date)}`}>{shortDateTime(lead.followup_date)}</span> : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {lead.appointment_date ? <span className={`date-chip ${bucketOf(lead.appointment_date)}`}>{shortDateTime(lead.appointment_date)}</span> : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(lead.created_at)}</td>
                </tr>
              );
            })}
            {data.rows.length === 0 && !loading && (
              <tr><td colSpan={COLUMNS.length + 1}><div className="empty"><h3>No leads match</h3>Adjust the filters above.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="table-foot" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
          <span className="mono-label">Page {page} / {totalPages}</span>
          <button className="btn sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
        </div>
      )}
    </div>
  );
}
