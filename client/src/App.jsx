import { useEffect, useState } from 'react';
import { api } from './api.js';
import Login from './components/Login.jsx';
import Creative from './tabs/Creative.jsx';
import Campaigns from './tabs/Campaigns.jsx';
import Leads from './tabs/Leads.jsx';
import Connect from './tabs/Connect.jsx';
import Facebook from './tabs/Facebook.jsx';

const TABS = [
  { id: 'creative', label: 'Create', glyph: '◈', title: 'Creative studio', sub: 'Write the copy, generate the artwork.' },
  { id: 'campaigns', label: 'Campaigns', glyph: '▤', title: 'Campaigns', sub: 'Live from your Meta ad account.' },
  { id: 'leads', label: 'Leads', glyph: '⇥', title: 'Lead funnel', sub: 'Drag a lead to move it forward.' },
  { id: 'facebook', label: 'Facebook', glyph: '◆', title: 'Facebook', sub: 'Sign in to sync campaigns and leads.' },
  { id: 'connect', label: 'WhatsApp', glyph: '◉', title: 'WhatsApp', sub: 'Pair a number so replies land on the lead.' }
];

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('leads');

  useEffect(() => {
    api.get('/auth/me').then((r) => setAuthed(r.authenticated)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="shell">
      <nav className="rail">
        <div className="mark">ADS DESK</div>
        <div className="rail-nav">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              className={`rail-btn ${tab === t.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="glyph" aria-hidden="true">{t.glyph}</span>
              <span className="lbl">{t.label}</span>
            </button>
          ))}
        </div>
        <button
          className="rail-foot btn ghost sm"
          onClick={() => api.post('/auth/logout').then(() => setAuthed(false))}
        >
          Sign out
        </button>
      </nav>

      <main className="main">
        <header className="topbar">
          <h1>{active.title}</h1>
          <span className="sub">{active.sub}</span>
        </header>
        <div className="page">
          {tab === 'creative' && <Creative />}
          {tab === 'campaigns' && <Campaigns />}
          {tab === 'leads' && <Leads />}
          {tab === 'facebook' && <Facebook />}
          {tab === 'connect' && <Connect />}
        </div>
      </main>
    </div>
  );
}
