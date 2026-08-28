// Shared date-urgency helper for appointment / followup dates. Drives the
// red / amber / green colour on date chips across the board and the table.

/** overdue (past) | today | soon (next 3 days) | future | none (no date) */
export function bucketOf(iso) {
  if (!iso) return 'none';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'none';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const inThreeDays = new Date(startOfToday);
  inThreeDays.setDate(inThreeDays.getDate() + 4); // through end of the 3rd day

  if (d < now) return 'overdue';
  if (d < startOfTomorrow) return 'today';
  if (d < inThreeDays) return 'soon';
  return 'future';
}

/** Short "in 2d" / "3d ago" / "today" label. */
export function relativeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${-days}d ago`;
  return `in ${days}d`;
}

/** Compact date+time for chips, e.g. "12 Sep, 3:30 PM". */
export function shortDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
