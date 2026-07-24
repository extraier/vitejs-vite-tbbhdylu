// Simple toast hook — 4-second auto-dismiss.
// The original App.jsx inlined this with a useState + setTimeout pair;
// pulling it out keeps callers free of side-effect bookkeeping.
//
// 2026-07-24 — added dismiss-on-pointerup listener. Even with
// pointer-events:none on the toast, iOS Safari has historical
// bugs where the element still intercepts taps that visually
// overlap the X button. Listening for the first tap after
// showToast and dismissing early lets the user click through
// to underlying buttons (← 返回嘉賓列表 on PersonalGuestPortal,
// the photo viewer X, etc.) without waiting 4s for auto-dismiss.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast(autoDismissMs = 4000) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), autoDismissMs);

    // Tap-anywhere dismisses. Use pointerup so it fires after
    // click handlers on the actual underlying button (X button,
    // link, etc.) have already run. Once-only — the listener
    // removes itself after the first tap or when the toast
    // auto-dismisses.
    const onTap = () => {
      setToast(null);
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('pointerup', onTap, true);
      document.removeEventListener('touchend', onTap, true);
    };
    // capture phase so we run even if something else called
    // stopPropagation; the underlying button's own click handler
    // still runs in bubble phase after we dismiss.
    document.addEventListener('pointerup', onTap, true);
    document.addEventListener('touchend', onTap, true);
    // Safety net: clear listeners when the toast auto-dismisses
    setTimeout(() => {
      document.removeEventListener('pointerup', onTap, true);
      document.removeEventListener('touchend', onTap, true);
    }, autoDismissMs + 100);
  }, [autoDismissMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { toast, showToast };
}
