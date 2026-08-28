import { useEffect, useState } from 'react';
import { api } from '../api.js';

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
  const [waManual, setWaManual] = useState('');
  const [forms, setForms] = useState([]);
  const [newForm, setNewForm] = useState(null); // null = closed; object = builder open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    api.get('/meta/whatsapp-number').then((r) => setWaNumber(r.number || null)).catch(() => {});
    api.get('/meta/lead-forms').then((r) => setForms(Array.isArray(r) ? r : [])).catch(() => {});
  }, [open]);

  function pickDest(t) {
    setDestType(t);
    setCtaType(DEFAULT_CTA[t]);
    if (t === 'whatsapp') setDestValue(waManual || waNumber || '');
    if (t === 'lead_form') setDestValue('');
    if (t === 'website') setDestValue(linkUrl);
  }

  const effectiveWa = (waManual || waNumber || '').replace(/\D/g, '');

  const BLANK_FORM = {
    name: label.trim() ? `${label.trim()} form` : 'New form',
    greeting: 'Get in touch',
    subtext: 'Leave your details and we will contact you shortly.',
    fields: ['name', 'phone'],
    thank_you_title: 'Thank you!',
    thank_you_body: 'We will be in touch soon.',
    privacy_url: ''
  };
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
      const created = await api.post('/meta/lead-forms', newForm);
      setForms((fs) => [{ id: created.id, name: created.name, fields: newForm.fields }, ...fs]);
      setDestValue(created.id);
      setNewForm(null);
    } catch (e) {
      setError(e.message);
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

  if (!open) {
    return (
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        {creative.destination_type ? 'Edit campaign setup' : 'Set up for campaign'}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line-soft)', paddingTop: 10, display: 'grid', gap: 10 }}>
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
          Leads message you on WhatsApp{effectiveWa ? <> at <strong>+{effectiveWa}</strong></> : ' — number not detected yet'}.
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
          {destType === 'whatsapp' && (
            <div className="field" style={{ margin: 0 }}>
              <label>Use a different WhatsApp number</label>
              <input className="input" placeholder={waNumber || '919354260517'} value={waManual}
                onChange={(e) => setWaManual(e.target.value.replace(/\D/g, ''))} />
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
