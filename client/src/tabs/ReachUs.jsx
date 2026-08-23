import { useState } from 'react';
import { api } from '../api.js';

export default function ReachUs() {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    setError('');
    setSent(false);
    try {
      await api.post('/reach-us', { message: message.trim() });
      setMessage('');
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h2 style={{ margin: 0 }}>Reach us</h2>
      <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 13 }}>
        Have a question or something not working right? Write it below — it's sent straight to WhatsApp.
      </p>

      {error && <div className="notice bad" style={{ marginTop: 12 }}>{error}</div>}
      {sent && <div className="notice good" style={{ marginTop: 12 }}>Sent — we'll get back to you on WhatsApp.</div>}

      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="reach-us-message">Your query</label>
        <textarea
          id="reach-us-message"
          className="textarea"
          style={{ minHeight: 140 }}
          placeholder="Tell us what's going on…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <button className="btn primary" onClick={send} disabled={sending || !message.trim()}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
