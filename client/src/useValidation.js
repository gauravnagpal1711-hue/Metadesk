import { useCallback, useState } from 'react';

/**
 * One small form-validation helper shared by every create/edit form in the app.
 * On a save attempt, `check()` flags every missing required field red and
 * returns false so the caller can bail before hitting the API.
 *
 *   const v = useValidation();
 *   async function save() {
 *     if (!v.check({
 *       name: { value: name, label: 'Campaign name' },
 *       budget: { value: budget, label: 'Daily budget', validate: (x) => Number(x) > 0 },
 *     })) return;
 *     ...
 *   }
 *   <input className={v.cls('name')} value={name}
 *          onChange={(e) => { setName(e.target.value); v.clear('name'); }} />
 *   {v.message && <div className="notice bad">{v.message}</div>}
 */
export function useValidation() {
  const [bad, setBad] = useState({});      // { fieldKey: true }
  const [message, setMessage] = useState('');

  const check = useCallback((fields) => {
    const failed = {};
    const labels = [];
    for (const [key, raw] of Object.entries(fields)) {
      const spec = raw && typeof raw === 'object' && !Array.isArray(raw) && ('value' in raw || 'validate' in raw)
        ? raw
        : { value: raw };
      const label = spec.label || key;
      const ok = spec.validate ? !!spec.validate(spec.value) : !isBlank(spec.value);
      if (!ok) {
        failed[key] = true;
        labels.push(label);
      }
    }
    setBad(failed);
    setMessage(labels.length ? `Please fill in: ${labels.join(', ')}.` : '');
    return labels.length === 0;
  }, []);

  const clear = useCallback((key) => {
    setBad((b) => (b[key] ? { ...b, [key]: false } : b));
  }, []);

  const reset = useCallback(() => {
    setBad({});
    setMessage('');
  }, []);

  const cls = useCallback(
    (key, base = 'input') => (bad[key] ? `${base} is-invalid` : base),
    [bad]
  );
  const fieldCls = useCallback(
    (key, base = 'field') => (bad[key] ? `${base} is-invalid` : base),
    [bad]
  );

  return { bad, message, check, clear, reset, cls, fieldCls, invalid: (k) => !!bad[k] };
}

function isBlank(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return Number.isNaN(v);
  return false;
}
