import { useEffect, useState } from 'react';
import { api } from '../api.js';

function CheckIcon() {
  return (
    <svg className="check-icon" width="8" height="8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const year = new Date().getFullYear();

  return (
    <div className="auth">
    <div className="auth-card">
      <div className="auth-brand">
        <div className="mark">
          <div className="mark-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M4 5.5H20M12 5.5V19" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mark-name">Trustura <span>Digital</span></div>
        </div>

        <div className="pitch">
          <div className="kicker">Digital advertising suite</div>
          <h2>One command centre for Meta campaigns, leads, and WhatsApp.</h2>
          <p>Connect your own Meta ad account and WhatsApp number. Campaigns sync every ten minutes, and every WhatsApp reply attaches to the lead it came from.</p>
        </div>

        <ul className="feature-list">
          <li><CheckIcon /> Direct Meta Marketing API integration</li>
          <li><CheckIcon /> WhatsApp conversations synced to every lead</li>
          <li><CheckIcon /> Your business data stays isolated to you</li>
        </ul>

        <div className="stats">
          <div className="cell"><div className="k">Sync</div><div className="v">10 min</div></div>
          <div className="cell"><div className="k">Stages</div><div className="v">6</div></div>
          <div className="cell"><div className="k">Your data</div><div className="v">Private</div></div>
        </div>

        <div className="brand-foot">
          <div className="brand-foot-company">A product of Trustura Global Services Pvt. Ltd.</div>
          <div className="footline">Meta Marketing API · WhatsApp Cloud API</div>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-form">
          <h1>{isSignup ? 'Create your Trustura Digital account' : 'Sign in to Trustura Digital'}</h1>
          <div className="sub">
            {isSignup
              ? 'Pick a User ID and password — you can connect Meta and WhatsApp once you are in.'
              : 'Enter your User ID and password to continue.'}
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

          <div className="legal-links">
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            <span>·</span>
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          </div>
          <div className="legal-caption">© {year} Trustura Global Services Pvt. Ltd. All rights reserved.</div>
        </div>
      </div>
    </div>
    </div>
  );
}
