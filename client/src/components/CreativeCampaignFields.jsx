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

      {destType === 'lead_form' && (
        forms.length > 0 ? (
          <div className="field" style={{ margin: 0 }}>
            <label>Which form?</label>
            <select className="select" value={destValue} onChange={(e) => setDestValue(e.target.value)}>
              <option value="">Choose a form…</option>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.fields?.length ? ` (${f.fields.join(', ').toLowerCase()})` : ''}</option>)}
            </select>
          </div>
        ) : (
          <div className="notice" style={{ margin: 0 }}>
            No instant forms on your Page yet. Use <strong>Message you on WhatsApp</strong> for now — it needs no form.
          </div>
        )
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
