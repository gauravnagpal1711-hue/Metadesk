import { useCallback, useEffect, useRef, useState } from 'react';
import { api, when } from '../api.js';
import { bucketOf, shortDateTime, toDatetimeLocal } from '../lib/dateBuckets.js';
import MessageTemplates from './MessageTemplates.jsx';

const TASK_KINDS = ['todo', 'call', 'meeting', 'whatsapp', 'email'];

// A small everyday set for the composer — enough to answer a lead without
// pulling in an emoji-picker dependency.
const EMOJIS = [
  '😀', '😊', '😍', '🥰', '😉', '😎', '🤗', '🤝', '🙏', '👍',
  '👋', '👌', '💪', '🙌', '👏', '✅', '❌', '⭐', '✨', '🔥',
  '💯', '❤️', '💖', '🎉', '🎁', '💐', '💄', '💅', '💇', '💆',
  '📅', '⏰', '📍', '📞', '📷', '💰', '💵', '🧾', '📝', '📌',
  '😂', '😅', '😇', '🤔', '😢', '😔', '🙈', '👀', '☺️', '🫶'
];

// The row WhatsApp shows on a long-press, before "more" opens the full picker.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Turn a Meta lead-form field key ("what's_your_budget?") into a label. */
function humanizeFieldKey(k) {
  return String(k).replace(/[_?]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
}

/** The lead's answers to the ad form, question → answer, newest submissions
 *  keep every field they filled in (name/phone included — it's the record). */
function formAnswerRows(fields) {
  if (!fields || typeof fields !== 'object') return [];
  return Object.entries(fields)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => ({ q: humanizeFieldKey(k), a: String(v) }));
}

