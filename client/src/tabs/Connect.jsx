import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Connect() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const poll = useRef(null);

  async function refresh() {
    try {
      setStatus(await api.get('/whatsapp/status'));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    poll.current = setInterval(refresh, 3000);
    return () => clearInterval(poll.current);
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

  if (!status) return null;
  const web = status.web || {};
  const origin = window.location.origin;

  return (
    <>
      {error && <div className="notice bad">{error}</div>}

      <div className="grid2">
        <div className="card">
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 16, margin: '0 0 4px' }}>WhatsApp Web</h2>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>
            Pair your personal number by scanning a QR code, the same way web.whatsapp.com works.
          </p>

          <div style={{ marginBottom: 14 }}>
            <span className={`tag ${web.status === 'connected' ? 'good' : web.status === 'pairing' ? 'warn' : 'off'}`}>
              {web.status}
            </span>
            {web.me && <span className="num" style={{ marginLeft: 8 }}>{web.me}</span>}
          </div>

          {web.status === 'pairing' && web.qr && (
            <div className="qr" style={{ marginBottom: 14 }}>
              <img src={web.qr} alt="Scan this QR code with WhatsApp" />
            </div>
          )}

          {web.status !== 'connected' ? (
            <>
              <ol className="steps" style={{ marginBottom: 14 }}>
                <li>Tap Start pairing to generate a code.</li>
                <li>On your phone open WhatsApp → Settings → Linked devices.</li>
                <li>Tap Link a device and scan the code above.</li>
              </ol>
              <button className="btn primary" onClick={connect} disabled={busy}>
                {busy ? 'Starting…' : web.qr ? 'Refresh code' : 'Start pairing'}
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={disconnect} disabled={busy}>Unlink this number</button>
          )}

          {web.error && <div className="notice bad" style={{ marginTop: 14 }}>{web.error}</div>}

          <div className="notice" style={{ marginTop: 16 }}>
            Sessions are stored in <code>{web.sessionDir}</code>. Attach a Railway volume at that path,
            or you will re-scan the code after every deploy.
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 16, margin: '0 0 4px' }}>WhatsApp Cloud API</h2>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>
            The official route. Steadier for volume, and it survives redeploys.
          </p>

          <div style={{ marginBottom: 14 }}>
            <span className={`tag ${status.cloud.connected ? 'good' : 'off'}`}>
              {status.cloud.connected ? 'connected' : 'not connected'}
            </span>
          </div>

          <dl className="kv">
            <dt>Phone number ID</dt>
            <dd>{status.cloud.phoneNumberId || 'WA_PHONE_NUMBER_ID not set'}</dd>
            <dt>Callback URL</dt>
            <dd>{origin}{status.cloud.webhookPath}</dd>
            <dt>Verify token</dt>
            <dd>value of WA_VERIFY_TOKEN</dd>
          </dl>

          <ol className="steps" style={{ marginTop: 16 }}>
            <li>In Meta for Developers, open your app → WhatsApp → Configuration.</li>
            <li>Paste the callback URL and verify token above, then subscribe to the messages field.</li>
            <li>Set WA_PHONE_NUMBER_ID and WA_TOKEN in Railway and redeploy.</li>
          </ol>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 16, margin: '0 0 6px' }}>What happens after pairing</h2>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Every incoming message is matched to a lead by phone number. If the number is new, a lead is created
          in your first funnel stage. Replies you send from the Leads tab are logged on the same trail, so the
          full conversation sits next to the remarks for that lead.
        </p>
      </div>
    </>
  );
}
