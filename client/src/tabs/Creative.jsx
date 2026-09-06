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

/** Whole days left before an unsaved draft is auto-deleted (0 once it's due). */
function daysLeft(ts) {
  if (!ts) return null;
  return Math.max(0, Math.ceil((new Date(ts).getTime() - Date.now()) / 86400000));
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
  const [attachments, setAttachments] = useState([]); // [{ dataUrl, mime, name }]
  const [recording, setRecording] = useState(false);
  const [promptModal, setPromptModal] = useState(null); // null closed, else { text, phase, reviewId }
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

  function pickAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (attachRef.current) attachRef.current.value = '';
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () =>
        setAttachments((list) => [...list, { dataUrl: reader.result, mime: file.type, name: file.name }]);
      reader.onerror = () => setError(`Could not read ${file.name}.`);
      reader.readAsDataURL(file);
    });
  }

  function removeAttachment(idx) {
    setAttachments((list) => list.filter((_, i) => i !== idx));
  }

  function openPromptModal() {
    const forVideo = outputKind === 'video';
    const ratio = forVideo
      ? VIDEO_ASPECTS.find((a) => a.v === videoAspect)?.ratio || 'horizontal 16:9'
      : SIZES.find((s) => s.v === size)?.ratio || 'square 1:1';
    setPromptModal({ text: buildPrompt({ brief, ratio, forVideo }), phase: 'edit', reviewId: null });
  }

  /** Edit an unsaved draft that's sitting in the gallery: open the prompt with
   *  the text it was made from so it can be tweaked and regenerated (which
   *  replaces this draft). */
  function editGalleryDraft(c) {
    setOutputKind(c.kind === 'video' ? 'video' : 'image');
    setPromptModal({ text: c.prompt || '', phase: 'edit', reviewId: c.id });
  }

  /** "Edit further" replaces the current attempt: drop the old review draft
   *  before the next generate makes a fresh one. */
  async function dropPriorReview() {
    const id = promptModal?.reviewId;
    if (!id) return;
    try {
      await api.del(`/creatives/${id}`);
    } catch {
      /* already gone — fine */
    }
    setGallery((g) => g.filter((c) => c.id !== id));
  }

  async function generate(promptText) {
    setBusy('image');
    setError('');
    try {
      await dropPriorReview();
      const created = await api.post('/creatives/image', {
        prompt: promptText, size, referenceImages: attachments.map((a) => a.dataUrl)
      });
      setGallery((g) => [created, ...g]);
      setPromptModal({ text: promptText, phase: 'review', reviewId: created.id });
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
      await dropPriorReview();
      const created = await api.post('/creatives/video', {
        prompt: promptText, aspectRatio: videoAspect, referenceImages: attachments.map((a) => a.dataUrl)
      });
      setGallery((g) => [created, ...g]);
      pollVideoStatus(created.id);
      setPromptModal({ text: promptText, phase: 'review', reviewId: created.id });
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

  async function upload(fileList) {
    const files = Array.from(fileList || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    setBusy('upload');
    setError('');
    try {
      for (const file of files) {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
          r.readAsDataURL(file);
        });
        const created = await api.post('/creatives/upload', { imageData: dataUrl });
        setGallery((g) => [created, ...g]);
      }
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

  /** Confirm an unsaved 'review' draft — it stops expiring and joins the gallery
   *  for good (still needs Approve before it can go on a campaign). */
  async function keepDraft(id) {
    setBusy('keep');
    setError('');
    try {
      const updated = await api.post(`/creatives/${id}/keep`);
      setGallery((g) => g.map((c) => (c.id === id ? updated : c)));
      setPromptModal((p) => (p && p.reviewId === id ? null : p));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function remove(id) {
    await api.del(`/creatives/${id}`);
    setGallery((g) => g.filter((c) => c.id !== id));
    setPromptModal((p) => (p && p.reviewId === id ? null : p));
  }

  const someReady = gallery.some(isCampaignReady);
  const generating = busy === 'image' || busy === 'video';
  const reviewCreative = promptModal?.reviewId
    ? gallery.find((c) => c.id === promptModal.reviewId)
    : null;

  /** Multi-file reference attachments — shown under the brief and inside the
   *  prompt modal; the same picker feeds both. */
  const attachmentsBlock = (
    <div>
      <button type="button" className="btn ghost sm" onClick={() => attachRef.current?.click()}>
        📎 Attach reference files
      </button>
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ position: 'relative', width: 56 }}>
              {a.mime?.startsWith('image/') ? (
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  title={a.name}
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                />
              ) : (
                <div
                  title={a.name}
                  style={{
                    width: 56, height: 56, borderRadius: 6, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', background: 'var(--line-soft)', fontSize: 10,
                    padding: 4, overflow: 'hidden', textAlign: 'center'
                  }}
                >
                  {a.name.slice(0, 14)}
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${a.name}`}
                style={{
                  position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                  border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 12,
                  lineHeight: '18px', cursor: 'pointer', padding: 0
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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
              multiple
              style={{ display: 'none' }}
              onChange={(e) => pickAttachments(e.target.files)}
            />
          </div>
        </div>

        {recording && <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>🎙️ Listening… speak now, tap the mic again to stop.</div>}

        {attachmentsBlock}

        <div className="provider-row">
          <span className="dot" style={{ background: providers[outputKind] ? 'var(--good)' : 'var(--muted-2)' }} />
          <span className="name" style={{ textTransform: 'none', fontFamily: 'inherit', fontSize: 13, letterSpacing: 'normal' }}>
            {providers[outputKind]
              ? (outputKind === 'video' ? 'Ready to generate video' : 'Ready to generate images')
              : 'Not set up yet'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            style={{ marginLeft: 'auto' }}
            onClick={openPromptModal}
            disabled={!brief || !providers[outputKind]}
          >
            {outputKind === 'video' ? 'Generate video' : 'Generate image'}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
          Headline, primary text and button are added later, per campaign, from the
          creative's <strong>Set up for campaign</strong> button in the gallery below.
        </p>
      </div>

      {promptModal && (
        <>
          <div className="scrim" onClick={() => !generating && busy !== 'keep' && setPromptModal(null)} />
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>
                  {promptModal.phase === 'review'
                    ? (outputKind === 'video' ? 'Your video' : 'Your image')
                    : (outputKind === 'video' ? 'Set up your video' : 'Set up your image')}
                </h2>
                <button
                  className="close"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setPromptModal(null)}
                  disabled={generating || busy === 'keep'}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {promptModal.phase === 'review' ? (
                <>
                  {reviewCreative?.image_data && (
                    <img src={reviewCreative.image_data} alt="" style={{ width: '100%', borderRadius: 8, display: 'block' }} />
                  )}
                  {reviewCreative?.kind === 'video' && reviewCreative.video_status === 'pending' && (
                    <div className="notice">
                      Your video is still generating — this takes a few minutes. It's held as an
                      unsaved draft, so you can close this and come back to Save or Discard it from
                      the gallery once it's ready.
                    </div>
                  )}
                  {reviewCreative?.kind === 'video' && reviewCreative.video_status === 'failed' && (
                    <div className="notice bad">{reviewCreative.video_error || 'Video generation failed.'}</div>
                  )}
                  {reviewCreative?.kind === 'video' && reviewCreative.video_status === 'ready' && reviewCreative.video_url && (
                    <video src={reviewCreative.video_url} controls style={{ width: '100%', borderRadius: 8, display: 'block' }} />
                  )}

                  <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
                    Not saved yet. If you don't Save it, it stays as an unsaved draft in the gallery
                    for 30 days and is then deleted automatically.
                  </p>

                  <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                    <button
                      className="btn ghost"
                      onClick={() => setPromptModal((p) => ({ ...p, phase: 'edit' }))}
                      disabled={generating || busy === 'keep'}
                    >
                      Edit further
                    </button>
                    <button
                      className="btn ghost danger"
                      onClick={() => remove(promptModal.reviewId)}
                      disabled={generating || busy === 'keep'}
                    >
                      Discard
                    </button>
                    <button
                      className="btn primary"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => keepDraft(promptModal.reviewId)}
                      disabled={busy === 'keep'}
                    >
                      {busy === 'keep' ? 'Saving…' : 'Save to gallery'}
                    </button>
                  </div>
                </>
              ) : (
                <>
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

                  <div className="field" style={{ marginBottom: 10 }}>
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

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Reference files (optional)</label>
                    {attachmentsBlock}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                    <button className="btn ghost" onClick={() => toClipboard(promptModal.text, 'prompt')}>
                      {copied === 'prompt' ? 'Copied ✓' : 'Copy prompt'}
                    </button>
                    <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={submitFromModal} disabled={generating}>
                      {generating
                        ? (outputKind === 'video' ? 'Starting…' : 'Generating…')
                        : promptModal.reviewId
                          ? (outputKind === 'video' ? 'Regenerate video' : 'Regenerate image')
                          : (outputKind === 'video' ? 'Generate video' : 'Generate image')}
                    </button>
                  </div>
                  {promptModal.reviewId && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                      Regenerating replaces the current attempt.
                    </div>
                  )}
                  {outputKind === 'video' && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                      Video takes a few minutes to make — it keeps generating in the background.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 12px' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Gallery</h2>
        <span className="mono-label">{gallery.length} creatives</span>
        <button
          className="btn sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => fileRef.current?.click()}
          disabled={busy === 'upload'}
        >
          {busy === 'upload' ? 'Uploading…' : '📤 Upload content'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => upload(e.target.files)}
        />
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
                  {c.status === 'review' ? (
                    <span className="tag warn">Unsaved · {daysLeft(c.review_expires_at) ?? 30}d left</span>
                  ) : (
                    <span className={`tag ${c.status === 'approved' ? 'good' : 'off'}`}>{c.status}</span>
                  )}
                  {friendlyProvider(c.provider) && <span className="tag off">{friendlyProvider(c.provider)}</span>}
                  {isCampaignReady(c) && <span className="tag good">✓ campaign-ready</span>}
                </div>
                {c.status !== 'review' && <CreativeCampaignFields creative={c} onSaved={patchCreative} />}
              </div>
              <div className="acts">
                {c.image_data && <a className="btn sm" href={c.image_data} download={`creative-${c.id}.png`}>Download</a>}
                {c.video_url && <a className="btn sm" href={c.video_url} download={`creative-${c.id}.mp4`}>Download</a>}
                {c.status === 'review' ? (
                  <>
                    <button className="btn sm" onClick={() => keepDraft(c.id)} disabled={busy === 'keep'}>Save to gallery</button>
                    <button className="btn sm ghost" onClick={() => editGalleryDraft(c)}>Edit</button>
                    <button className="btn sm ghost danger" onClick={() => remove(c.id)}>Discard</button>
                  </>
                ) : (
                  <>
                    {c.status !== 'approved' && <button className="btn sm" onClick={() => approve(c.id)}>Approve</button>}
                    <button className="btn sm ghost danger" onClick={() => remove(c.id)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
