import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { password });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-box">
        <h1 className="mark-h">Ads Desk</h1>
        <p>Your Meta campaigns, leads and WhatsApp in one place.</p>
        <div className="field">
          <input
            className="input"
            type="password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && signIn()}
          />
        </div>
        <button className="btn primary" style={{ width: '100%' }} onClick={signIn} disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="err">{error}</div>}
      </div>
    </div>
  );
}
