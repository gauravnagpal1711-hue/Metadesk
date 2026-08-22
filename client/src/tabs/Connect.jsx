import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Connect({ onConnectionChange }) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState({ onlyExistingLeads: false, adGreetingPatterns: [] });
  const [patternsDraft, setPatternsDraft] = useState('');
  const [savingPatterns, setSavingPatterns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const poll = useRef(null);

  async function refresh() {
    try {
      setStatus(await api.get('/whatsapp/status'));
      onConnectionChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    api.get('/whatsapp/settings').then((s) => {
      setSettings(s);
      setPatternsDraft((s.adGreetingPatterns || []).join('\n'));
    }).catch(() => {});
    poll.current = setInterval(refresh, 3000);
    return () => clearInterval(poll.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    setError('');
    try {
      await api.post('/whatsapp/web/connect');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.post('/whatsapp/web/logout');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleOnlyExisting() {
    const next = !settings.onlyExistingLeads;
    setSettings((s) => ({ ...s, onlyExistingLeads: next }));
    try {
      await api.patch('/whatsapp/settings', { onlyExistingLeads: next });
    } catch (e) {
      setSettings((s) => ({ ...s, onlyExistingLeads: !next }));
      setError(e.message);
    }
  }

  async function savePatterns() {
    setSavingPatterns(true);
    setError('');
    try {
      const patterns = patternsDraft.split('\n').map((p) => p.trim()).filter(Boolean);
      const updated = await api.patch('/whatsapp/settings', { adGreetingPatterns: patterns });
      setSettings((s) => ({ ...s, adGreetingPatterns: updated.adGreetingPatterns }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingPatterns(false);
    }
  }

  if (!status) return null;
  const web = status.web || {};
  const origin = window.location.origin;
  const waStatus = web.status === 'connected' ? 'good' : web.status === 'pairing' ? 'warn' : '';

  return (
    <>
      {error && <div className="notice bad">{error}</div>}

      <div className="grid2">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <h2 style={{ margin: 0 }}>Pair by QR</h2>
            <span className={`pill-status ${waStatus}`} style={{ marginLeft: 'auto' }}>
              <span className="dot" />{web.status === 'connected' ? 'Connected' : web.status === 'pairing' ? 'Waiting for scan' : 'Not connected'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center' }}>
            {web.status === 'pairing' && web.qr ? (
              <div className="qr" style={{ flex: '0 0 152px' }}>
                <img src={web.qr} alt="Scan this QR code with WhatsApp" />
              </div>
            ) : (
              <div className="qr" style={{ flex: '0 0 152px', color: 'var(--muted-2)', fontSize: 12 }}>
                {web.status === 'connected' ? web.me || 'Linked' : 'No code yet'}
              </div>
            )}
            <ol className="steps">
              <li>Open WhatsApp on the ad phone.</li>
              <li>Settings → Linked devices → Link a device.</li>
              <li>Scan this code. It refreshes automatically.</li>
            </ol>
          </div>

          <div style={{ marginTop: 14 }}>
            {web.status !== 'connected' ? (
              <button className="btn primary" onClick={connect} disabled={busy}>
                {busy ? 'Starting…' : web.qr ? 'Refresh code' : 'Start pairing'}
              </button>
            ) : (
              <button className="btn danger" onClick={disconnect} disabled={busy}>Unlink this number</button>
            )}
          </div>

          {web.error && <div className="notice bad" style={{ marginTop: 14 }}>{web.error}</div>}

          <div className="notice" style={{ marginTop: 16 }}>
            Sessions are stored in <code>{web.sessionDir}</code>. Attach a Railway volume at that path,
            or you will re-scan the code after every deploy.
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <h2 style={{ margin: 0 }}>Cloud API webhook</h2>
            <span className={`pill-status ${status.cloud.connected ? 'good' : ''}`} style={{ marginLeft: 'auto' }}>
              <span className="dot" />{status.cloud.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 12.5 }}>
            Alternative to QR pairing. Incoming messages match existing leads by phone only.
          </p>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="cb">Callback URL</label>
            <input id="cb" className="input num" readOnly value={`${origin}${status.cloud.webhookPath}`} />
          </div>
          <div className="field">
            <label htmlFor="vt">Verify token</label>
            <input id="vt" className="input num" readOnly value="value of WA_VERIFY_TOKEN" />
          </div>

          <div className="provider-row">
            <span style={{ fontSize: 12.5, color: 'var(--muted-3)' }}>Only message existing leads</span>
            <button
              type="button"
              className={`toggle ${settings.onlyExistingLeads ? 'on' : ''}`}
              style={{ marginLeft: 'auto' }}
              onClick={toggleOnlyExisting}
              aria-pressed={settings.onlyExistingLeads}
            >
              <span />
            </button>
          </div>

          <ol className="steps" style={{ marginTop: 16 }}>
            <li>In Meta for Developers, open your app → WhatsApp → Configuration.</li>
            <li>Paste the callback URL and verify token above, then subscribe to the messages field.</li>
            <li>Set WA_PHONE_NUMBER_ID and WA_TOKEN in Railway and redeploy.</li>
          </ol>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>What happens after pairing</h2>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>
          Every incoming message is matched to a lead by phone number. For campaigns with an Instant Form,
          the lead already exists from the Meta sync, so the message just attaches to it. For click-to-WhatsApp
          campaigns with no form, a new lead is only created when the first message looks like a real ad
          click — see below. Anything else is queued, not turned into a lead, until it matches one.
        </p>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Ad-click greetings</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: 13 }}>
          Meta prefills a message when someone taps a click-to-WhatsApp ad — the exact wording is whatever
          you set in that ad's message template. List each variant you use (one per line, case-insensitive,
          partial match) so a first message matching one of these creates a lead. Anything else from an
          unknown number is queued instead of becoming a lead.
        </p>
        <textarea
          className="textarea"
          style={{ minHeight: 90, fontFamily: 'var(--mono)', fontSize: 12.5 }}
          value={patternsDraft}
          onChange={(e) => setPatternsDraft(e.target.value)}
          placeholder="Hello! I filled in your form and would like to know more about your business."
        />
        <button className="btn primary" style={{ marginTop: 10 }} onClick={savePatterns} disabled={savingPatterns}>
          {savingPatterns ? 'Saving…' : 'Save greeting patterns'}
        </button>
      </div>
    </>
  );
}
