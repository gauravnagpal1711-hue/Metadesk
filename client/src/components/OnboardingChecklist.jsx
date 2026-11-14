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
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia('(max-width: 820px)').matches;
}

/**
 * Phone version of "Create a Facebook Page". If the Facebook app is installed, it grabs
 * every facebook.com link and shows its home feed instead of the Page-creation form.
 * (A web page cannot detect whether the app is installed.) With the app removed the
 * link opens in the browser and works, so the button is unlocked only after the person
 * confirms the app is deleted. The list re-checks when they come back to this tab.
 */
function MobilePageCard({ url, onCheck, checking }) {
  const [removed, setRemoved] = useState(false);
  // Re-check automatically when the person comes back from the browser.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') onCheck(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [onCheck]);
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: 'var(--accent-soft-2)' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Create your Facebook Page</div>
      <div className="notice bad" style={{ marginBottom: 10, fontSize: 13.5, lineHeight: 1.5 }}>
        <strong>First: delete the Facebook app from your phone.</strong> If the Facebook app is installed,
        it hijacks this link and shows its home page instead of Page creation. Uninstall it now
        (press and hold the Facebook icon, then Uninstall / Remove App). You can reinstall it
        later, after your Page is created.
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, marginBottom: 10 }}>
        <input type="checkbox" checked={removed} onChange={(e) => setRemoved(e.target.checked)}
          style={{ width: 20, height: 20 }} />
        I have deleted the Facebook app (or don't have it)
      </label>
      <a className={`btn primary${removed ? '' : ' disabled'}`}
        href={removed ? url : undefined} target="_blank" rel="noopener noreferrer"
        aria-disabled={!removed}
        onClick={(e) => { if (!removed) e.preventDefault(); }}
        style={{ display: 'block', textAlign: 'center', textDecoration: 'none', opacity: removed ? 1 : 0.45 }}>
        Create Facebook Page ↗
      </a>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0' }}>
        Log in to Facebook in the browser if it asks, type your business name, pick a category and tap
        "Create Page". Then come back here. You can reinstall the Facebook app afterwards.
      </div>
      <button className="btn" onClick={onCheck} disabled={checking} style={{ width: '100%' }}>
        {checking ? 'Checking…' : '✓ I created my Page'}
      </button>
    </div>
  );
}

/**
 * Links a WhatsApp number to the Facebook Page (Meta requires this before a
 * click-to-WhatsApp ad set can be created). Step 1 asks Meta to send a code to the
 * number on WhatsApp; step 2 submits the code.
 */
