// Simple toast hook — 4-second auto-dismiss.
// The original App.jsx inlined this with a useState + setTimeout pair;
// pulling it out keeps callers free of side-effect bookkeeping.

import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast(autoDismissMs = 4000) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), autoDismissMs);
  }, [autoDismissMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { toast, showToast };
}