/** Compact read-only card of the ad-form answers, shown in the conversation. */
function FormAnswersCard({ fields }) {
  const rows = formAnswerRows(fields);
  if (!rows.length) return null;
  return (
    <div className="notice" style={{ margin: '0 0 10px' }}>
      <div className="mono-label" style={{ marginBottom: 6 }}>📋 Ad form answers</div>
      <dl className="kv" style={{ margin: 0 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <dt>{r.q}</dt>
            <dd>{r.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// WhatsApp's own markup, in the order WhatsApp itself resolves it: links first
// (so a URL containing _ or * stays intact), then ```block```, `mono`, *bold*,
// _italic_, ~strike~. A marker only counts when it wraps non-space, exactly as
// on the phone — "2 * 3 * 4" stays plain text.
const WA_TOKEN_RE =
  /(https?:\/\/[^\s]+|www\.[^\s]+|```[\s\S]+?```|`[^`\n]+`|\*(?=\S)[^*\n]*?\S\*|_(?=\S)[^_\n]*?\S_|~(?=\S)[^~\n]*?\S~)/;

/** Trailing sentence punctuation isn't part of the link people meant to send. */
function splitTrailingPunctuation(url) {
  const m = /[.,!?;:)\]}]+$/.exec(url);
  return m ? [url.slice(0, -m[0].length), m[0]] : [url, ''];
}

/** WhatsApp-formatted message text: markup rendered, URLs clickable, newlines kept. */
function richNodes(text, keyBase = 'r') {
  const out = [];
  let rest = String(text ?? '');
  let i = 0;
  while (rest) {
    const m = WA_TOKEN_RE.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('```')) {
      out.push(<code key={key} className="wa-code block">{tok.slice(3, -3)}</code>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={key} className="wa-code">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('*')) {
      out.push(<strong key={key}>{richNodes(tok.slice(1, -1), key)}</strong>);
    } else if (tok.startsWith('_')) {
      out.push(<em key={key}>{richNodes(tok.slice(1, -1), key)}</em>);
    } else if (tok.startsWith('~')) {
      out.push(<s key={key}>{richNodes(tok.slice(1, -1), key)}</s>);
    } else {
      const [url, tail] = splitTrailingPunctuation(tok);
      out.push(
        <a key={key} href={url.startsWith('www.') ? `https://${url}` : url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {url}
        </a>
      );
      if (tail) out.push(tail);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

function RichText({ text }) {
  if (!text) return null;
  return <span className="wa-text">{richNodes(text)}</span>;
}

function MessageMedia({ mime, data }) {
  if (!mime || !data) return null;
  if (mime.startsWith('image/')) return <img src={data} alt="" style={{ maxWidth: '100%', borderRadius: 8, display: 'block', marginBottom: 6 }} />;
  if (mime.startsWith('video/')) return <video src={data} controls style={{ maxWidth: '100%', borderRadius: 8, display: 'block', marginBottom: 6 }} />;
  if (mime.startsWith('audio/')) return <audio src={data} controls style={{ width: '100%', marginBottom: 6 }} />;
  return (
    <a href={data} download className="btn sm" style={{ display: 'inline-block', marginBottom: 6 }}>
      Download file
    </a>
  );
}

function Ticks({ status }) {
  if (status === 'read') return <span className="wa-tick read">✓✓</span>;
  if (status === 'delivered') return <span className="wa-tick">✓✓</span>;
  return <span className="wa-tick">✓</span>;
}

/** The little emoji pill WhatsApp overlaps on a bubble's corner once someone
 *  reacts. Shows both sides' reactions when they picked different emoji. */
function ReactionBadge({ meta }) {
  const mine = meta?.reaction_mine;
  const theirs = meta?.reaction_theirs;
  if (!mine && !theirs) return null;
  return (
    <span className="wa-reaction">
      {theirs}{mine && mine !== theirs ? mine : ''}
    </span>
  );
}

// WhatsApp only honours "delete for everyone" on your own messages, and only
// for about two and a half days — and never for anything sent through the Cloud
// API, which has no delete endpoint. Outside that, only "delete for me" is real.
const REVOKE_WINDOW_MS = 2.5 * 24 * 60 * 60 * 1000;

function canRevoke(m) {
  if (m.direction !== 'out' || !m.wa_message_id) return false;
  if (String(m.wa_message_id).startsWith('wamid.')) return false;
  return Date.now() - new Date(m.created_at).getTime() < REVOKE_WINDOW_MS;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(a.getFullYear() !== d.getFullYear() ? { year: 'numeric' } : {}) });
}

/** The click-to-WhatsApp ad card WhatsApp shows above the first message. */
function AdCard({ ad }) {
  if (!ad) return null;
  return (
    <div className="wa-ad-card">
      {ad.thumbnail_url && <img src={ad.thumbnail_url} alt="" />}
      <div className="wa-ad-body">
        <div className="wa-ad-tag">From ad</div>
        {ad.title && <div className="wa-ad-title">{ad.title}</div>}
        {ad.body && <div className="wa-ad-text">{ad.body}</div>}
        {ad.source_url && (
          <a href={ad.source_url} target="_blank" rel="noreferrer" className="wa-ad-link">{ad.source_url}</a>
        )}
      </div>
    </div>
  );
}

export default function LeadDrawer({ leadId, stages, onClose }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('chat');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]); // [{ dataUrl, mime, name }]
  const [suggestions, setSuggestions] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [customRows, setCustomRows] = useState([]);
  const [pendingStage, setPendingStage] = useState(null); // { stageId, needsAppointment, needsFollowup, needsLostReason, ... }
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [taskDraft, setTaskDraft] = useState({ kind: 'todo', title: '', due_at: '' });
  const [menuFor, setMenuFor] = useState(null);   // message id whose ⌄ menu is open
  const [deletingId, setDeletingId] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null); // message being quoted, or null
  const [reactingId, setReactingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [forwardTarget, setForwardTarget] = useState(null); // message being forwarded, or null
  const [forwardQuery, setForwardQuery] = useState('');
  const [forwardResults, setForwardResults] = useState([]);
  const [forwardSearching, setForwardSearching] = useState(false);
  const [forwardingTo, setForwardingTo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const composerRef = useRef(null);
  const recorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  const load = useCallback(async () => {
    setData(await api.get(`/leads/${leadId}`));
  }, [leadId]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // Reply suggestions belong to one lead's thread — drop them when switching leads.
  useEffect(() => { setSuggestions([]); }, [leadId]);

  // Seeing the chat = reading it. Clear the unread badge; the board/table
  // refresh on drawer close (Leads.jsx onClose -> reloadAll).
  useEffect(() => {
    if (data && view === 'chat' && data.lead?.unread_count > 0) {
      api.post(`/leads/${leadId}/read`).catch(() => {});
    }
  }, [data, view, leadId]);

  useEffect(() => {
    if (view === 'chat') endRef.current?.scrollIntoView({ block: 'end' });
  }, [data, view]);

  // Re-seed the custom-fields editor only when a different lead's data first
  // arrives, not on every reload — otherwise an in-progress edit would be
  // wiped out by the reload that follows saving another field.
  useEffect(() => {
    const cf = data?.lead?.custom_fields || {};
    setCustomRows(Object.entries(cf).map(([key, value]) => ({ key, value: value == null ? '' : String(value) })));
  }, [data?.lead?.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Escape closes whatever is on top: the forward modal, a message menu,
      // the emoji panel, then the drawer.
      if (forwardTarget) setForwardTarget(null);
      else if (menuFor !== null) setMenuFor(null);
      else if (showEmoji) setShowEmoji(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, menuFor, showEmoji, forwardTarget]);

  // Any click outside a bubble menu / the emoji panel dismisses them.
  useEffect(() => {
    if (menuFor === null && !showEmoji) return undefined;
    const onDown = (e) => {
      if (e.target.closest?.('.wa-msg-menu, .wa-msg-caret, .wa-emoji-panel, .wa-emoji-btn')) return;
      setMenuFor(null);
      setShowEmoji(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuFor, showEmoji]);

  // Grow the composer with the text, the way the phone does, up to ~6 lines.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft, view]);

  // A one-line success confirmation (e.g. "Forwarded") that clears itself.
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  // Quoting/forwarding/recording belong to one lead's chat — reset them when
  // switching leads. The drawer doesn't remount between leads (same leadId
  // prop, new value), so a recording left running has to be torn down by hand.
  useEffect(() => {
    setReplyTarget(null);
    setForwardTarget(null);
    setRecording(false);
    return () => {
      clearInterval(recordTimerRef.current);
      const rec = recorderRef.current;
      if (rec) {
        try { rec.stop(); } catch { /* already stopped */ }
        rec.stream?.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
      }
    };
  }, [leadId]);

  if (!data) return null;
  const { lead, messages, remarks, activity, tasks = [] } = data;
  const stage = stages.find((s) => s.id === lead.stage_id);
  const openTasks = tasks.filter((t) => !t.done);
  const daysInStage = lead.stage_changed_at
    ? Math.max(0, Math.round((Date.now() - new Date(lead.stage_changed_at).getTime()) / 86400000))
    : null;

  const historyRows = [
    {
      id: 'created',
      ts: lead.created_at,
      dateLabel: new Date(lead.created_at).toLocaleString(),
      update: 'Lead created',
      user: lead.source === 'manual' ? 'You' : lead.source === 'whatsapp' ? 'WhatsApp' : lead.source === 'meta' ? 'Meta sync' : 'System'
    },
    ...remarks.map((r) => ({
      id: `r${r.id}`,
      ts: r.created_at,
      dateLabel: r.author === 'upload' ? 'UPLOADED' : new Date(r.created_at).toLocaleString(),
      update: `Remark added: "${r.body}"`,
      user: r.author === 'upload' ? 'Upload' : 'You'
    })),
    ...activity.map((a) => ({
      id: `a${a.id}`,
      ts: a.created_at,
      dateLabel: new Date(a.created_at).toLocaleString(),
      update: a.detail,
      user: a.author === 'upload' ? 'Upload' : 'You'
    }))
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  async function send() {
    if (!draft.trim() && attachments.length === 0) return;
    setSending(true);
    setError('');
    const replyToId = replyTarget?.id;
    try {
      if (attachments.length === 0) {
        await api.post(`/leads/${leadId}/messages`, { body: draft.trim() || undefined, replyToId });
      } else {
        // One WhatsApp message per file; the typed text — and the quote, if
        // any — rides along on the first one.
        for (let i = 0; i < attachments.length; i++) {
          const a = attachments[i];
          await api.post(`/leads/${leadId}/messages`, {
            body: i === 0 && draft.trim() ? draft.trim() : undefined,
            mediaData: a.dataUrl,
            mediaMime: a.mime,
            fileName: a.name,
            replyToId: i === 0 ? replyToId : undefined
          });
        }
      }
      setDraft('');
      setAttachments([]);
      setSuggestions([]);
      setReplyTarget(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function startReply(m) {
    setMenuFor(null);
    setReplyTarget(m);
    composerRef.current?.focus();
  }

  /** Tap-to-react — sending the same emoji again removes it, like the phone. */
  async function reactToMessage(m, emoji) {
    setMenuFor(null);
    const next = m.meta?.reaction_mine === emoji ? '' : emoji;
    setReactingId(m.id);
    setError('');
    try {
      await api.post(`/leads/${leadId}/messages/${m.id}/react`, { emoji: next });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setReactingId(null);
    }
  }

  async function toggleStar(m) {
    setMenuFor(null);
    try {
      await api.patch(`/leads/${leadId}/messages/${m.id}/star`, { starred: !m.starred });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  function openForward(m) {
    setMenuFor(null);
    setForwardTarget(m);
    setForwardQuery('');
    setForwardResults([]);
  }

  async function searchForwardTargets(text) {
    setForwardQuery(text);
    if (!text.trim()) { setForwardResults([]); return; }
    setForwardSearching(true);
    try {
      const r = await api.get(`/leads/list?q=${encodeURIComponent(text.trim())}&pageSize=8`);
      setForwardResults((r.rows || []).filter((l) => l.id !== lead.id));
    } catch {
      setForwardResults([]);
    } finally {
      setForwardSearching(false);
    }
  }

  async function forwardTo(targetLead) {
    if (!forwardTarget) return;
    setForwardingTo(targetLead.id);
    setError('');
    try {
      await api.post(`/leads/${targetLead.id}/messages`, {
        body: forwardTarget.body || undefined,
        mediaData: forwardTarget.media_data || undefined,
        mediaMime: forwardTarget.media_mime || undefined
      });
      setNotice(`Forwarded to ${targetLead.full_name || targetLead.phone}.`);
      setForwardTarget(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setForwardingTo(null);
    }
  }

  /** Hold-to-record a voice note, sent as WhatsApp's own "voice message"
   *  (ptt) once released — same as tapping the phone's mic. */
  async function startRecording() {
    if (recording) return;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']
        .find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recordChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) recordChunksRef.current.push(e.data); };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch {
      setError('Could not access the microphone — check your browser permissions.');
    }
  }

  function stopRecording(send_) {
    const rec = recorderRef.current;
    if (!rec) return;
    clearInterval(recordTimerRef.current);
    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      setRecording(false);
      if (!send_ || recordChunksRef.current.length === 0) return;
      const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onload = async () => {
        setSending(true);
        setError('');
        try {
          await api.post(`/leads/${leadId}/messages`, {
            mediaData: reader.result,
            mediaMime: rec.mimeType || 'audio/webm',
            fileName: 'voice-message',
            voice: true,
            replyToId: replyTarget?.id
          });
          setReplyTarget(null);
          await load();
        } catch (e) {
          setError(e.message);
        } finally {
          setSending(false);
        }
      };
      reader.readAsDataURL(blob);
    };
    rec.stop();
  }

  /** Drop a message: from Ads Desk only, or from both phones via WhatsApp. */
  async function deleteMessage(m, forEveryone) {
    setMenuFor(null);
    if (forEveryone && !window.confirm('Delete this message for everyone? It disappears from the lead’s phone too.')) return;
    setDeletingId(m.id);
    setError('');
    try {
      await api.del(`/leads/${leadId}/messages/${m.id}${forEveryone ? '?revoke=1' : ''}`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function copyMessage(m) {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(m.body || '');
    } catch {
      setError('Could not copy — your browser blocked clipboard access.');
    }
  }

  /** Insert text where the cursor is, like typing it, and keep focus there. */
  function insertInDraft(text) {
    const el = composerRef.current;
    if (!el) { setDraft((d) => d + text); return; }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  // Enter sends, Shift+Enter (or Ctrl/Alt+Enter) starts a new line — phone behaviour.
  function onComposerKey(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    send();
  }

  async function suggestAI() {
    setSuggesting(true);
    setError('');
    try {
      const r = await api.post(`/leads/${leadId}/suggest-replies`);
      setSuggestions(Array.isArray(r.suggestions) ? r.suggestions : []);
      if (!r.suggestions?.length) setError('No suggestions came back — try again.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSuggesting(false);
    }
  }

  async function loadEarlier(mode) {
    setLoadingEarlier(true);
    setError('');
    const before = data?.messages?.length || 0;
    try {
      await api.post(`/leads/${leadId}/wa/load-earlier${mode === 'back' ? '?mode=back' : ''}`);
      // The phone sends the messages back asynchronously; re-fetch a few times.
      let after = before;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const fresh = await api.get(`/leads/${leadId}`);
        setData(fresh);
        after = fresh.messages.length;
        if (after > before) break;
      }
      if (after === before) {
        setError('Nothing more came back from the phone for this chat. Try "Load older" for messages further back.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingEarlier(false);
    }
  }

  function pickFile(fileList) {
    const files = Array.from(fileList || []);
    if (fileRef.current) fileRef.current.value = '';
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () =>
        setAttachments((list) => [...list, { dataUrl: reader.result, mime: file.type, name: file.name }]);
      reader.onerror = () => setError(`Could not read ${file.name}.`);
      reader.readAsDataURL(file);
    });
  }

  async function addNote() {
    if (!note.trim()) return;
    await api.post(`/leads/${leadId}/remarks`, { body: note.trim() });
    setNote('');
    await load();
  }

  async function moveTo(stageId) {
    const target = stages.find((s) => s.id === stageId);
    const needsAppointment = !!target?.requires_appointment_date && !lead.appointment_date;
    const needsFollowup = !!target?.requires_followup_date && !lead.followup_date;
    const needsLostReason = !!target?.is_lost && !lead.lost_reason;
    if (needsAppointment || needsFollowup || needsLostReason) {
      setPendingStage({ stageId, needsAppointment, needsFollowup, needsLostReason, appointmentDate: '', followupDate: '', lostReason: '' });
      return;
    }
    setError('');
    try {
      await api.patch(`/leads/${leadId}/move`, { stage_id: stageId });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function confirmPendingMove() {
    const { stageId, needsAppointment, needsFollowup, needsLostReason, appointmentDate, followupDate, lostReason } = pendingStage || {};
    if (needsAppointment && !appointmentDate) return;
    if (needsFollowup && !followupDate) return;
    if (needsLostReason && !lostReason.trim()) return;
    setError('');
    try {
      const body = { stage_id: stageId };
      if (needsAppointment) body.appointment_date = new Date(appointmentDate).toISOString();
      if (needsFollowup) body.followup_date = new Date(followupDate).toISOString();
      if (needsLostReason) body.lost_reason = lostReason.trim();
      await api.patch(`/leads/${leadId}/move`, body);
      setPendingStage(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function logContact() {
    setError('');
    try {
      await api.post(`/leads/${leadId}/contacted`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveTags(tags) {
    await api.patch(`/leads/${leadId}`, { tags });
    await load();
  }
  function addTag() {
    const t = tagDraft.trim();
    if (!t || (lead.tags || []).includes(t)) { setTagDraft(''); return; }
    saveTags([...(lead.tags || []), t]);
    setTagDraft('');
  }

  async function addTask() {
    if (!taskDraft.title.trim()) return;
    try {
      await api.post(`/leads/${leadId}/tasks`, {
        kind: taskDraft.kind,
        title: taskDraft.title.trim(),
        due_at: taskDraft.due_at ? new Date(taskDraft.due_at).toISOString() : null
      });
      setTaskDraft({ kind: 'todo', title: '', due_at: '' });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function toggleTask(task) {
    try {
      await api.patch(`/leads/tasks/${task.id}`, { done: !task.done });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function deleteTask(task) {
    try {
      await api.del(`/leads/tasks/${task.id}`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveField(key, value) {
    if (value === (lead[key] ?? '')) return;
    await api.patch(`/leads/${leadId}`, { [key]: value });
    await load();
  }

  async function saveAppointmentDate(value) {
    const iso = value ? new Date(value).toISOString() : null;
    await api.patch(`/leads/${leadId}`, { appointment_date: iso });
    await load();
  }

  async function saveFollowupDate(value) {
    const iso = value ? new Date(value).toISOString() : null;
    await api.patch(`/leads/${leadId}`, { followup_date: iso });
    await load();
  }

  function copyPhone() {
    navigator.clipboard?.writeText(lead.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 1200);
  }

  async function saveCustomFields(rows) {
    const obj = {};
    for (const r of rows) {
      if (r.key.trim()) obj[r.key.trim()] = r.value;
    }
    await api.patch(`/leads/${leadId}`, { custom_fields: obj });
    await load();
  }

  function updateCustomRow(i, field, value) {
    setCustomRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function removeCustomRow(i) {
    setCustomRows((rows) => {
      const next = rows.filter((_, idx) => idx !== i);
      saveCustomFields(next);
      return next;
    });
  }

  function addCustomRow() {
    setCustomRows((rows) => [...rows, { key: '', value: '' }]);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={lead.full_name || 'Lead'}>
        <div className="drawer-head">
          <div className="top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{lead.full_name || 'Unnamed lead'}</h2>
              <div className="meta phone-row">
                {lead.phone && (
                  <button className="copy-btn" onClick={copyPhone} title="Copy phone number" aria-label="Copy phone number">
                    {copiedPhone ? '✓' : '📋'}
                  </button>
                )}
                {lead.phone || 'No phone'}
              </div>
            </div>
            <button className="close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="stage-chips">
            <span className="mono-label">Stage</span>
            {stages.map((s) => (
              <button
                key={s.id}
                className={`stage-chip ${lead.stage_id === s.id ? 'on' : ''}`}
                onClick={() => moveTo(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          {pendingStage && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {pendingStage.needsAppointment && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono-label" style={{ flex: '0 0 auto' }}>Appointment date</span>
                  <input
                    type="datetime-local"
                    className="input"
                    value={pendingStage.appointmentDate}
                    onChange={(e) => setPendingStage((p) => ({ ...p, appointmentDate: e.target.value }))}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                </div>
              )}
              {pendingStage.needsFollowup && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono-label" style={{ flex: '0 0 auto' }}>Followup date</span>
                  <input
                    type="datetime-local"
                    className="input"
                    value={pendingStage.followupDate}
                    onChange={(e) => setPendingStage((p) => ({ ...p, followupDate: e.target.value }))}
                    style={{ flex: 1 }}
                    autoFocus={!pendingStage.needsAppointment}
                  />
                </div>
              )}
              {pendingStage.needsLostReason && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono-label" style={{ flex: '0 0 auto' }}>Lost reason</span>
                  <input
                    className="input"
                    placeholder="Why was this lost?"
                    value={pendingStage.lostReason}
                    onChange={(e) => setPendingStage((p) => ({ ...p, lostReason: e.target.value }))}
                    style={{ flex: 1 }}
                    autoFocus={!pendingStage.needsAppointment && !pendingStage.needsFollowup}
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="btn primary sm"
                  onClick={confirmPendingMove}
                  disabled={
                    (pendingStage.needsAppointment && !pendingStage.appointmentDate) ||
                    (pendingStage.needsFollowup && !pendingStage.followupDate) ||
                    (pendingStage.needsLostReason && !pendingStage.lostReason.trim())
                  }
                >
                  Confirm
                </button>
                <button className="btn ghost sm" onClick={() => setPendingStage(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="drawer-info">
          <div className="cell">
            <div className="k">Source</div>
            <div className="v">
              {lead.campaign_name || lead.source || '—'}
              {lead.from_adsdesk && <span className="tag good" style={{ marginLeft: 5 }}>Ads Desk</span>}
            </div>
          </div>
          <div className="cell">
            <div className="k">In stage</div>
            <div className="v">{daysInStage == null ? '—' : `${daysInStage}d`}</div>
          </div>
          <div className="cell">
            <div className="k">Last contacted</div>
            <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {lead.last_contacted_at ? when(lead.last_contacted_at) : 'never'}
              <button className="btn ghost sm" onClick={logContact} title="Mark contacted now">Log</button>
            </div>
          </div>
        </div>

        <nav className="drawer-tabs">
          {[
            ['chat', `Conversation${messages.length ? ` (${messages.length})` : ''}`],
            ['notes', `Remarks${remarks.length ? ` (${remarks.length})` : ''}`],
            ['tasks', `Tasks${openTasks.length ? ` (${openTasks.length})` : ''}`],
            ['history', `History${historyRows.length ? ` (${historyRows.length})` : ''}`],
            ['details', 'Details']
          ].map(([id, label]) => (
            <button key={id} className={`drawer-tab ${view === id ? 'on' : ''}`} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className={`drawer-body ${view === 'chat' ? 'wa-chat' : ''}`}>
          {error && <div className="notice bad">{error}</div>}
          {notice && <div className="notice good">{notice}</div>}

          {view === 'chat' && (
            <>
              {lead.ad_referral && <AdCard ad={lead.ad_referral} />}
              <FormAnswersCard fields={lead.fields} />

              <div style={{ textAlign: 'center', margin: '2px 0 8px', display: 'flex', gap: 6, justifyContent: 'center' }}>
                <button className="btn ghost sm" onClick={() => loadEarlier()} disabled={loadingEarlier}>
                  {loadingEarlier ? 'Syncing from phone…' : 'Sync this chat'}
                </button>
                <button className="btn ghost sm" onClick={() => loadEarlier('back')} disabled={loadingEarlier}>
                  Load older
                </button>
              </div>

              {messages.length === 0 ? (
                <div className="empty"><h3>No messages yet</h3>Send the first WhatsApp message below.</div>
              ) : (
                messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const showDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                  return (
                    <div key={m.id}>
                      {showDay && <div className="wa-day"><span>{dayLabel(m.created_at)}</span></div>}
                      <div className={`wa-bubble ${m.direction === 'out' ? 'out' : 'in'} ${deletingId === m.id ? 'deleting' : ''} ${reactingId === m.id ? 'reacting' : ''} ${(m.meta?.reaction_mine || m.meta?.reaction_theirs) ? 'has-reaction' : ''}`}>
                        <button
                          className="wa-msg-caret"
                          onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                          aria-label="Message options"
                          title="Message options"
                        >
                          ⌄
                        </button>
                        {menuFor === m.id && (
                          <div className="wa-msg-menu">
                            <div className="wa-quick-react">
                              {QUICK_REACTIONS.map((e) => (
                                <button
                                  key={e}
                                  className={m.meta?.reaction_mine === e ? 'on' : ''}
                                  onClick={() => reactToMessage(m, e)}
                                  aria-label={`React ${e}`}
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                            <button onClick={() => startReply(m)}>Reply</button>
                            <button onClick={() => openForward(m)}>Forward</button>
                            <button onClick={() => toggleStar(m)}>{m.starred ? 'Unstar' : 'Star'}</button>
                            {m.body && <button onClick={() => copyMessage(m)}>Copy text</button>}
                            <button onClick={() => deleteMessage(m, false)}>Delete for me</button>
                            {canRevoke(m) && (
                              <button className="danger" onClick={() => deleteMessage(m, true)}>Delete for everyone</button>
                            )}
                          </div>
                        )}
                        {m.meta?.reply_to && (
                          <div className="wa-quote">{m.meta.reply_to.body || '(message)'}</div>
                        )}
                        {m.meta?.ad_reply && <AdCard ad={m.meta.ad_reply} />}
                        <MessageMedia mime={m.media_mime} data={m.media_data} />
                        {m.body && <RichText text={m.body} />}
                        {m.meta?.buttons?.length > 0 && (
                          <div className="wa-btns">
                            {m.meta.buttons.map((b, bi) => (
                              b.url
                                ? <a key={bi} href={b.url} target="_blank" rel="noreferrer" className="wa-btn">{b.text || 'Open'}</a>
                                : <span key={bi} className="wa-btn">{b.text}</span>
                            ))}
                          </div>
                        )}
                        <span className="wa-meta">
                          {m.starred && <span title="Starred">⭐</span>}
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {m.direction === 'out' && <Ticks status={m.status} />}
                        </span>
                        <ReactionBadge meta={m.meta} />
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={endRef} />
            </>
          )}

          {view === 'notes' && (
            <>
              <div className="field">
                <textarea
                  className="textarea"
                  placeholder="Quoted ₹45,000. Wants to visit showroom Saturday."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className="btn primary" onClick={addNote} disabled={!note.trim()}>Add remark</button>
              </div>
              {remarks.map((r) => (
                <div className="remark" key={r.id}>
                  <div>{r.body}</div>
                  <div className="t">{r.author === 'upload' ? 'UPLOADED' : new Date(r.created_at).toLocaleString()}</div>
                </div>
              ))}
            </>
          )}

          {view === 'tasks' && (
            <>
              <div className="field" style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="select"
                    value={taskDraft.kind}
                    onChange={(e) => setTaskDraft((t) => ({ ...t, kind: e.target.value }))}
                    style={{ flex: '0 0 110px' }}
                  >
                    {TASK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input
                    className="input"
                    placeholder="Call back about the quote"
                    value={taskDraft.title}
                    onChange={(e) => setTaskDraft((t) => ({ ...t, title: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && addTask()}
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="datetime-local"
                    className="input"
                    value={taskDraft.due_at}
                    onChange={(e) => setTaskDraft((t) => ({ ...t, due_at: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button className="btn primary" onClick={addTask} disabled={!taskDraft.title.trim()}>Add task</button>
                </div>
              </div>
              {tasks.length === 0 && <div className="empty"><h3>No tasks</h3>Add a call, meeting or to-do above.</div>}
              {tasks.map((t) => (
                <div className="remark" key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <input type="checkbox" checked={!!t.done} onChange={() => toggleTask(t)} style={{ marginTop: 3 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--muted-2)' : 'inherit' }}>
                      <span className="tag off" style={{ marginRight: 6 }}>{t.kind}</span>{t.title}
                    </div>
                    <div className="t">
                      {t.due_at ? <span className={`date-chip ${t.done ? 'none' : bucketOf(t.due_at)}`}>{shortDateTime(t.due_at)}</span> : 'no due date'}
                    </div>
                  </div>
                  <button className="btn ghost sm danger" onClick={() => deleteTask(t)} aria-label="Delete task">×</button>
                </div>
              ))}
            </>
          )}

          {view === 'history' && (
            historyRows.length === 0 ? (
              <div className="empty"><h3>No history yet</h3>Remarks and stage changes show up here.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Update</th>
                    <th>User</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((h) => (
                    <tr key={h.id}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>{h.dateLabel}</td>
                      <td>{h.update}</td>
                      <td>{h.user}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {view === 'details' && (
            <>
              {[
                ['full_name', 'Name'],
                ['phone', 'Phone'],
                ['email', 'Email'],
                ['city', 'City'],
                ['value', 'Deal value']
              ].map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={`f-${key}`}>{label}</label>
                  <input
                    id={`f-${key}`}
                    className="input"
                    defaultValue={lead[key] ?? ''}
                    onBlur={(e) => saveField(key, e.target.value)}
                  />
                </div>
              ))}

              <div className="field">
                <label htmlFor="f-appointment_date">Appointment date</label>
                <input
                  id="f-appointment_date"
                  type="datetime-local"
                  className="input"
                  defaultValue={toDatetimeLocal(lead.appointment_date)}
                  onBlur={(e) => saveAppointmentDate(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="f-followup_date">Followup date</label>
                <input
                  id="f-followup_date"
                  type="datetime-local"
                  className="input"
                  defaultValue={toDatetimeLocal(lead.followup_date)}
                  onBlur={(e) => saveFollowupDate(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Tags</label>
                <div className="lead-tags" style={{ marginBottom: 6 }}>
                  {(lead.tags || []).map((t) => (
                    <span key={t} className="tag off">
                      {t}
                      <button
                        onClick={() => saveTags((lead.tags || []).filter((x) => x !== t))}
                        style={{ marginLeft: 4, border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit' }}
                        aria-label={`Remove ${t}`}
                      >×</button>
                    </span>
                  ))}
                  {(lead.tags || []).length === 0 && <span style={{ color: 'var(--muted-2)', fontSize: 12 }}>No tags</span>}
                </div>
                <input
                  className="input"
                  placeholder="Add a tag + Enter"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                />
              </div>

              {(lead.lost_reason || stage?.is_lost) && (
                <div className="field">
                  <label htmlFor="f-lost_reason">Lost reason</label>
                  <input
                    id="f-lost_reason"
                    className="input"
                    defaultValue={lead.lost_reason ?? ''}
                    key={lead.lost_reason ?? ''}
                    onBlur={(e) => saveField('lost_reason', e.target.value)}
                  />
                </div>
              )}

              {formAnswerRows(lead.fields).length > 0 && (
                <>
                  <div className="mono-label" style={{ margin: '4px 0 4px' }}>Ad form answers</div>
                  <dl className="kv">
                    {formAnswerRows(lead.fields).map((r, i) => (
                      <div key={i} style={{ display: 'contents' }}>
                        <dt>{r.q}</dt>
                        <dd>{r.a}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}

              <div className="mono-label" style={{ margin: '4px 0 4px' }}>Custom fields</div>
              {customRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input"
                    placeholder="Label"
                    value={row.key}
                    onChange={(e) => updateCustomRow(i, 'key', e.target.value)}
                    onBlur={() => saveCustomFields(customRows)}
                    style={{ flex: '0 0 40%' }}
                  />
                  <input
                    className="input"
                    placeholder="Value"
                    value={row.value}
                    onChange={(e) => updateCustomRow(i, 'value', e.target.value)}
                    onBlur={() => saveCustomFields(customRows)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn ghost sm" onClick={() => removeCustomRow(i)} aria-label="Remove field" title="Remove field">×</button>
                </div>
              ))}
              <button className="btn ghost sm" onClick={addCustomRow} style={{ alignSelf: 'flex-start' }}>+ Add field</button>
            </>
          )}
        </div>

        {view === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {suggestions.length > 0 && (
              <div className="wa-suggestions">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono-label">Suggested replies</span>
                  <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setSuggestions([])}>Dismiss</button>
                </div>
                {suggestions.map((s, i) => (
                  <button key={i} type="button" className="wa-suggestion" onClick={() => { setDraft(s); setSuggestions([]); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface-soft)' }}>
                {attachments.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 6, padding: '3px 4px 3px 3px', background: 'var(--surface)' }}>
                    {a.mime?.startsWith('image/') ? (
                      <img src={a.dataUrl} alt="" style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <span className="tag off">{a.mime?.split('/')[0] || 'file'}</span>
                    )}
                    <span style={{ fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                    <button
                      className="btn ghost sm"
                      onClick={() => setAttachments((list) => list.filter((_, x) => x !== i))}
                      aria-label={`Remove ${a.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {replyTarget && (
              <div className="wa-reply-preview">
                <div className="wa-reply-preview-body">
                  <div className="wa-reply-preview-who">{replyTarget.direction === 'out' ? 'You' : lead.full_name || 'Them'}</div>
                  <div className="wa-reply-preview-text">{replyTarget.body || (replyTarget.media_mime ? '📎 Attachment' : '(message)')}</div>
                </div>
                <button className="btn ghost sm" onClick={() => setReplyTarget(null)} aria-label="Cancel reply">×</button>
              </div>
            )}
            {showEmoji && (
              <div className="wa-emoji-panel">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => insertInDraft(e)} aria-label={`Insert ${e}`}>{e}</button>
                ))}
              </div>
            )}
            {recording ? (
              <div className="wa-composer wa-recording">
                <span className="wa-rec-dot" />
                <span className="wa-rec-time">{String(Math.floor(recordSecs / 60)).padStart(2, '0')}:{String(recordSecs % 60).padStart(2, '0')}</span>
                <span style={{ flex: 1, color: 'var(--muted)', fontSize: 12.5 }}>Recording voice message…</span>
                <button className="btn ghost sm" onClick={() => stopRecording(false)}>Cancel</button>
                <button className="wa-send" onClick={() => stopRecording(true)} aria-label="Send voice message">➤</button>
              </div>
            ) : (
              <div className="wa-composer">
                <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => pickFile(e.target.files)} />
                <button className="wa-icon-btn wa-emoji-btn" onClick={() => setShowEmoji((v) => !v)} aria-label="Emoji" title="Emoji">
                  🙂
                </button>
                <button className="wa-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach file" title="Attach file">
                  📎
                </button>
                <MessageTemplates
                  lead={lead}
                  onInsert={(text) => insertInDraft(draft && !/\s$/.test(draft) ? ` ${text}` : text)}
                />
                <button
                  className="wa-icon-btn"
                  onClick={suggestAI}
                  disabled={suggesting}
                  aria-label="Suggest replies with AI"
                  title="Suggest replies with AI"
                >
                  {suggesting ? '…' : '✨'}
                </button>
                <textarea
                  ref={composerRef}
                  className="input wa-input"
                  rows={1}
                  placeholder="Type a message — Shift+Enter for a new line"
                  title="*bold*  _italic_  ~strikethrough~  ```monospace```"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onComposerKey}
                  style={{ flex: 1 }}
                />
                {!draft.trim() && attachments.length === 0 ? (
                  <button className="wa-icon-btn wa-mic-btn" onClick={startRecording} disabled={sending} aria-label="Record voice message" title="Record voice message">
                    🎤
                  </button>
                ) : (
                  <button className="wa-send" onClick={send} disabled={sending} aria-label="Send">
                    {sending ? '…' : '➤'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </aside>

      {forwardTarget && (
        <>
          <div className="scrim" onClick={() => setForwardTarget(null)} />
          <div style={{ position: 'fixed', inset: 0, zIndex: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" role="dialog" aria-label="Forward message" style={{ width: '100%', maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginTop: 0 }}>Forward message</h2>
              <div className="wa-forward-preview">
                {forwardTarget.body || (forwardTarget.media_mime ? '📎 Attachment' : '(message)')}
              </div>
              <input
                className="input"
                placeholder="Search leads by name or phone…"
                value={forwardQuery}
                onChange={(e) => searchForwardTargets(e.target.value)}
                autoFocus
                style={{ marginTop: 10 }}
              />
              <div className="wa-forward-results">
                {forwardSearching && <div className="empty" style={{ padding: 12 }}>Searching…</div>}
                {!forwardSearching && forwardQuery.trim() && forwardResults.length === 0 && (
                  <div className="empty" style={{ padding: 12 }}>No leads match.</div>
                )}
                {forwardResults.map((l) => (
                  <button key={l.id} className="wa-forward-row" onClick={() => forwardTo(l)} disabled={forwardingTo === l.id}>
                    <span>{l.full_name || 'Unnamed lead'}</span>
                    <span className="t">{forwardingTo === l.id ? 'Sending…' : l.phone}</span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn ghost sm" onClick={() => setForwardTarget(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
