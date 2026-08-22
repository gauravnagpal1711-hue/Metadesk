import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const SIZES = [
  { v: '1024x1024', l: 'Square 1:1 — feed', ratio: 'square 1:1' },
  { v: '1024x1536', l: 'Portrait 2:3 — feed, story, reels', ratio: 'vertical 2:3' },
  { v: '1536x1024', l: 'Landscape 3:2 — right column', ratio: 'horizontal 3:2' }
];

/** Builds a usable image prompt with no API call — this runs entirely in your browser. */
function buildPrompt({ brief, offer, audience, size, style, textInImage }) {
  const ratio = SIZES.find((s) => s.v === size)?.ratio || 'square 1:1';
  const lines = [
    `${style} advertising photograph, ${ratio} composition.`,
    `Subject: ${brief || 'the product'}.`,
    audience ? `Made to appeal to ${audience}.` : null,
    'Studio-quality lighting, shallow depth of field, clean uncluttered background with room at the top for text.',
    textInImage && offer
      ? `Include the words "${offer}" as a clean, well-kerned badge in the lower third. Spell it exactly.`
      : 'No text, no words, no logos anywhere in the image.',
    'Photorealistic, high detail, colour-graded for social media.'
  ];
  return lines.filter(Boolean).join(' ');
}

export default function Creative() {
  const [providers, setProviders] = useState({ image: null, copy: null });
  const [brief, setBrief] = useState('');
  const [offer, setOffer] = useState('');
  const [audience, setAudience] = useState('');
  const [language, setLanguage] = useState('English');
  const [style, setStyle] = useState('Bright, premium');
  const [textInImage, setTextInImage] = useState(true);
  const [size, setSize] = useState(SIZES[0].v);
  const [copy, setCopy] = useState({ headline: '', primary_text: '', cta: '', image_prompt: '' });
  const [gallery, setGallery] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    api.get('/creatives/providers').then(setProviders).catch(() => {});
    api.get('/creatives').then(setGallery).catch(() => {});
  }, []);

  const prompt = copy.image_prompt || buildPrompt({ brief, offer, audience, size, style, textInImage });

  async function toClipboard(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setError('Your browser blocked the clipboard. Select the text and copy it by hand.');
    }
  }

  async function writeCopy() {
    setBusy('copy');
    setError('');
    try {
      setCopy(await api.post('/creatives/copy', { brief, offer, audience, language }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function generate() {
    setBusy('image');
    setError('');
    try {
      const created = await api.post('/creatives/image', {
        prompt, size, headline: copy.headline, primary_text: copy.primary_text, cta: copy.cta
      });
      setGallery((g) => [created, ...g]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function upload(file) {
    if (!file) return;
    setBusy('upload');
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Could not read that file.'));
        r.readAsDataURL(file);
      });
      const created = await api.post('/creatives/upload', {
        imageData: dataUrl,
        prompt,
        headline: copy.headline,
        primary_text: copy.primary_text,
        cta: copy.cta
      });
      setGallery((g) => [created, ...g]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function approve(id) {
    const updated = await api.patch(`/creatives/${id}`, { status: 'approved' });
    setGallery((g) => g.map((c) => (c.id === id ? updated : c)));
  }

  async function remove(id) {
    await api.del(`/creatives/${id}`);
    setGallery((g) => g.filter((c) => c.id !== id));
  }

  return (
    <>
      {error && <div className="notice bad">{error}</div>}

      <div className="grid2">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2>Campaign brief</h2>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="brief">Brief — who it's for, the offer, the angle</label>
            <textarea
              id="brief"
              className="textarea"
              placeholder="Weekend gold jewellery exhibition at our Andheri showroom."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="offer">Offer</label>
              <input id="offer" className="input" placeholder="20% off making charges" value={offer} onChange={(e) => setOffer(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="aud">Audience</label>
              <input id="aud" className="input" placeholder="Women 28-45, Mumbai" value={audience} onChange={(e) => setAudience(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="style">Look</label>
              <select id="style" className="select" value={style} onChange={(e) => setStyle(e.target.value)}>
                <option>Bright, premium</option>
                <option>Warm, festive</option>
                <option>Dark, luxury</option>
                <option>Clean, minimal</option>
                <option>Candid, lifestyle</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="sz">Placement</label>
              <select id="sz" className="select" value={size} onChange={(e) => setSize(e.target.value)}>
                {SIZES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </div>
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={textInImage} onChange={(e) => setTextInImage(e.target.checked)} />
            Put the offer text inside the image
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="mono-label">Output</span>
            <div className="output-toggle">
              <button type="button" className="opt on">Image</button>
              <button type="button" className="opt" disabled title="Video generation isn't available yet">
                Video · coming soon
              </button>
            </div>
            <div className="provider-row">
              <span className="dot" style={{ background: providers.image ? 'var(--good)' : 'var(--muted-2)' }} />
              <span className="name">OpenAI API</span>
              <span className="model">GPT-IMAGE-1</span>
            </div>
          </div>

          {providers.copy && (
            <button className="btn primary" onClick={writeCopy} disabled={!brief || busy === 'copy'}>
              {busy === 'copy' ? 'Writing…' : 'Write the ad copy for me'}
            </button>
          )}
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <h2 style={{ margin: 0, flex: 1 }}>Image prompt</h2>
              <span className="tag off">updates as you type</span>
            </div>
            <textarea
              className="textarea"
              style={{ minHeight: 130 }}
              value={prompt}
              onChange={(e) => setCopy({ ...copy, image_prompt: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => toClipboard(prompt, 'prompt')} disabled={!brief}>
                {copied === 'prompt' ? 'Copied ✓' : 'Copy prompt'}
              </button>
              <a className="btn" href="https://chatgpt.com" target="_blank" rel="noreferrer">Open ChatGPT ↗</a>
              {providers.image && (
                <button className="btn" onClick={generate} disabled={busy === 'image' || !brief}>
                  {busy === 'image' ? 'Generating…' : 'Generate here instead'}
                </button>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Bring the artwork back</h2>
            <ol className="steps" style={{ marginBottom: 14 }}>
              <li>Copy the prompt and paste it into ChatGPT.</li>
              <li>Download the image it gives you.</li>
              <li>Upload it here — it joins your gallery with this copy attached.</li>
            </ol>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => upload(e.target.files?.[0])}
              disabled={busy === 'upload'}
            />
            {busy === 'upload' && <div style={{ color: 'var(--muted)', marginTop: 8 }}>Saving…</div>}
          </div>

          <div className="card">
            <h2>Ad copy</h2>
            <div className="field">
              <label htmlFor="hl">Headline</label>
              <input id="hl" className="input" maxLength={40} value={copy.headline} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pt">Primary text</label>
              <textarea id="pt" className="textarea" style={{ minHeight: 70 }} value={copy.primary_text} onChange={(e) => setCopy({ ...copy, primary_text: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="cta">Button</label>
              <input id="cta" className="input" value={copy.cta} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} />
            </div>
            <button
              className="btn"
              onClick={() => toClipboard(`${copy.headline}\n\n${copy.primary_text}\n\n${copy.cta}`, 'copy')}
              disabled={!copy.headline && !copy.primary_text}
            >
              {copied === 'copy' ? 'Copied ✓' : 'Copy for Ads Manager'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 12px' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Gallery</h2>
        <span className="mono-label">{gallery.length} creatives</span>
      </div>

      {gallery.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          Write a brief, copy the prompt into ChatGPT, then upload what comes back.
        </div>
      ) : (
        <div className="gallery">
          {gallery.map((c) => (
            <div className="shot" key={c.id}>
              {c.image_data && <img src={c.image_data} alt={c.headline || 'Creative'} />}
              <div className="body">
                <div className="hl">{c.headline || 'Untitled'}</div>
                <div className="pt">{c.primary_text || c.prompt}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 5 }}>
                  <span className={`tag ${c.status === 'approved' ? 'good' : 'off'}`}>{c.status}</span>
                  <span className="tag off">{c.provider}</span>
                </div>
              </div>
              <div className="acts">
                <a className="btn sm" href={c.image_data} download={`creative-${c.id}.png`}>Download</a>
                <button className="btn sm" onClick={() => approve(c.id)}>Approve</button>
                <button className="btn sm ghost danger" onClick={() => remove(c.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
