import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Connect({ onConnectionChange }) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState({ onlyExistingLeads: false, adGreetingPatterns: [] });
  const [patternsDraft, setPatternsDraft] = useState('');
  const [savingPatterns, setSavingPatterns] = useState(false);
  const [cloud, setCloud] = useState(null); // { phoneNumberId, verifyToken, hasToken, webhookUrl }
  const [cloudDraft, setCloudDraft] = useState({ phoneNumberId: '', token: '', verifyToken: '' });
  const [savingCloud, setSavingCloud] = useState(false);
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
    api.get('/whatsapp/cloud').then((c) => {
      setCloud(c);
      setCloudDraft({ phoneNumberId: c.phoneNumberId || '', token: '', verifyToken: c.verifyToken || '' });
    }).catch(() => {});
    poll.current = setInterval(refresh, 3000);
    return () => clearInterval(poll.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    setError('');
    try {
      // Always start from a clean slate — a leftover broken session would
      // otherwise get silently retried instead of producing a fresh QR.
      await api.post('/whatsapp/web/logout').catch(() => {});
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

  async function saveCloud() {
    setSavingCloud(true);
    setError('');
    try {
      const body = {
        phoneNumberId: cloudDraft.phoneNumberId.trim(),
        verifyToken: cloudDraft.verifyToken.trim()
      };
      if (cloudDraft.token.trim()) body.token = cloudDraft.token.trim();
      const updated = await api.patch('/whatsapp/cloud', body);
      setCloud((c) => ({ ...(c || {}), ...updated }));
      setCloudDraft((d) => ({ ...d, token: '' }));
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingCloud(false);
    }
  }

  function genVerifyToken() {
    setCloudDraft((d) => ({
      ...d,
      verifyToken: (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 24)
    }));
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
            <h2 style={{ margin: 0 }}>Cloud API</h2>
            <span className={`pill-status ${status.cloud.connected ? 'good' : ''}`} style={{ marginLeft: 'auto' }}>
              <span className="dot" />{status.cloud.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 12.5 }}>
            Alternative to QR pairing — your own WhatsApp Business number via Meta&apos;s Cloud API.
            Enter the credentials from Meta for Developers below; nothing goes in Railway.
          </p>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="cb">Callback URL (paste into Meta)</label>
            <input id="cb" className="input num" readOnly onFocus={(e) => e.target.select()}
              value={`${origin}${cloud?.webhookUrl || status.cloud.webhookPath}`} />
          </div>

          <div className="field">
            <label htmlFor="wpn">Phone number ID</label>
            <input id="wpn" className="input num" placeholder="e.g. 1036363452890512"
              value={cloudDraft.phoneNumberId}
              onChange={(e) => setCloudDraft((d) => ({ ...d, phoneNumberId: e.target.value }))} />
          </div>

          <div className="field">
            <label htmlFor="wtok">Access token</label>
            <input id="wtok" className="input num" type="password"
              placeholder={cloud?.hasToken ? '•••••••• saved — leave blank to keep' : 'Permanent token from Meta'}
              value={cloudDraft.token}
              onChange={(e) => setCloudDraft((d) => ({ ...d, token: e.target.value }))} />
          </div>

          <div className="field">
            <label htmlFor="wvt">Verify token (paste into Meta)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="wvt" className="input num" style={{ flex: 1 }}
                value={cloudDraft.verifyToken}
                onChange={(e) => setCloudDraft((d) => ({ ...d, verifyToken: e.target.value }))} />
              <button type="button" className="btn sm" onClick={genVerifyToken}>Generate</button>
            </div>
          </div>

          <button className="btn primary" onClick={saveCloud} disabled={savingCloud}>
            {savingCloud ? 'Saving…' : 'Save Cloud API details'}
          </button>

          <div className="provider-row" style={{ marginTop: 16 }}>
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
            <li>In Meta for Developers, open your app → WhatsApp → API Setup — copy the Phone number ID and a permanent access token.</li>
            <li>Save them here, then in WhatsApp → Configuration paste the callback URL and verify token above and subscribe to the <code>messages</code> field.</li>
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
