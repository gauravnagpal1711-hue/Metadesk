import { useState } from 'react';

export const LOST_REASONS = ['Not Interested', 'Booked Somewhere', 'Price Issue', 'Location Issue', 'Not Contactable', 'Lead Not Correct'];
const OTHER = 'Other';

/** Splits a stored lost_reason string into the dropdown choice and the free-text note. */
function parse(value) {
  const v = (value || '').trim();
  if (!v) return { choice: '', note: '' };
  if (LOST_REASONS.includes(v)) return { choice: v, note: '' };
  return { choice: OTHER, note: v.replace(/^Other:?\s*/i, '') };
}

/**
 * Lost-reason dropdown. The value is one string: a fixed category, or "Other" / "Other: <note>".
 * A selected reason is always non-empty, so callers can keep their `!value.trim()` checks.
 */
export default function LostReasonPicker({ value, onChange, autoFocus, style, saveNoteOnBlur }) {
  const { choice, note } = parse(value);
  const [draft, setDraft] = useState(null);
  const emitNote = (text) => onChange(text.trim() ? `${OTHER}: ${text}` : OTHER);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <select
        className="input"
        value={choice}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a reason…</option>
        {LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        <option value={OTHER}>Other reason</option>
      </select>
      {choice === OTHER && (
        <input
          className="input"
          placeholder="Add details (optional)"
          value={saveNoteOnBlur && draft !== null ? draft : note}
          onChange={(e) => (saveNoteOnBlur ? setDraft(e.target.value) : emitNote(e.target.value))}
          onBlur={() => {
            if (saveNoteOnBlur && draft !== null) { emitNote(draft); setDraft(null); }
          }}
        />
      )}
    </div>
  );
}
