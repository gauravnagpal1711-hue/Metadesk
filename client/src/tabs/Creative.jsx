import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CreativeCampaignFields from '../components/CreativeCampaignFields.jsx';

/** A creative can go straight into a campaign once it's approved and has a destination. */
export function isCampaignReady(c) {
  return c.status === 'approved' && !!c.destination_type && !!c.destination_value;
}

const SIZES = [
  { v: '1024x1024', l: 'Square 1:1 — feed', ratio: 'square 1:1' },
  { v: '1024x1536', l: 'Portrait 2:3 — feed, story, reels', ratio: 'vertical 2:3' },
  { v: '1536x1024', l: 'Landscape 3:2 — right column', ratio: 'horizontal 3:2' }
];

const VIDEO_ASPECTS = [
  { v: '16:9', l: 'Landscape 16:9 — feed, right column', ratio: 'horizontal 16:9' },
  { v: '9:16', l: 'Portrait 9:16 — story, reels', ratio: 'vertical 9:16' }
];

const DEFAULT_STYLE = 'Bright, premium';

/** A gallery card's provider is a technical id (openai, vertex:veo-3.1-generate-001,
 *  manual, ...) — never show that as-is; say what it means in plain words instead. */
function friendlyProvider(provider) {
  if (!provider) return null;
  if (provider === 'manual') return '📤 Uploaded';
  return '✨ Made with AI';
}

/** Builds a usable prompt with no API call — this runs entirely in your browser. */
function buildPrompt({ brief, ratio, forVideo }) {
  if (forVideo) {
    return [
      `${DEFAULT_STYLE} advertising video, ${ratio} composition.`,
      `Subject: ${brief || 'the product'}.`,
      'Smooth camera motion, studio-quality lighting, clean uncluttered background.',
      'Photorealistic, high detail, colour-graded for social media.'
    ].filter(Boolean).join(' ');
  }
  return [
    `${DEFAULT_STYLE} advertising photograph, ${ratio} composition.`,
    `Subject: ${brief || 'the product'}.`,
    'Studio-quality lighting, shallow depth of field, clean uncluttered background with room at the top for text.',
    'No text, no words, no logos anywhere in the image.',
    'Photorealistic, high detail, colour-graded for social media.'
  ].filter(Boolean).join(' ');
}

