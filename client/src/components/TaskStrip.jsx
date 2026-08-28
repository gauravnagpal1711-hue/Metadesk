import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { relativeShort, shortDateTime, bucketOf } from '../lib/dateBuckets.js';

const KIND_ICON = { call: '📞', meeting: '🤝', whatsapp: '💬', email: '✉️', todo: '☑️' };

/** The cross-lead "what needs doing today" queue that sits above the board/table. */
export default function TaskStrip({ reloadSignal, onOpenLead, onChanged }) {
  const [tasks, setTasks] = useState([]);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setTasks(await api.get('/leads/tasks?scope=today'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadSignal]);
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  async function complete(task) {
    try {
      await api.patch(`/leads/tasks/${task.id}`, { done: true });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  }

  const overdue = tasks.filter((t) => t.due_at && bucketOf(t.due_at) === 'overdue').length;

  if (tasks.length === 0 && !error) return null;

  return (
    <div className="task-strip">
      <button className="task-strip-head" onClick={() => setOpen((o) => !o)}>
        <span className="mono-label">
          {open ? '▾' : '▸'} TASKS DUE · {tasks.length}
          {overdue > 0 && <span className="tag hot" style={{ marginLeft: 8 }}>{overdue} overdue</span>}
        </span>
      </button>
      {error && <div className="notice bad">{error}</div>}
      {open && (
        <div className="task-strip-body">
          {tasks.map((t) => (
            <div key={t.id} className="task-row">
              <input type="checkbox" checked={false} onChange={() => complete(t)} aria-label="Mark task done" />
              <span className="task-kind" title={t.kind}>{KIND_ICON[t.kind] || '☑️'}</span>
              <button className="task-title" onClick={() => onOpenLead(t.lead_id)}>
                {t.title}
                <span className="task-lead">· {t.lead_name || t.lead_phone || 'lead'}</span>
              </button>
              <span className={`date-chip ${bucketOf(t.due_at)}`} title={shortDateTime(t.due_at)}>
                {t.due_at ? relativeShort(t.due_at) : 'no date'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
