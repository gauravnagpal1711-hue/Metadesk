import { useState } from 'react';
import { bucketOf, shortDateTime, toDatetimeLocal } from '../lib/dateBuckets.js';

/** A date-chip (used for appointment/follow-up dates on the board and table)
 *  that turns into a datetime-local input on click, so the date can be
 *  nudged without opening the lead's full drawer. Calls onSave(isoOrNull). */
export default function EditableDateChip({ value, icon, onSave }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!value && !editing) return null;

  if (editing) {
    return (
      <input
        type="datetime-local"
        className="input date-chip-edit"
        autoFocus
        defaultValue={toDatetimeLocal(value)}
        disabled={saving}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => setEditing(false)}
        onChange={async (e) => {
          setSaving(true);
          try {
            await onSave(e.target.value ? new Date(e.target.value).toISOString() : null);
          } finally {
            setSaving(false);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div
      className={`date-chip ${bucketOf(value)}`}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to change"
    >
      {icon} {shortDateTime(value)}
    </div>
  );
}