function PageWhatsAppLink({ defaultNumber, onLinked }) {
  const [number, setNumber] = useState(defaultNumber || '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function call(withCode) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.post('/facebook/page-whatsapp', { number, code: withCode ? code : undefined });
      if (r.linked) { setMsg('Linked!'); await onLinked?.(); }
      else if (!withCode) { setSent(true); setMsg('Code requested. Open WhatsApp on that phone and enter the code below.'); }
      else {
        // Show Meta's real answer (verification_status / error_message / anything else)
        // instead of a generic line, so a rejected code can actually be diagnosed.
        const res = r.result || {};
        const detail = [
          res.error_message,
          res.verification_status ? `status: ${res.verification_status}` : null,
          Object.keys(res).length ? `raw: ${JSON.stringify(res)}` : 'raw: (empty reply)'
        ].filter(Boolean).join(' · ');
        setErr(`Meta did not confirm the code. ${detail}`);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Re-check when the person comes back from Facebook, so the step turns green on its own.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') onLinked?.(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [onLinked]);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: 'var(--accent-soft-2)', marginTop: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Link it on Facebook (about 2 minutes)</div>
      <ol style={{ margin: '0 0 10px', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>
        <li>Open your Facebook Page (a computer is easiest).</li>
        <li>Go to <strong>Settings → Linked accounts → WhatsApp → Connect WhatsApp number</strong>.</li>
        <li>Enter {number ? <strong>+{number.replace(/\D/g, '')}</strong> : 'your WhatsApp number'} and tap Continue.</li>
        <li>Facebook sends a code to that number on WhatsApp — type it in.</li>
        <li>Come back here. This step turns green by itself.</li>
      </ol>
      <button className="btn primary" onClick={() => onLinked?.()} style={{ width: '100%' }}>
        ✓ I linked it — check now
      </button>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--muted)' }}>
          Try linking automatically (needs extra Facebook permission)
        </summary>
        <div style={{ marginTop: 8 }}>
          {err && <div className="notice bad" style={{ margin: '0 0 8px' }}>{err}</div>}
          {msg && <div className="notice" style={{ margin: '0 0 8px' }}>{msg}</div>}
          <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>WhatsApp number (country code first, digits only)</label>
          <input className="input num" inputMode="numeric" placeholder="919876543210" value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^\d+ ]/g, ''))} style={{ marginBottom: 8 }} />
          <button className="btn" disabled={busy || number.replace(/\D/g, '').length < 8} onClick={() => call(false)}>
            {busy && !sent ? 'Asking Meta…' : sent ? 'Send code again' : 'Send code'}
          </button>
          {sent && (
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>Code from WhatsApp</label>
              <input className="input num" inputMode="numeric" placeholder="123456" value={code}
                onChange={(e) => setCode(e.target.value)} style={{ marginBottom: 8 }} />
              <button className="btn" disabled={busy || !code.trim()} onClick={() => call(true)}>
                {busy ? 'Checking…' : 'Link number'}
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
export default function OnboardingChecklist({ onNavigate, onFocusPicker, onConnectFacebook, onRefreshed }) {
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
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia('(max-width: 820px)').matches;
      let url = a.url;
      // Open with a plain https window.open. An intent:// launch is dispatched at the OS
      // level, which lets the installed Facebook app claim the link and show its home
      // screen; a normal in-browser navigation stays in the browser and loads the exact
      // Page-creation page with the person's existing web login.
      let w = null;
      w = isMobile ? window.open(url, '_blank') : window.open(url, 'meta-setup', 'width=780,height=820');
      // Refresh when the popup closes (desktop) or when the user comes back to this tab (phone).
      const done = async () => { await refresh(); setBusyKey(''); };
      const timer = setInterval(() => {
        if (isMobile ? (w && w.closed) : (!w || w.closed)) { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); done(); }
      }, 1000);
      function onVis() {
        if (document.visibilityState === 'visible') { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); done(); }
      }
      if (isMobile) document.addEventListener('visibilitychange', onVis);
      return;
    }
    const NAVIGABLE_TARGETS = new Set(['creative', 'campaigns']);
    if (a.target === 'signin') onConnectFacebook?.();
    else if (a.target === 'whatsapp') onNavigate?.('connect');
    else if (NAVIGABLE_TARGETS.has(a.target)) onNavigate?.(a.target);
    else onFocusPicker?.();
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
                    {s.optional && s.status !== 'done' && (
                      <span style={{
                        marginLeft: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '.03em',
                        color: 'var(--muted-2)', border: '1px solid var(--line)', borderRadius: 999,
                        padding: '1px 7px', verticalAlign: 'middle'
                      }}>
                        OPTIONAL
                      </span>
                    )}
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
                  {s.inline === 'page_whatsapp' && (
                    <PageWhatsAppLink defaultNumber={s.defaultNumber} onLinked={refresh} />
                  )}
                  {s.action && s.status !== 'done' && isMobileDevice() && /pages\/creat/.test(s.action.url || '') && (
                    <MobilePageCard
                      url={s.action.url}
                      checking={busyKey === s.key}
                      onCheck={async () => { setBusyKey(s.key); await refresh(); setBusyKey(''); }}
                    />
                  )}
                  {s.action && s.status !== 'done' && !(isMobileDevice() && /pages\/creat/.test(s.action.url || '')) && (
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
