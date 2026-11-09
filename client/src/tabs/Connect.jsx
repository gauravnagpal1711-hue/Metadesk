import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// On a phone you can't scan a QR shown on the same screen, so default to the
// phone-number code there.
const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia('(max-width: 820px)').matches;

export default function Connect({ onConnectionChange }) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState({ adGreetingPatterns: [] });
  const [patternsDraft, setPatternsDraft] = useState('');
  const [savingPatterns, setSavingPatterns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pairMethod, setPairMethod] = useState(isPhone() ? 'phone' : 'qr'); // 'qr' | 'phone'
  const [phoneInput, setPhoneInput] = useState('');
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

  // Like Unipile's hosted flow: choosing "Scan QR code" shows the code straight away,
  // no extra "start" click. Uses a plain connect (no logout) so a saved session that is
  // still resuming after a deploy is never wiped; the button below does the clean restart.
  const autoStarted = useRef(false);
  useEffect(() => { autoStarted.current = false; }, [pairMethod]);
  useEffect(() => {
    if (!status || pairMethod !== 'qr' || autoStarted.current) return;
    if ((status.web?.status || 'disconnected') !== 'disconnected') return;
    autoStarted.current = true;
    api.post('/whatsapp/web/connect', {}).then(refresh).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pairMethod]);

  async function connect(phoneNumber) {
    setBusy(true);
    setError('');
    try {
      // Always start from a clean slate — a leftover broken session would
      // otherwise get silently retried instead of producing a fresh QR/code.
      await api.post('/whatsapp/web/logout').catch(() => {});
      await api.post('/whatsapp/web/connect', phoneNumber ? { phoneNumber } : {});
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function connectWithPhone() {
    // Same format Unipile asks for: international (E.164) digits only, no "+", spaces or dashes.
    const digits = phoneInput.replace(/\D/g, '');
    if (digits.length < 8) { setError('Enter your WhatsApp number with country code, e.g. 919876543210.'); return; }
    connect(digits);
  }

  function formatPairingCode(code) {
    if (!code) return '';
    return code.includes('-') ? code : `${code.slice(0, 4)}-${code.slice(4)}`;
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
  const waStatus = web.status === 'connected' ? 'good' : web.status === 'pairing' ? 'warn' : '';

  return (
    <>
      {error && <div className="notice bad">{error}</div>}

      <div className="card" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <h2 style={{ margin: 0 }}>Connect WhatsApp</h2>
          <span className={`pill-status ${waStatus}`} style={{ marginLeft: 'auto' }}>
            <span className="dot" />{web.status === 'connected' ? 'Connected' : web.status === 'pairing' ? 'Waiting to link' : 'Not connected'}
          </span>
        </div>

        {web.status !== 'connected' && (
          <div className="provider-row" style={{ marginTop: 12, gap: 6 }}>
            <button type="button" className={`btn sm ${pairMethod === 'qr' ? 'primary' : ''}`} onClick={() => setPairMethod('qr')}>
              Scan QR code
            </button>
            <button type="button" className={`btn sm ${pairMethod === 'phone' ? 'primary' : ''}`} onClick={() => setPairMethod('phone')}>
              Use phone number
            </button>
          </div>
        )}

        {web.status === 'connected' ? (
          <div style={{ marginTop: 16 }}>Linked as {web.me || 'this number'}.</div>
        ) : pairMethod === 'qr' ? (
          <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {web.status === 'pairing' && web.qr ? (
              <div className="qr" style={{ flex: '0 0 152px' }}>
                <img src={web.qr} alt="Scan this QR code with WhatsApp" />
              </div>
            ) : (
              <div className="qr" style={{ flex: '0 0 152px', color: 'var(--muted-2)', fontSize: 12 }}>
                No code yet
              </div>
            )}
            <ol className="steps" style={{ flex: 1, minWidth: 200 }}>
              <li>On your business phone open WhatsApp → Settings → Linked devices → Link a device.</li>
              <li>Scan this code. It refreshes automatically.</li>
            </ol>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {web.status === 'pairing' && web.pairingCode ? (
              <>
                <div style={{
                  fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700, letterSpacing: 2,
                  textAlign: 'center', padding: '14px 0', background: 'var(--accent-soft)', borderRadius: 10
                }}>
                  {formatPairingCode(web.pairingCode)}
                </div>
                <ol className="steps" style={{ marginTop: 12 }}>
                  <li>Open WhatsApp on your business phone.</li>
                  <li>Settings → Linked devices → Link a device → "Link with phone number instead".</li>
                  <li>Type this code. It expires after a couple of minutes.</li>
                </ol>
              </>
            ) : (
              <div className="field">
                <label htmlFor="wapn">Your WhatsApp number (country code first, digits only)</label>
                <input
                  id="wapn"
                  className="input num"
                  inputMode="numeric"
                  placeholder="e.g. 919876543210"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          {web.status === 'connected' ? (
            <button className="btn danger" onClick={disconnect} disabled={busy}>Unlink this number</button>
          ) : pairMethod === 'qr' ? (
            <button className="btn primary" onClick={() => connect()} disabled={busy}>
              {busy ? 'Starting…' : web.qr ? 'Get a new code' : 'Show QR code'}
            </button>
          ) : (
            <button className="btn primary" onClick={connectWithPhone} disabled={busy}>
              {busy ? 'Requesting…' : web.pairingCode ? 'Request a new code' : 'Get pairing code'}
            </button>
          )}
        </div>

        {web.error && <div className="notice bad" style={{ marginTop: 14 }}>{web.error}</div>}
      </div>

      <details className="card" style={{ marginTop: 20, maxWidth: 640 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Advanced: ad-click greetings</summary>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Meta prefills a message when someone taps a click-to-WhatsApp ad. List each variant you use (one per
          line, case-insensitive, partial match) so a first message matching one of these creates a lead.
          Anything else from an unknown number is queued instead of becoming a lead.
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
      </details>
    </>
  );
}
