import { useRef, useState } from 'react';
import { api } from '../api.js';

const COLUMN_ALIASES = {
  name: ['name', 'full name', 'full_name', 'lead name', 'contact name', 'customer name'],
  phone: ['phone', 'number', 'mobile', 'whatsapp', 'phone number', 'contact number', 'mobile number', 'whatsapp number'],
  campaign: ['campaign', 'campaign name', 'campaign_name', 'source'],
  stage: ['stage', 'status', 'current status', 'current stage']
};

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadTemplate(stages) {
  const rows = [
    ['Name', 'Phone', 'Campaign', 'Stage'],
    ['Priya Nair', '+91 98204 41209', 'Interiors — Lead Form A', stages[0]?.name || 'New lead'],
    ['Aditya Kulkarni', '+91 90112 33487', '', '']
  ];
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ads-desk-leads-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function detectColumns(headers) {
  const found = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    found[field] = headers.find((h) => aliases.includes(String(h).trim().toLowerCase())) || null;
  }
  return found;
}

export default function AddLeadModal({ stages, campaigns, onClose, onCreated, onBulkImported }) {
  const [mode, setMode] = useState('single');

  // single-add state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // bulk-upload state
  const [rows, setRows] = useState(null); // parsed sheet rows
  const [columns, setColumns] = useState(null); // detected column mapping
  const [defaultStageId, setDefaultStageId] = useState(stages[0]?.id || '');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  async function submit() {
    if (!name.trim() || !phone.trim()) {
      setError('Name and number are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api.post('/leads', {
        full_name: name.trim(),
        phone: phone.trim(),
        campaign_name: campaignName.trim() || null,
        stage_id: stageId || undefined
      });
      onCreated(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(file) {
    if (!file) return;
    setError('');
    setResult(null);
    const XLSX = await import('xlsx');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (data.length === 0) {
          setError('That file has no rows.');
          return;
        }
        setColumns(detectColumns(Object.keys(data[0])));
        setRows(data);
      } catch (e) {
        setError('Could not read that file. Make sure it’s a valid .xlsx, .xls, or .csv.');
      }
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsArrayBuffer(file);
  }

  function stageIdForValue(value) {
    if (!value) return defaultStageId || undefined;
    const match = stages.find((s) => s.name.toLowerCase() === String(value).trim().toLowerCase());
    return match ? match.id : (defaultStageId || undefined);
  }

  async function runImport() {
    if (!rows || !columns?.phone) return;
    setImporting(true);
    setError('');
    try {
      const payload = rows.map((r) => ({
        full_name: columns.name ? String(r[columns.name] || '').trim() : '',
        phone: String(r[columns.phone] || '').trim(),
        campaign_name: columns.campaign ? String(r[columns.campaign] || '').trim() || null : null,
        stage_id: columns.stage ? stageIdForValue(r[columns.stage]) : (defaultStageId || undefined)
      }));
      const out = await api.post('/leads/bulk', { leads: payload });
      setResult(out);
      if (out.created > 0) onBulkImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  function resetBulk() {
    setRows(null);
    setColumns(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 42,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
      }}>
        <div className="card" style={{ width: '100%', maxWidth: mode === 'bulk' ? 520 : 380 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Add lead manually</h2>
            <button className="close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">×</button>
          </div>

          <div style={{ display: 'flex', padding: 3, gap: 3, background: 'var(--line-soft)', borderRadius: 9, margin: '10px 0 14px' }}>
            <button
              className="btn"
              style={{ flex: 1, border: 0, background: mode === 'single' ? '#fff' : 'transparent', boxShadow: mode === 'single' ? '0 1px 2px rgba(24,24,27,.08)' : 'none' }}
              onClick={() => setMode('single')}
            >
              Single lead
            </button>
            <button
              className="btn"
              style={{ flex: 1, border: 0, background: mode === 'bulk' ? '#fff' : 'transparent', boxShadow: mode === 'bulk' ? '0 1px 2px rgba(24,24,27,.08)' : 'none' }}
              onClick={() => setMode('bulk')}
            >
              Bulk upload
            </button>
          </div>

          {error && <div className="notice bad">{error}</div>}

          {mode === 'single' && (
            <>
              <div className="field">
                <label htmlFor="al-name">Name</label>
                <input
                  id="al-name"
                  className="input"
                  autoFocus
                  placeholder="Priya Nair"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="al-phone">Number</label>
                <input
                  id="al-phone"
                  className="input"
                  placeholder="+91 98204 41209"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="al-campaign">Campaign to tag</label>
                <input
                  id="al-campaign"
                  className="input"
                  list="al-campaign-list"
                  placeholder="Interiors — Lead Form A"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                />
                <datalist id="al-campaign-list">
                  {campaigns.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>

              <div className="field">
                <label htmlFor="al-stage">Current status</label>
                <select id="al-stage" className="select" value={stageId} onChange={(e) => setStageId(Number(e.target.value))}>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn primary" onClick={submit} disabled={busy}>
                  {busy ? 'Adding…' : 'Add lead'}
                </button>
              </div>
            </>
          )}

          {mode === 'bulk' && (
            <>
              {!rows && (
                <>
                  <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: '18px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--muted-3)', marginBottom: 8 }}>
                      Upload an Excel (.xlsx, .xls) or CSV file. First row should have column headers —
                      we'll auto-detect Name, Phone, Campaign and Stage columns.
                    </div>
                    <button className="btn sm" style={{ marginBottom: 12 }} onClick={() => downloadTemplate(stages)}>
                      Download template (.csv)
                    </button>
                    <div>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => pickFile(e.target.files?.[0])}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', marginTop: 14 }}>
                    <button className="btn" onClick={onClose} style={{ marginLeft: 'auto' }}>Cancel</button>
                  </div>
                </>
              )}

              {rows && !result && (
                <>
                  <div className="mono-label" style={{ marginBottom: 8 }}>{rows.length} rows found</div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, marginBottom: 10 }}>
                    <div>Name column: <strong>{columns.name || 'not found — will save as "Unnamed lead"'}</strong></div>
                    <div>Phone column: <strong style={{ color: columns.phone ? 'inherit' : 'var(--danger)' }}>{columns.phone || 'not found — required'}</strong></div>
                    <div>Campaign column: <strong>{columns.campaign || 'not found — will leave blank'}</strong></div>
                    <div>Stage column: <strong>{columns.stage || 'not found — will use the default stage below'}</strong></div>
                  </div>

                  <div className="field">
                    <label htmlFor="al-default-stage">Default stage (used when a row has no stage, or it doesn't match a real stage name)</label>
                    <select id="al-default-stage" className="select" value={defaultStageId} onChange={(e) => setDefaultStageId(Number(e.target.value))}>
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>

                  <div className="scroll-x" style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                    <table className="table">
                      <thead><tr><th>Name</th><th>Phone</th><th>Campaign</th><th>Stage</th></tr></thead>
                      <tbody>
                        {rows.slice(0, 8).map((r, i) => (
                          <tr key={i}>
                            <td>{columns.name ? r[columns.name] : ''}</td>
                            <td className="num">{columns.phone ? r[columns.phone] : ''}</td>
                            <td>{columns.campaign ? r[columns.campaign] : ''}</td>
                            <td>{columns.stage ? r[columns.stage] : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 8 && <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 4 }}>+ {rows.length - 8} more rows</div>}

                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button className="btn" onClick={resetBulk} disabled={importing}>Choose a different file</button>
                    <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={runImport} disabled={importing || !columns.phone}>
                      {importing ? 'Importing…' : `Import ${rows.length} leads`}
                    </button>
                  </div>
                </>
              )}

              {result && (
                <>
                  <div className="notice" style={{ borderLeftColor: 'var(--good)' }}>
                    <strong>{result.created} lead{result.created === 1 ? '' : 's'} imported.</strong>
                    {result.skipped > 0 && ` ${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped.`}
                  </div>
                  {result.errors.length > 0 && (
                    <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 12, color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
                      {result.errors.map((e, i) => (
                        <div key={i}>Row {e.row}: {e.reason}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button className="btn" onClick={resetBulk}>Import another file</button>
                    <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
