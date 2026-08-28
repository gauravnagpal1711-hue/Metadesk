import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Debounced type-ahead against a GET endpoint that takes ?q=. Returns
 * { query, setQuery, results, loading }. `path` is like '/meta/geo'.
 */
export function useTypeahead(path, { minChars = 2, delay = 250 } = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < minChars) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const rows = await api.get(`${path}?q=${encodeURIComponent(q)}`);
        if (mine === seq.current) setResults(Array.isArray(rows) ? rows : []);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, delay);
    return () => clearTimeout(timer.current);
  }, [query, path, minChars, delay]);

  return { query, setQuery, results, loading };
}
