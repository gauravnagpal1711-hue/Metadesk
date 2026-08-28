import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const SOURCE_LABEL = {
  saved: 'saved',
  page: 'from your Facebook Page',
  env: 'from server config',
  'whatsapp-web': 'from the paired WhatsApp'
};

/**
 * Shows / edits the WhatsApp number lead campaigns send people to. A saved
 * number overrides auto-detection everywhere. `onChange(number)` fires after
 * a successful save/clear so callers can refresh.
 */
export default function WhatsAppNumberSetting({ compact = false, onChange }) {
  const [state, setState] = useState(null); // { number, source, manual }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get('/meta/whatsapp-number');
      setState(r);
      if (!r.number) setEditing(true);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const digits = draft.replace(/\D/g, '');
    if (digits.length < 10) { setError('Enter the number with country code, e.g. 919354260517.'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/meta/whatsapp-number', { number: digits });
      setState(r);
      setEditing(false);
      setDraft('');
      onChange?.(r.number);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError('');
    try {
      const r = await api.del('/meta/whatsapp-number');
      setState(r);
      onChange?.(r.number);
      if (!r.number) { setEditing(true); setDraft(''); }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <div style={{ fontSize: 13 }}>
      {error && <div className="notice bad" style={{ margin: '0 0 6px' }}>{error}</div>}

      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            Leads message you on WhatsApp at <strong>+{state.number}</strong>
            <span style={{ color: 'var(--muted-2)' }}> ({SOURCE_LABEL[state.source] || state.source})</span>
          </span>
          <button className="btn ghost sm" onClick={() => { setDraft(state.number || ''); setEditing(true); }}>Change</button>
          {state.manual && <button className="btn ghost sm" onClick={clear} disabled={busy}>Use auto-detected</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!compact && <span style={{ color: 'var(--muted)' }}>WhatsApp number for lead ads:</span>}
          <input
            className="input"
            style={{ width: 200 }}
            placeholder="919354260517"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d+ ]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <button className="btn primary sm" onClick={save} disabled={busy || draft.replace(/\D/g, '').length < 10}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {state.number && <button className="btn ghost sm" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>}
        </div>
      )}
    </div>
  );
}
