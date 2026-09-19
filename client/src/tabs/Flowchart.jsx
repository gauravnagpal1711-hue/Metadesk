import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * One live, non-technical map per tab that actually has a multi-step journey.
 * Pulls real status from the same endpoints the Facebook/WhatsApp/Creative tabs
 * use — nothing here is a static picture, every box reflects what's true right
 * now. Insights, Leads and Campaigns are single-purpose screens with no setup
 * path, so they're deliberately left out.
 */

const STATUS_STYLE = {
  done: { bg: 'var(--good)', ring: 'var(--good)', label: 'DONE', labelBg: 'var(--good-soft)', labelColor: 'var(--good)' },
  current: { bg: '#fff', ring: 'var(--accent)', label: 'DO THIS NEXT', labelBg: 'var(--accent-soft, #eaf2ff)', labelColor: 'var(--accent)' },
  todo: { bg: '#fff', ring: 'var(--line)', label: 'NOT DONE YET', labelBg: '#f4f4f5', labelColor: 'var(--muted-3)' },
  optional: { bg: '#fff', ring: 'var(--line)', label: 'OPTIONAL', labelBg: '#f4f4f5', labelColor: 'var(--muted-2)' },
  branch: { bg: 'var(--warn-soft)', ring: 'var(--warn)', label: 'ONLY IF WHATSAPP', labelBg: 'var(--warn-soft)', labelColor: 'var(--warn)' }
};

function Node({ n, isLast }) {
  const s = STATUS_STYLE[n.status] || STATUS_STYLE.todo;
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' }}>
        <div
          style={{
            width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: s.bg, border: `2px solid ${s.ring}`,
            color: n.status === 'done' ? '#fff' : s.ring, fontSize: 14, fontWeight: 700
          }}
        >
          {n.status === 'done' ? '✓' : n.icon || '•'}
        </div>
        {!isLast && <div style={{ width: 2, flex: '1 1 auto', minHeight: 26, background: 'var(--line)', margin: '2px 0' }} />}
      </div>

      <div style={{ paddingBottom: 26, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>{n.title}</strong>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.03em', padding: '2px 8px', borderRadius: 999,
            background: s.labelBg, color: s.labelColor
          }}>
            {s.label}
          </span>
        </div>
        {n.detail && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{n.detail}</div>}
        {n.status !== 'done' && n.how && (
          <div style={{ fontSize: 12.5, color: 'var(--muted-3)', marginTop: 4, background: '#fafafa', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px' }}>
            {n.how}
          </div>
        )}
      </div>
    </div>
  );
}

function FlowCard({ title, aim, nodes }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <p style={{ color: 'var(--muted)', marginTop: 6, marginBottom: 20, fontSize: 13 }}>
        <strong>Aim: </strong>{aim}
      </p>
      <div>
        {nodes.map((n, i) => <Node key={n.key} n={n} isLast={i === nodes.length - 1} />)}
      </div>
    </div>
  );
}

