import { useState } from 'react';
import { api } from '../api.js';

const CTA_BY_DESTINATION = {
  whatsapp: ['WHATSAPP_MESSAGE'],
  lead_form: ['SIGN_UP', 'LEARN_MORE', 'GET_QUOTE', 'SUBSCRIBE', 'APPLY_NOW', 'CONTACT_US', 'BOOK_NOW'],
  website: ['LEARN_MORE', 'SHOP_NOW', 'GET_OFFER', 'BOOK_NOW', 'SIGN_UP', 'CONTACT_US']
};

const VALUE_LABEL = {
  whatsapp: 'WhatsApp number (with country code, digits only)',
  lead_form: 'Instant form ID',
  website: 'Landing page URL'
};
const VALUE_PLACEHOLDER = {
  whatsapp: '919354260517',
  lead_form: '1234567890',
  website: 'https://example.com/offer'
};

/** The extra fields a gallery creative needs before it can go into a Meta campaign. */
export default function CreativeCampaignFields({ creative, onSaved }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(creative.label || '');
  const [destType, setDestType] = useState(creative.destination_type || 'whatsapp');
  const [destValue, setDestValue] = useState(creative.destination_value || '');
  const [ctaType, setCtaType] = useState(creative.cta_type || CTA_BY_DESTINATION[creative.destination_type || 'whatsapp'][0]);
  const [linkUrl, setLinkUrl] = useState(creative.link_url || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function pickDest(t) {
    setDestType(t);
    if (!CTA_BY_DESTINATION[t].includes(ctaType)) setCtaType(CTA_BY_DESTINATION[t][0]);
    if (t === 'whatsapp') setDestValue((v) => v.replace(/\D/g, ''));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = {
        label: label.trim(),
        destination_type: destType,
        destination_value: destType === 'whatsapp' ? destValue.replace(/\D/g, '') : destValue.trim(),
        cta_type: ctaType,
        link_url: destType === 'website' ? (linkUrl || destValue).trim() : linkUrl.trim()
      };
      const updated = await api.patch(`/creatives/${creative.id}`, body);
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
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line-soft)', paddingTop: 10, display: 'grid', gap: 8 }}>
      {error && <div className="notice bad">{error}</div>}

      <div className="field" style={{ margin: 0 }}>
        <label>Creative name</label>
        <input className="input" placeholder="Weekend gold offer — WA" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label>Destination</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          {[['whatsapp', 'WhatsApp'], ['lead_form', 'Instant form'], ['website', 'Website']].map(([v, l]) => (
            <label key={v} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name={`dest-${creative.id}`} checked={destType === v} onChange={() => pickDest(v)} />
              {l}
            </label>
          ))}
        </div>
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label>{VALUE_LABEL[destType]}</label>
        <input
          className="input"
          placeholder={VALUE_PLACEHOLDER[destType]}
          value={destValue}
          onChange={(e) => setDestValue(destType === 'whatsapp' ? e.target.value.replace(/\D/g, '') : e.target.value)}
        />
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label>Button</label>
        <select className="select" value={ctaType} onChange={(e) => setCtaType(e.target.value)}>
          {CTA_BY_DESTINATION[destType].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary sm" onClick={save} disabled={busy || !destValue.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
