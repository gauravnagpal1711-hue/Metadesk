import { useEffect, useState } from 'react';
import { api } from '../api.js';
import WhatsAppNumberSetting from './WhatsAppNumberSetting.jsx';

const DEFAULT_CTA = { whatsapp: 'WHATSAPP_MESSAGE', lead_form: 'SIGN_UP', website: 'LEARN_MORE' };
const CTA_CHOICES = {
  whatsapp: ['WHATSAPP_MESSAGE'],
  lead_form: ['SIGN_UP', 'LEARN_MORE', 'GET_QUOTE', 'SUBSCRIBE', 'APPLY_NOW', 'CONTACT_US', 'BOOK_NOW'],
  website: ['LEARN_MORE', 'SHOP_NOW', 'GET_OFFER', 'BOOK_NOW', 'SIGN_UP', 'CONTACT_US']
};

/** Turns a gallery creative into something a campaign can use — in plain language,
 *  no Meta IDs typed by hand. */
export default function CreativeCampaignFields({ creative, onSaved }) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [label, setLabel] = useState(creative.label || '');
  const [destType, setDestType] = useState(creative.destination_type || 'whatsapp');
  const [destValue, setDestValue] = useState(creative.destination_value || '');
  const [linkUrl, setLinkUrl] = useState(creative.link_url || '');
  const [ctaType, setCtaType] = useState(creative.cta_type || DEFAULT_CTA[creative.destination_type || 'whatsapp']);
  const [waNumber, setWaNumber] = useState(null);
  const [forms, setForms] = useState([]);
  const [newForm, setNewForm] = useState(null); // null = closed; object = builder open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pageInfo, setPageInfo] = useState(null); // { page_id, page_name, leadgen_tos_accepted }
  const [tosNeeded, setTosNeeded] = useState(false); // forced on when Meta rejects for terms
  const [tosBusy, setTosBusy] = useState(false);

  const loadPageInfo = () => api.get('/meta/page').then(setPageInfo).catch(() => {});

  useEffect(() => {
    if (!open) return undefined;
    api.get('/meta/whatsapp-number').then((r) => setWaNumber(r.number || null)).catch(() => {});
    api.get('/meta/lead-forms').then((r) => setForms(Array.isArray(r) ? r : [])).catch(() => {});
    loadPageInfo();
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Open Meta's Lead Ads terms in a popup (same pattern as Facebook login), then
  // re-check acceptance when it closes. Never leaves the app tab.
  function openTosPopup() {
    const pid = pageInfo?.page_id;
    if (!pid) { setError('Connect a Facebook page first (Facebook tab).'); return; }
    setTosBusy(true);
    const w = window.open(
      `https://www.facebook.com/ads/leadgen/tos/?page_id=${pid}`,
      'fb-lead-tos', 'width=680,height=760'
    );
    const timer = setInterval(async () => {
      if (!w || w.closed) {
        clearInterval(timer);
        await loadPageInfo();
        setTosNeeded(false);
        setTosBusy(false);
      }
    }, 1000);
  }

  function pickDest(t) {
    setDestType(t);
    setCtaType(DEFAULT_CTA[t]);
    if (t === 'whatsapp') setDestValue(waNumber || '');
    if (t === 'lead_form') setDestValue('');
    if (t === 'website') setDestValue(linkUrl);
  }

  const effectiveWa = (waNumber || '').replace(/\D/g, '');

  const BLANK_FORM = {
    name: label.trim() ? `${label.trim()} form` : 'New form',
    greeting: 'Get in touch',
    subtext: 'Leave your details and we will contact you shortly.',
    fields: ['name', 'phone'],
    custom_questions: [],
    thank_you_title: 'Thank you!',
    thank_you_body: 'We will be in touch soon.',
    privacy_url: ''
  };
  function addCustomQ() {
    setNewForm((s) => ({ ...s, custom_questions: [...s.custom_questions, { label: '', options: '' }] }));
  }
  function updateCustomQ(i, patch) {
    setNewForm((s) => ({ ...s, custom_questions: s.custom_questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)) }));
  }
  function removeCustomQ(i) {
    setNewForm((s) => ({ ...s, custom_questions: s.custom_questions.filter((_, idx) => idx !== i) }));
  }
  function toggleFormField(f) {
    setNewForm((s) => {
      if (f === 'phone') return s; // phone is always collected
      const has = s.fields.includes(f);
      return { ...s, fields: has ? s.fields.filter((x) => x !== f) : [...s.fields, f] };
    });
  }
  async function createForm() {
    if (!newForm.name.trim()) { setError('Name the form.'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...newForm,
        custom_questions: newForm.custom_questions
          .filter((q) => q.label.trim())
          .map((q) => ({ label: q.label.trim(), options: q.options.split(',').map((o) => o.trim()).filter(Boolean) }))
      };
      const created = await api.post('/meta/lead-forms', payload);
      setForms((fs) => [{ id: created.id, name: created.name, fields: newForm.fields }, ...fs]);
      setDestValue(created.id);
      setNewForm(null);
      setTosNeeded(false);
    } catch (e) {
      setError(e.message);
      if (e.data?.needs_tos) setTosNeeded(true);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      let destination_value = destValue;
      let link_url = linkUrl;
      if (destType === 'whatsapp') destination_value = effectiveWa;
      if (destType === 'website') { destination_value = linkUrl.trim(); link_url = linkUrl.trim(); }
      if (destType === 'lead_form') link_url = forms.find((f) => f.id === destValue)?.name || link_url;
      if (!destination_value) { setError('Choose where leads should go.'); setBusy(false); return; }

      const updated = await api.patch(`/creatives/${creative.id}`, {
        label: label.trim(),
        destination_type: destType,
        destination_value,
        cta_type: ctaType,
        link_url
      });
      onSaved(updated);
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div style={{ display: 'grid', gap: 10 }}>
      {error && <div className="notice bad">{error}</div>}

      <div className="field" style={{ margin: 0 }}>
        <label>Creative name</label>
        <input className="input" placeholder="Weekend gold offer" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label>When someone taps the ad, they…</label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
          {[['whatsapp', 'Message you on WhatsApp'], ['lead_form', 'Fill a quick form'], ['website', 'Go to your website']].map(([v, l]) => (
            <label key={v} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name={`dest-${creative.id}`} checked={destType === v} onChange={() => pickDest(v)} />
              {l}
            </label>
          ))}
        </div>
      </div>

      {destType === 'whatsapp' && (
        <div className="notice" style={{ margin: 0 }}>
          <WhatsAppNumberSetting compact onChange={(n) => setWaNumber(n)} />
        </div>
      )}

      {destType === 'lead_form' && !newForm && (
        <div className="field" style={{ margin: 0 }}>
          <label>Which form?</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="select" value={destValue} onChange={(e) => setDestValue(e.target.value)} style={{ flex: 1 }}>
              <option value="">{forms.length ? 'Choose a form…' : 'No forms yet'}</option>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.fields?.length ? ` (${f.fields.join(', ').toLowerCase()})` : ''}</option>)}
            </select>
            <button className="btn sm" onClick={() => setNewForm(BLANK_FORM)}>+ New form</button>
          </div>
        </div>
      )}

      {destType === 'lead_form' && newForm && (
        <div style={{ display: 'grid', gap: 8, padding: '10px', border: '1px solid var(--line)', borderRadius: 8 }}>
          <div className="mono-label">New instant form</div>
          <div className="field" style={{ margin: 0 }}>
            <label>Form name (only you see this)</label>
            <input className="input" value={newForm.name} onChange={(e) => setNewForm((s) => ({ ...s, name: e.target.value }))} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Greeting headline</label>
            <input className="input" value={newForm.greeting} onChange={(e) => setNewForm((s) => ({ ...s, greeting: e.target.value }))} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Short line under the greeting</label>
            <input className="input" value={newForm.subtext} onChange={(e) => setNewForm((s) => ({ ...s, subtext: e.target.value }))} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Collect</label>
            <div style={{ display: 'flex', gap: 12, fontSize: 13, flexWrap: 'wrap' }}>
              {[['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City']].map(([f, l]) => (
                <label key={f} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: f === 'phone' ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={f === 'phone' || newForm.fields.includes(f)} disabled={f === 'phone'} onChange={() => toggleFormField(f)} />
                  {l}{f === 'phone' ? ' (always)' : ''}
                </label>
              ))}
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Extra questions (optional)</label>
            {newForm.custom_questions.map((cq, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  className="input" placeholder="Question, e.g. Budget?"
                  value={cq.label} onChange={(e) => updateCustomQ(i, { label: e.target.value })}
                  style={{ flex: '0 0 45%' }}
                />
                <input
                  className="input" placeholder="Choices, comma-separated (blank = free text)"
                  value={cq.options} onChange={(e) => updateCustomQ(i, { options: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button className="btn ghost sm danger" onClick={() => removeCustomQ(i)} aria-label="Remove">×</button>
              </div>
            ))}
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={addCustomQ}>+ Add a question</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Thank-you title</label>
              <input className="input" value={newForm.thank_you_title} onChange={(e) => setNewForm((s) => ({ ...s, thank_you_title: e.target.value }))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Thank-you text</label>
              <input className="input" value={newForm.thank_you_body} onChange={(e) => setNewForm((s) => ({ ...s, thank_you_body: e.target.value }))} />
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Privacy policy link (required by Meta)</label>
            <input className="input" placeholder="https://your-site.com/privacy — or leave blank" value={newForm.privacy_url} onChange={(e) => setNewForm((s) => ({ ...s, privacy_url: e.target.value }))} />
          </div>

          {(pageInfo?.leadgen_tos_accepted === false || tosNeeded) && (
            <div className="notice" style={{ margin: 0 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                Meta needs you to accept the Lead Ads terms before a form can be created.
                A window opens — accept for <strong>both your profile and your Page</strong>, then come back.
              </div>
              <button className="btn sm" onClick={openTosPopup} disabled={tosBusy}>
                {tosBusy ? 'Waiting for Meta…' : 'Accept Lead Ads terms'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary sm" onClick={createForm} disabled={busy}>{busy ? 'Creating…' : 'Create form'}</button>
            <button className="btn ghost sm" onClick={() => setNewForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {destType === 'website' && (
        <div className="field" style={{ margin: 0 }}>
          <label>Website link</label>
          <input className="input" placeholder="https://example.com/offer" value={linkUrl} onChange={(e) => { setLinkUrl(e.target.value); setDestValue(e.target.value); }} />
        </div>
      )}

      <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setAdvanced((a) => !a)}>
        {advanced ? '▾' : '▸'} Advanced
      </button>
      {advanced && (
        <div style={{ display: 'grid', gap: 10, padding: '0 0 0 10px', borderLeft: '2px solid var(--line-soft)' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Button text</label>
            <select className="select" value={ctaType} onChange={(e) => setCtaType(e.target.value)}>
              {CTA_CHOICES[destType].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        {creative.destination_type ? 'Edit campaign setup' : 'Set up for campaign'}
      </button>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', inset: 0, zIndex: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>{creative.destination_type ? 'Edit campaign setup' : 'Set up for campaign'}</h2>
                <button className="close" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)} aria-label="Close">×</button>
              </div>

              {creative.image_data && (
                <img src={creative.image_data} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
              )}

              {body}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