export default function Flowchart() {
  const [fb, setFb] = useState(null);
  const [wa, setWa] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [onboarding, waStatus] = await Promise.all([
        api.get('/facebook/onboarding'),
        api.get('/whatsapp/status')
      ]);
      setFb(onboarding);
      setWa(waStatus);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="notice bad">{error}</div>;
  if (!fb || !wa) return null;

  const step = (key) => fb.steps.find((s) => s.key === key) || {};
  const status = (key, doneVal = 'done') => (step(key).status === doneVal ? 'done' : 'todo');

  // "current" = the first not-done node in a card, so the eye lands on the
  // one actionable thing without reading every line.
  function withCurrent(nodes) {
    const firstTodo = nodes.findIndex((n) => n.status === 'todo');
    return nodes.map((n, i) => (i === firstTodo ? { ...n, status: 'current' } : n));
  }

  const facebookNodes = withCurrent([
    { key: 'signin', title: 'Connect your Facebook', detail: step('signin').oneLiner, how: step('signin').status !== 'done' ? 'Facebook tab → "Continue with Facebook".' : null, status: status('signin') },
    { key: 'page', title: 'Have a Facebook Page', detail: step('page').oneLiner, how: step('page').status !== 'done' ? 'Facebook tab → "Create a Page on Meta" if you don’t have one.' : null, status: status('page') },
    { key: 'select_page', title: 'Pick your Page in Ads Desk', detail: step('select_page').oneLiner, how: step('select_page').status !== 'done' ? 'Facebook tab → "Choose account & page" box.' : null, status: status('select_page') },
    { key: 'adaccount', title: 'Have an advertising account', detail: step('adaccount').oneLiner, how: step('adaccount').status !== 'done' ? 'Facebook tab → "Open Meta Ads Manager" once.' : null, status: status('adaccount') },
    { key: 'select_adaccount', title: 'Pick your advertising account', detail: step('select_adaccount').oneLiner, how: step('select_adaccount').status !== 'done' ? 'Facebook tab → "Choose account & page" box.' : null, status: status('select_adaccount') },
    { key: 'payment', title: 'Add a way to pay', detail: step('payment').oneLiner, how: step('payment').status !== 'done' ? 'Facebook tab → "Add payment on Meta".' : null, status: status('payment') }
  ]);
  const facebookDone = facebookNodes.every((n) => n.status === 'done');
  facebookNodes.push({
    key: 'ready',
    title: 'Ready to advertise',
    icon: '🏁',
    detail: facebookDone ? 'Facebook is fully connected — go create an ad.' : 'Finishes automatically once everything above is done.',
    status: facebookDone ? 'done' : 'todo'
  });

  const waNumber = step('whatsapp').status === 'done';
  const advertiseNodes = withCurrent([
    { key: 'create', title: 'Create your artwork', detail: 'Generate an image/video with AI, or upload your own.', how: 'Advertise your Brand tab → Generate, or "Upload content".', status: status('creative') },
    { key: 'gallery', title: 'Artwork saved to Gallery', detail: 'Every design you keep lands in the Gallery below the brief box.', status: status('creative') },
    { key: 'setup', title: 'Click "Set up for campaign"', detail: 'Add headline, ad copy, daily budget-relevant details and pick where taps go.', how: 'On the saved artwork’s card → "Set up for campaign".', status: status('campaign_setup') }
  ]);
  advertiseNodes.push({
    key: 'destination',
    title: 'Choose: WhatsApp, Lead Form, or Website',
    icon: '⑂',
    detail: 'This choice decides what happens next.',
    status: status('campaign_setup')
  });
  advertiseNodes.push({
    key: 'wa-branch',
    title: 'If WhatsApp — a number is required',
    detail: waNumber
      ? `Already set — customers will message ${step('whatsapp').oneLiner?.match(/\d+/)?.[0] || 'your number'}.`
      : 'Picking "Message you on WhatsApp" opens a number field right there — it must be filled in before you can save. (You can also set this ahead of time in the WhatsApp tab, but it isn’t required until this point.)',
    status: waNumber ? 'done' : 'branch'
  });
  advertiseNodes.push({
    key: 'saved',
    title: 'Campaign details saved',
    detail: step('campaign_setup').status === 'done' ? 'Saved — this ad is queued in the Campaigns tab.' : 'Finishes once "Set up for campaign" is saved.',
    status: status('campaign_setup')
  });
  advertiseNodes.push({
    key: 'handoff',
    title: 'Next stop: Campaigns tab',
    icon: '→',
    detail: 'Open Campaigns → "Build on Meta" (paused, no spend) — that’s a separate tab with its own screen, not covered here.',
    status: 'optional'
  });

  const cloudOn = !!wa.cloud?.connected;
  const webOn = wa.web?.status === 'connected';
  const waConnected = cloudOn || webOn;
  const waNodes = [
    {
      key: 'choose',
      title: 'Pick a way to connect',
      detail: 'Either scan a QR / enter a phone number (uses your regular WhatsApp), or paste Cloud API credentials from Meta (official Business Platform).',
      how: !waConnected ? 'WhatsApp tab → "Scan QR" / "Enter phone number", or fill in the Cloud API card.' : null,
      status: waConnected ? 'done' : 'current'
    },
    {
      key: 'connected',
      title: 'Number connected',
      detail: webOn
        ? `Connected via QR/phone pairing as ${wa.web?.me || 'your number'}.`
        : cloudOn
          ? 'Connected via Meta’s Cloud API.'
          : 'Not connected yet.',
      status: waConnected ? 'done' : 'todo'
    },
    {
      key: 'sync',
      title: 'Conversations sync to Leads automatically',
      detail: 'Once connected, replies from BOTH an Instant-Form lead and a Click-to-WhatsApp ad lead attach to the matching lead card — no per-source setup needed.',
      status: waConnected ? 'done' : 'todo'
    }
  ];

  return (
    <>
      <div className="notice" style={{ marginBottom: 20 }}>
        Live status, not a fixed picture — every box below re-checks itself every few seconds against what
        you’ve actually done. Green with a check = done. Blue ring = do this one next.
      </div>
      <FlowCard
        title="1 · Facebook — connect your ad account"
        aim="Get Ads Desk fully connected to a real Facebook Page and ad account so it can build ads for you."
        nodes={facebookNodes}
      />
      <FlowCard
        title="2 · Advertise your Brand — create an ad"
        aim="Turn artwork into a ready-to-launch ad, including the WhatsApp-number rule if that's your destination."
        nodes={advertiseNodes}
      />
      <FlowCard
        title="3 · WhatsApp — connect conversations"
        aim="Connect a real WhatsApp number so every lead's conversation — from an Instant Form or from tapping a WhatsApp ad — shows up in your Leads inbox."
        nodes={waNodes}
      />
    </>
  );
}