const SpeechRecognitionCtor =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function Creative() {
  const [providers, setProviders] = useState({ image: null, copy: null, video: null });
  const [outputKind, setOutputKind] = useState('image');
  const [brief, setBrief] = useState('');
  const [size, setSize] = useState(SIZES[0].v);
  const [videoAspect, setVideoAspect] = useState(VIDEO_ASPECTS[0].v);
  const [attachment, setAttachment] = useState(null); // { dataUrl, mime, name }
  const [recording, setRecording] = useState(false);
  const [copy, setCopy] = useState({ headline: '', primary_text: '', cta: '', image_prompt: '' });
  const [promptModal, setPromptModal] = useState(null); // null closed, else { text }
  const [gallery, setGallery] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const fileRef = useRef(null);
  const attachRef = useRef(null);
  const recognitionRef = useRef(null);
  const pollTimers = useRef({});

  useEffect(() => {
    api.get('/creatives/providers').then(setProviders).catch(() => {});
    api.get('/creatives').then((rows) => {
      setGallery(rows);
      rows.filter((c) => c.video_status === 'pending').forEach((c) => pollVideoStatus(c.id));
    }).catch(() => {});
    return () => {
      Object.values(pollTimers.current).forEach(clearTimeout);
      recognitionRef.current?.stop();
    };
  }, []);

  async function toClipboard(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setError('Your browser blocked the clipboard. Select the text and copy it by hand.');
    }
  }

  function toggleVoice() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    if (!SpeechRecognitionCtor) return;
    const rec = new SpeechRecognitionCtor();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = brief ? `${brief} ` : '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += `${chunk} `;
        else interim += chunk;
      }
      setBrief((finalText + interim).trim());
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function pickAttachment(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAttachment({ dataUrl: reader.result, mime: file.type, name: file.name });
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsDataURL(file);
    if (attachRef.current) attachRef.current.value = '';
  }

  async function writeCopy() {
    setBusy('copy');
    setError('');
    try {
      setCopy(await api.post('/creatives/copy', { brief }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function openPromptModal() {
    const forVideo = outputKind === 'video';
    const ratio = forVideo
      ? VIDEO_ASPECTS.find((a) => a.v === videoAspect)?.ratio || 'horizontal 16:9'
      : SIZES.find((s) => s.v === size)?.ratio || 'square 1:1';
    setPromptModal({ text: copy.image_prompt || buildPrompt({ brief, ratio, forVideo }) });
  }

  async function generate(promptText) {
    setBusy('image');
    setError('');
    try {
      const created = await api.post('/creatives/image', {
        prompt: promptText, size, referenceImage: attachment?.dataUrl,
        headline: copy.headline, primary_text: copy.primary_text, cta: copy.cta
      });
      setGallery((g) => [created, ...g]);
      setPromptModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  /** Veo generation runs for minutes, not seconds — keep checking in the
   *  background until the job leaves 'pending', same idea as WhatsApp's
   *  "load earlier messages" polling. */
  function pollVideoStatus(id) {
    const tick = async () => {
      try {
        const updated = await api.post(`/creatives/${id}/video/poll`);
        setGallery((g) => g.map((c) => (c.id === id ? updated : c)));
        if (updated.video_status === 'pending') {
          pollTimers.current[id] = setTimeout(tick, 8000);
        } else {
          delete pollTimers.current[id];
        }
      } catch {
        pollTimers.current[id] = setTimeout(tick, 8000);
      }
    };
    pollTimers.current[id] = setTimeout(tick, 8000);
  }

  async function generateVideo(promptText) {
    setBusy('video');
    setError('');
    try {
      const created = await api.post('/creatives/video', {
        prompt: promptText, aspectRatio: videoAspect, referenceImage: attachment?.dataUrl,
        headline: copy.headline, primary_text: copy.primary_text, cta: copy.cta
      });
      setGallery((g) => [created, ...g]);
      pollVideoStatus(created.id);
      setPromptModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function submitFromModal() {
    if (outputKind === 'video') generateVideo(promptModal.text);
    else generate(promptModal.text);
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

  function patchCreative(updated) {
    setGallery((g) => g.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function remove(id) {
    await api.del(`/creatives/${id}`);
    setGallery((g) => g.filter((c) => c.id !== id));
  }

  const someReady = gallery.some(isCampaignReady);
  const generating = busy === 'image' || busy === 'video';

  return (
    <>
      {error && <div className="notice bad">{error}</div>}
      {someReady && (
        <div className="notice" style={{ borderLeftColor: 'var(--good)' }}>
          A creative is campaign-ready. Go to the <strong>Campaigns</strong> tab and press <strong>Set campaign</strong> to
          send it to Claude, then <strong>Start campaign</strong> once Claude has built it on Meta.
        </div>
      )}

      <div className="output-toggle" style={{ marginBottom: 16 }}>
        <button type="button" className={`opt ${outputKind === 'image' ? 'on' : ''}`} onClick={() => setOutputKind('image')}>
          🖼️ Image
        </button>
        <button
          type="button"
          className={`opt ${outputKind === 'video' ? 'on' : ''}`}
          onClick={() => setOutputKind('video')}
          disabled={!providers.video}
          title={providers.video ? '' : 'Video generation is not set up yet — ask whoever manages this app to turn it on'}
        >
          🎬 Video
        </button>
      </div>

      <div className="grid2">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2>What are you advertising?</h2>

          <div className="field" style={{ marginBottom: 0 }}>
            <div style={{ position: 'relative' }}>
              <textarea
                id="brief"
                className="textarea"
                style={{ minHeight: 150, paddingRight: 76 }}
                placeholder="Weekend gold jewellery exhibition at our Andheri showroom, 20% off making charges."
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
              <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={`wa-icon-btn ${recording ? 'recording' : ''}`}
                  onClick={toggleVoice}
                  disabled={!SpeechRecognitionCtor}
                  title={SpeechRecognitionCtor ? (recording ? 'Stop listening' : 'Speak your brief') : 'Voice input is not supported in this browser'}
                  aria-label="Speak your brief"
                >
                  🎤
                </button>
                <button
                  type="button"
                  className="wa-icon-btn"
                  onClick={() => attachRef.current?.click()}
                  title="Attach a reference photo"
                  aria-label="Attach a reference photo"
                >
                  📎
                </button>
              </div>
              <input
                ref={attachRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => pickAttachment(e.target.files?.[0])}
              />
            </div>
          </div>

          {recording && <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>🎙️ Listening… speak now, tap the mic again to stop.</div>}

          {attachment && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src={attachment.dataUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
              <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.name}</span>
              <button className="btn ghost sm" onClick={() => setAttachment(null)}>Remove</button>
            </div>
          )}

          <div className="provider-row">
            <span className="dot" style={{ background: providers[outputKind] ? 'var(--good)' : 'var(--muted-2)' }} />
            <span className="name" style={{ textTransform: 'none', fontFamily: 'inherit', fontSize: 13, letterSpacing: 'normal' }}>
              {providers[outputKind]
                ? (outputKind === 'video' ? 'Ready to generate video' : 'Ready to generate images')
                : 'Not set up yet'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {providers.copy && (
              <button className="btn ghost" onClick={writeCopy} disabled={!brief || busy === 'copy'}>
                {busy === 'copy' ? 'Writing…' : 'Write the ad copy for me'}
              </button>
            )}
            <button
              className="btn primary"
              style={{ marginLeft: 'auto' }}
              onClick={openPromptModal}
              disabled={!brief || !providers[outputKind]}
            >
              {outputKind === 'video' ? 'Generate video' : 'Generate image'}
            </button>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Bring the artwork back</h2>
            <ol className="steps" style={{ marginBottom: 14 }}>
              <li>Write a prompt (or copy the one we build for you).</li>
              <li>Make the image with any AI tool you like.</li>
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

      {promptModal && (
        <>
          <div className="scrim" onClick={() => !generating && setPromptModal(null)} />
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>{outputKind === 'video' ? 'Review your video' : 'Review your image'}</h2>
                <button className="close" style={{ marginLeft: 'auto' }} onClick={() => setPromptModal(null)} disabled={generating} aria-label="Close">×</button>
              </div>

              <div className="field" style={{ marginBottom: 10 }}>
                <label htmlFor="final-prompt">Prompt — edit anything before generating</label>
                <textarea
                  id="final-prompt"
                  className="textarea"
                  style={{ minHeight: 150 }}
                  value={promptModal.text}
                  onChange={(e) => setPromptModal((p) => ({ ...p, text: e.target.value }))}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                {outputKind === 'video' ? (
                  <>
                    <label htmlFor="modal-aspect">Aspect ratio</label>
                    <select id="modal-aspect" className="select" value={videoAspect} onChange={(e) => setVideoAspect(e.target.value)}>
                      {VIDEO_ASPECTS.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <label htmlFor="modal-aspect">Placement</label>
                    <select id="modal-aspect" className="select" value={size} onChange={(e) => setSize(e.target.value)}>
                      {SIZES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                    </select>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn ghost" onClick={() => toClipboard(promptModal.text, 'prompt')}>
                  {copied === 'prompt' ? 'Copied ✓' : 'Copy prompt'}
                </button>
                <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={submitFromModal} disabled={generating}>
                  {generating
                    ? (outputKind === 'video' ? 'Starting…' : 'Generating…')
                    : (outputKind === 'video' ? 'Generate video' : 'Generate image')}
                </button>
              </div>
              {outputKind === 'video' && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                  Video takes a few minutes to make — it'll keep generating in the background and show up in the gallery below when ready.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 12px' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Gallery</h2>
        <span className="mono-label">{gallery.length} creatives</span>
      </div>

      {gallery.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          Describe what you're advertising above, then generate or upload your first creative.
        </div>
      ) : (
        <div className="gallery">
          {gallery.map((c) => (
            <div className="shot" key={c.id}>
              {c.image_data && <img src={c.image_data} alt={c.headline || 'Creative'} />}
              {c.kind === 'video' && c.video_status === 'pending' && (
                <div className="video-pending">Making your video… this takes a few minutes.</div>
              )}
              {c.kind === 'video' && c.video_status === 'failed' && (
                <div className="video-pending bad">{c.video_error || 'Video generation failed.'}</div>
              )}
              {c.kind === 'video' && c.video_status === 'ready' && c.video_url && (
                <video src={c.video_url} controls />
              )}
              <div className="body">
                <div className="hl">{c.label || c.headline || 'Untitled'}</div>
                <div className="pt">{c.primary_text || c.prompt}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <span className={`tag ${c.status === 'approved' ? 'good' : 'off'}`}>{c.status}</span>
                  {friendlyProvider(c.provider) && <span className="tag off">{friendlyProvider(c.provider)}</span>}
                  {isCampaignReady(c) && <span className="tag good">✓ campaign-ready</span>}
                </div>
                <CreativeCampaignFields creative={c} onSaved={patchCreative} />
              </div>
              <div className="acts">
                {c.image_data && <a className="btn sm" href={c.image_data} download={`creative-${c.id}.png`}>Download</a>}
                {c.video_url && <a className="btn sm" href={c.video_url} download={`creative-${c.id}.mp4`}>Download</a>}
                {c.status !== 'approved' && <button className="btn sm" onClick={() => approve(c.id)}>Approve</button>}
                <button className="btn sm ghost danger" onClick={() => remove(c.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
