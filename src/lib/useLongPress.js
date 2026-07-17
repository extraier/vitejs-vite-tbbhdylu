// useLongPress — fires `onLongPress` after the user holds the
// pointer / touch for ≥ `delayMs` (default 600ms). The hook is
// tolerant of pointer jitter (small movements don't cancel).
//
// Usage:
//
//   const press = useLongPress(() => doDrilldown(), { delayMs: 600 });
//   <button {...press}> ... </button>
//
// On desktop: also fires on contextmenu (right click) so mouse users
// get the same shortcut without having to actually hold. Disable
// via { disableContextMenu: false } if you only want touch.
//
// The hook returns spread-onto-element event handlers (no element
// ref required): the consumer just spreads them onto the target.

import { useEffect, useRef } from 'react';

export function useLongPress(
  onLongPress,
  { delayMs = 600, movementTolerance = 12, disableContextMenu = true } = {},
) {
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const triggeredRef = useRef(false);

  function clearState() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    triggeredRef.current = false;
  }

  useEffect(() => {
    return () => clearState();
  }, []);

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    triggeredRef.current = false;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      try {
        onLongPress?.(e);
      } finally {
        timerRef.current = null;
      }
    }, delayMs);
  }

  function onPointerMove(e) {
    if (!startRef.current) return;
    const dx = Math.abs(e.clientX - startRef.current.x);
    const dy = Math.abs(e.clientY - startRef.current.y);
    if (dx > movementTolerance || dy > movementTolerance) {
      clearState();
    }
  }

  function onPointerEnd() {
    clearState();
  }

  function onContextMenu(e) {
    if (!disableContextMenu) return;
    e.preventDefault();
    try {
      onLongPress?.(e);
    } finally {
      triggeredRef.current = false;
    }
  }

  function onClickCapture(e) {
    if (triggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      triggeredRef.current = false;
    }
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onPointerLeave: onPointerEnd,
    onContextMenu,
    onClickCapture,
  };
}

// useLongPressRegistry — batch handler for N elements with no
// Rules of Hooks conflict. Returns a `get(key)` accessor that
// yields the same set of event handlers for a given key.
//
// Motivation: useLongPress must not be called inside .map() in a
// child component (hooks-rules violation, even when the iteration
// is fixed-size). This hook exposes a factory so the consumer
// can hook into N elements with one hook call total.
//
// Usage:
//   const getPress = useLongPressRegistry({
//     delayMs: 600,
//     onLongPress: (key) => onCardDrilldown?.(key),
//   });
//   {items.map(it => <button {...getPress(it.id)} />)}
//
// Returns: `getHandlers(key) -> event handlers object`.

export function useLongPressRegistry({
  onLongPress,
  delayMs = 600,
  movementTolerance = 12,
  disableContextMenu = true,
} = {}) {
  // Single timer per registry. The latest pressed key wins. We could
  // fan out to per-key timers if needed, but a single press at a
  // time is the realistic UX.
  const stateRef = useRef({ timer: null, key: null, x: 0, y: 0, triggered: false });

  function clearState() {
    const s = stateRef.current;
    if (s.timer !== null) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    s.key = null;
    s.triggered = false;
  }

  useEffect(() => () => clearState(), []);

  function onPointerDown(key) {
    return (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const s = stateRef.current;
      clearState();
      s.key = key;
      s.x = e.clientX;
      s.y = e.clientY;
      s.timer = setTimeout(() => {
        s.triggered = true;
        s.timer = null;
        try {
          onLongPress?.(key, e);
        } catch (_) {
          // consumer errors shouldn't break the registry
        }
      }, delayMs);
    };
  }

  function onPointerMove(e) {
    const s = stateRef.current;
    if (s.key === null) return;
    const dx = Math.abs(e.clientX - s.x);
    const dy = Math.abs(e.clientY - s.y);
    if (dx > movementTolerance || dy > movementTolerance) clearState();
  }

  function onPointerEnd() {
    clearState();
  }

  function onContextMenu(key) {
    return (e) => {
      if (!disableContextMenu) return;
      e.preventDefault();
      try {
        onLongPress?.(key, e);
      } finally {
        stateRef.current.triggered = false;
      }
    };
  }

  function onClickCapture(e) {
    if (stateRef.current.triggered) {
      e.preventDefault();
      e.stopPropagation();
      stateRef.current.triggered = false;
    }
  }

  function getHandlers(key) {
    return {
      onPointerDown: onPointerDown(key),
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onPointerLeave: onPointerEnd,
      onContextMenu: onContextMenu(key),
      onClickCapture,
    };
  }

  return getHandlers;
}
