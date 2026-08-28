import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Login({ onDone }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [remember, setRemember] = useState(true);
  const [signupEnabled, setSignupEnabled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then((r) => setSignupEnabled(!!r.signupEnabled)).catch(() => {});
  }, []);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') {
        await api.post('/auth/signup', { username, password, business_name: businessName });
      } else {
        await api.post('/auth/login', { username, password, remember });
      }
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === 'signup';

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
          <p>Connect your own Meta ad account and WhatsApp number. Campaigns sync every ten minutes, and every WhatsApp reply attaches to the lead it came from.</p>
        </div>

        <div className="stats">
          <div className="cell"><div className="k">Sync</div><div className="v">10 min</div></div>
          <div className="cell"><div className="k">Stages</div><div className="v">6</div></div>
          <div className="cell"><div className="k">Your data</div><div className="v">Private</div></div>
        </div>

        <div className="footline">Railway · Postgres · JWT session</div>
      </div>

      <div className="auth-panel">
        <div className="auth-form">
          <h1>{isSignup ? 'Create your Ads Desk' : 'Sign in to Ads Desk'}</h1>
          <div className="sub">
            {isSignup
              ? 'Pick a User ID and password. You can connect Meta and WhatsApp once you are in.'
              : 'Enter your User ID and password.'}
          </div>

          <div className="fields">
            <label className="field" style={{ marginBottom: 0 }}>
              <span>User ID</span>
              <input
                className="input"
                autoFocus
                placeholder="e.g. beautybox"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>

            {isSignup && (
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Business name</span>
                <input
                  className="input"
                  placeholder="Malhotra Interiors"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </label>
            )}

            <label className="field" style={{ marginBottom: 0 }}>
              <span>Password</span>
              <input
                className="input"
                type="password"
                placeholder={isSignup ? 'At least 8 characters' : '••••••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>

            {!isSignup && (
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
            )}

            <button
              className="btn primary"
              style={{ marginTop: 4 }}
              onClick={submit}
              disabled={busy || !username || !password}
            >
              {busy ? (isSignup ? 'Creating…' : 'Signing in…') : isSignup ? 'Create account' : 'Sign in'}
            </button>

            {error && <div className="err">{error}</div>}

            {signupEnabled && (
              <button
                type="button"
                className="btn ghost sm"
                style={{ marginTop: 6, alignSelf: 'flex-start' }}
                onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(''); }}
              >
                {isSignup ? 'Have an account? Sign in' : 'New here? Create an account'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
