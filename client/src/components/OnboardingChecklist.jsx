import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Path-A onboarding for a non-technical shopkeeper: one numbered checklist that
 * probes their Meta setup and walks them through each gap. Steps Meta forces
 * onto its own screens (create a Page, add a card) open in a popup — the same
 * pattern as the Facebook-login button — and the list re-checks itself when the
 * popup closes. Each step is collapsed to a title + one line; tap to expand the
 * "why" and the "how".
 */
export default function OnboardingChecklist({ onNavigate, onFocusPicker, onRefreshed }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const [touched, setTouched] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/facebook/onboarding');
      setData(r);
      setError('');
      onRefreshed?.();
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, [onRefreshed]);

  useEffect(() => {
    refresh();
    const onMsg = (e) => { if (e.data === 'fb-connected') refresh(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [refresh]);

  // Until the user opens something themselves, keep the first unfinished step open.
  useEffect(() => {
    if (touched || !data?.steps) return;
    const next = data.steps.find((s) => s.status !== 'done');
    setOpenKey(next ? next.key : null);
  }, [data, touched]);

  function toggle(key) {
    setTouched(true);
    setOpenKey((k) => (k === key ? null : key));
  }

  function runAction(step) {
    const a = step.action;
    if (!a) return;
    if (a.type === 'meta') {
      setBusyKey(step.key);
      const w = window.open(a.url, 'meta-setup', 'width=780,height=820');
      const timer = setInterval(async () => {
        if (!w || w.closed) {
          clearInterval(timer);
          await refresh();
          setBusyKey('');
        }
      }, 1000);
      return;
    }
    if (a.target === 'whatsapp') onNavigate?.('connect');
    else if (a.target === 'picker') onFocusPicker?.();
    else if (a.target) onNavigate?.(a.target);
  }

  if (!data) return null;

  const steps = data.steps || [];
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const allDone = steps.length > 0 && doneCount === steps.length;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Your growth checklist</h2>
        <span className={`pill-status ${allDone ? 'good' : data.ready ? 'good' : ''}`} style={{ marginLeft: 'auto' }}>
          <span className="dot" />
          {allDone ? 'Your ad is live' : data.ready ? `Connected — ${doneCount} of ${steps.length} done` : `${doneCount} of ${steps.length} done`}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden', margin: '10px 0' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 999,
          background: allDone ? 'var(--good)' : 'var(--accent)', transition: 'width .25s'
        }} />
      </div>
      <p style={{ color: 'var(--muted)', margin: '4px 0 12px', fontSize: 13 }}>
        Every step here either happens inside Ads Desk, or opens Meta for the one screen only Facebook can
        show you — finish there, close it, and this list ticks itself off automatically.
      </p>

      {error && <div className="notice bad">{error}</div>}

      <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        {steps.map((s, i) => {
          const isOpen = openKey === s.key;
          const badge = s.status === 'done' ? '✓' : s.status === 'warn' ? '!' : String(i + 1);
          const badgeBg = s.status === 'done' ? 'var(--good)' : s.status === 'warn' ? 'var(--warn)' : 'var(--accent)';
          return (
            <div key={s.key} style={{ borderTop: i ? '1px solid var(--line)' : 'none' }}>
              <button
                type="button"
                onClick={() => toggle(s.key)}
                aria-expanded={isOpen}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', background: isOpen ? 'var(--accent-soft-2)' : 'transparent',
                  border: 'none', textAlign: 'left', cursor: 'pointer'
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: '#fff', background: badgeBg
                  }}
                >
                  {badge}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 13.5, fontWeight: 600,
                    color: s.status === 'done' ? 'var(--muted)' : 'inherit'
                  }}>
                    {s.title}
                  </span>
                  {s.oneLiner && (
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginTop: 1 }}>
                      {s.oneLiner}
                    </span>
                  )}
                </span>
                <span aria-hidden style={{
                  flex: '0 0 auto', color: 'var(--muted-2)', fontSize: 12,
                  transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s'
                }}>
                  ▶
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: '4px 14px 16px 48px' }}>
                  {s.why && (
                    <p style={{ margin: '4px 0 10px', fontSize: 13, color: 'var(--muted-3)' }}>{s.why}</p>
                  )}
                  {Array.isArray(s.how) && s.how.length > 0 && (
                    <ol style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                      {s.how.map((line, idx) => <li key={idx}>{line}</li>)}
                    </ol>
                  )}
                  {s.action && s.status !== 'done' && (
                    <button
                      className="btn primary"
                      onClick={() => runAction(s)}
                      disabled={busyKey === s.key}
                    >
                      {busyKey === s.key
                        ? 'Waiting — finish in the Facebook window…'
                        : s.action.type === 'meta'
                          ? `${s.action.label}  ↗`
                          : s.action.label}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data.errors?.length > 0 && (
        <div className="notice" style={{ marginTop: 12 }}>
          Some checks with Facebook didn't load, so the list may be incomplete: {data.errors.join('; ')}
        </div>
      )}

      {allDone ? (
        <div className="notice" style={{ borderLeftColor: 'var(--good)', marginTop: 12 }}>
          <strong>You're live.</strong> Your first campaign is running on Meta.
        </div>
      ) : data.ready && (
        <div className="notice" style={{ borderLeftColor: 'var(--good)', marginTop: 12 }}>
          <strong>Facebook connected.</strong> Keep going below to make and launch your first ad.
        </div>
      )}
    </div>
  );
}
