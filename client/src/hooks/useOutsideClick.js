import { useEffect } from 'react';

/** Calls onOutside when a click lands outside the given ref's element, only while active. */
export function useOutsideClick(ref, active, onOutside) {
  useEffect(() => {
    if (!active) return;
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [ref, active, onOutside]);
}
