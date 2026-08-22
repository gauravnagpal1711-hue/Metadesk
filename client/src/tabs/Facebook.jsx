import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Facebook({ onConnectionChange }) {
  const [status, setStatus] = useState(null);
  const [options, setOptions] = useState(null);
  const [adAccountId, setAdAccountId] = useState('');
  const [pageId, setPageId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await api.get('/facebook/status');
      setStatus(s);
      setAdAccountId(s.connection?.adAccountId || '');
      setPageId(s.connection?.pageId || '');
      if (s.connection?.hasToken) {
        const opts = await api.get('/facebook/accounts').catch(() => null);
        setOptions(opts);
      }
      onConnectionChange?.();
    } catch (e) {
      setError(e.message);
    }
  }, [onConnectionChange]);

  useEffect(() => {
    refresh();
    const onMsg = (e) => { if (e.data === 'fb-connected') refresh(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [refresh]);

  async function connect() {
    setBusy('connect');
    setError('');
    try {
      const { url } = await api.get('/facebook/connect');
      const popup = window.open(url, 'fb-login', 'width=640,height=720');
      const timer = setInterval(async () => {
        if (popup && popup.closed) {
          clearInterval(timer);
          await refresh();
          setBusy('');
        }
      }, 1000);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }

  async function save() {
    setBusy('save');
    setError('');
    try {
      await api.post('/facebook/select', { adAccountId, pageId });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    try {
      await api.post('/facebook/disconnect');
      setOptions(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (!status) return null;
  const conn = status.connection || {};
  const connected = conn.hasToken;
  const ready = connected && conn.adAccountId && conn.pageId;

  return (
    <>
      {error && <div className="notice bad">{error}</div>}

      {!status.oauthConfigured && (
        <div className="notice">
          <strong>Facebook login isn't set up yet.</strong> Add <code>FB_APP_ID</code>, <code>FB_APP_SECRET</code>{' '}
          and <code>PUBLIC_URL</code> in Railway variables, then redeploy.
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, background: 'var(--accent-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: 'var(--accent)'
            }}>f</div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{connected ? `Signed in${conn.name ? ` as ${conn.name}` : ''}` : 'Not signed in'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {connected ? 'Token connected' : 'Sign in to sync campaigns and leads'}
              </div>
            </div>
            <span className={`pill-status ${connected ? 'good' : ''}`} style={{ marginLeft: 'auto' }}>
              <span className="dot" />{connected ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {connected && (
            <div className="kv-rows">
              <div className="row">
                <span className="k">Ad account</span>
                <span className="v">{options?.adAccounts.find((a) => a.account_id === conn.adAccountId)?.name || conn.adAccountId || '—'}</span>
                {conn.adAccountId && <span className="id">{conn.adAccountId}</span>}
              </div>
              <div className="row">
                <span className="k">Page</span>
                <span className="v">{options?.pages.find((p) => p.id === conn.pageId)?.name || conn.pageId || '—'}</span>
                {conn.pageId && <span className="id">{conn.pageId}</span>}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {!connected ? (
              <button className="btn primary" onClick={connect} disabled={busy === 'connect' || !status.oauthConfigured}>
                {busy === 'connect' ? 'Opening Facebook…' : 'Continue with Facebook'}
              </button>
            ) : (
              <button className="btn danger" onClick={disconnect} disabled={busy === 'disconnect'}>
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <h2>Choose account & page</h2>
          <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: 13 }}>
            Pick which ad account to manage and which page's lead forms to pull from.
          </p>

          {!connected ? (
            <div className="empty" style={{ padding: 24 }}>Sign in first, then choose here.</div>
          ) : !options ? (
            <div style={{ color: 'var(--muted)' }}>Loading your accounts…</div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="acct">Ad account</label>
                <select id="acct" className="select" value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)}>
                  <option value="">Select…</option>
                  {options.adAccounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.name} · {a.account_id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="page">Facebook page</label>
                <select id="page" className="select" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                  <option value="">Select…</option>
                  {options.pages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <button className="btn primary" onClick={save} disabled={busy === 'save' || !adAccountId || !pageId}>
                {busy === 'save' ? 'Saving…' : 'Save & start syncing'}
              </button>
            </>
          )}
        </div>
      </div>

      {ready && (
        <div className="notice" style={{ borderLeftColor: 'var(--good)', marginTop: 20 }}>
          <strong>All set.</strong> Campaigns and leads will sync automatically. Head to the Leads tab —
          new leads land in the first column on their own.
        </div>
      )}
    </>
  );
}
