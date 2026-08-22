import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { username, password, remember });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="mark">
          <div className="mark-icon">A</div>
          <div className="mark-name">Ads Desk</div>
        </div>

        <div className="pitch">
          <div className="kicker">Meta control room</div>
          <h2>Campaigns, leads, and WhatsApp in one desk.</h2>
          <p>Meta campaigns sync every ten minutes. Lead-form leads land straight in the funnel, and every WhatsApp reply attaches to the lead it came from.</p>
        </div>

        <div className="stats">
          <div className="cell"><div className="k">Sync</div><div className="v">10 min</div></div>
          <div className="cell"><div className="k">Stages</div><div className="v">6</div></div>
          <div className="cell"><div className="k">Seats</div><div className="v">1</div></div>
        </div>

        <div className="footline">Railway · Postgres · JWT session</div>
      </div>

      <div className="auth-panel">
        <div className="auth-form">
          <h1>Sign in to Ads Desk</h1>
          <div className="sub">Enter the username and password you set in your Railway environment variables.</div>

          <div className="fields">
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Username</span>
              <input
                className="input"
                autoFocus
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
              />
            </label>

            <label className="field" style={{ marginBottom: 0 }}>
              <span>Password</span>
              <input
                className="input"
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
              />
            </label>

            <div className="remember-row">
              <button
                type="button"
                className={`toggle ${remember ? 'on' : ''}`}
                onClick={() => setRemember((r) => !r)}
                aria-pressed={remember}
                aria-label="Keep this device signed in"
              >
                <span />
              </button>
              <span className="lbl">Keep this device signed in for 30 days</span>
            </div>

            <button className="btn primary" style={{ marginTop: 4 }} onClick={signIn} disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {error && <div className="err">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
