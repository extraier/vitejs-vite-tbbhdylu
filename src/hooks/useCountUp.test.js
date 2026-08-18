// 2026-08-17 — useCountUp unit tests.
//
// Covers the five behaviors that matter for the bell badge:
//   1. No-op when the value hasn't changed (mount with the same
//      value, or set the same value twice).
//   2. Tweens UP from 0 → 3 over ~400ms with easeOutCubic.
//      Intermediate frames must be visible.
//   3. Tweens DOWN from 3 → 0 with easeInCubic.
//   4. Snaps to the exact integer target (no floating-point drift).
//   5. Cancels cleanly on unmount (no "setState on unmounted
//      component" warning).

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from './useCountUp';

// 2026-08-17 — rAF + performance.now shim. jsdom provides neither;
// the hook depends on them. Define the shims at module scope so
// they exist for every render + cleanup, including cross-test
// effect cleanups.
let rafCallbacks = [];
let nextRafId = 0;
let nowValue = 0;

const realRequestAnimationFrame = globalThis.requestAnimationFrame;
const realCancelAnimationFrame = globalThis.cancelAnimationFrame;
const realPerformance = globalThis.performance;

globalThis.requestAnimationFrame = vi.fn((cb) => {
  const id = ++nextRafId;
  rafCallbacks.push({ id, cb });
  return id;
});
globalThis.cancelAnimationFrame = vi.fn((id) => {
  rafCallbacks = rafCallbacks.filter((entry) => entry.id !== id);
});
globalThis.performance = {
  ...(realPerformance || {}),
  now: vi.fn(() => nowValue),
};

beforeEach(() => {
  rafCallbacks = [];
  nextRafId = 0;
  nowValue = 0;
  vi.clearAllMocks();
});

afterAll(() => {
  // Restore the real globals so we don't poison the rest of the suite.
  if (realRequestAnimationFrame) {
    globalThis.requestAnimationFrame = realRequestAnimationFrame;
  } else {
    delete globalThis.requestAnimationFrame;
  }
  if (realCancelAnimationFrame) {
    globalThis.cancelAnimationFrame = realCancelAnimationFrame;
  } else {
    delete globalThis.cancelAnimationFrame;
  }
  if (realPerformance) {
    globalThis.performance = realPerformance;
  }
});

// Run all queued rAF callbacks, advancing `nowValue` by `dt` each
// step. Wraps in act() so React state updates are flushed.
function flushFrames(steps = 10, dt = 50) {
  for (let i = 0; i < steps; i++) {
    nowValue += dt;
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    for (const entry of callbacks) {
      act(() => entry.cb(nowValue));
    }
  }
}

describe('useCountUp', () => {
  it('initializes to the passed value without animating', () => {
    const { result } = renderHook(() => useCountUp(5));
    expect(result.current).toBe(5);
    // No rAF scheduled on first render — the hook's guard skips it
    // when next === value (no animation needed).
    expect(rafCallbacks).toEqual([]);
  });

  it('no-op when `next` equals current value', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 3 },
    });
    expect(result.current).toBe(3);
    rerender({ v: 3 });
    expect(result.current).toBe(3);
    expect(rafCallbacks).toEqual([]);
  });

  it('tweens UP from 0 to 3 over the duration', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { durationMs: 400 }),
      { initialProps: { v: 0 } },
    );
    expect(result.current).toBe(0);
    act(() => rerender({ v: 3 }));
    // One rAF scheduled.
    expect(rafCallbacks.length).toBe(1);
    // Advance to 100ms (25% of duration) — easeOutCubic(0.25) = 0.578
    // so value = round(3 * 0.578) = 2.
    act(() => rafCallbacks[0].cb(100));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThanOrEqual(3);
    // Final frames: settle on target.
    flushFrames(15, 30);
    expect(result.current).toBe(3);
  });

  it('tweens DOWN from 5 to 2 (easeInCubic — slow start)', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { durationMs: 400 }),
      { initialProps: { v: 5 } },
    );
    expect(result.current).toBe(5);
    act(() => rerender({ v: 2 }));
    // easeInCubic has a slow start. At 50% of duration, progress is
    // only 0.125, so value = 5 - 3*0.125 = 4.625 → round = 5. The
    // tween is intentionally slow at the beginning. We need to
    // push past ~70% to see motion (easeInCubic(0.7) = 0.343,
    // value = 5 - 1.03 = 3.97 → 4).
    flushFrames(10, 50); // 500ms total
    expect(result.current).toBeLessThan(5);
    expect(result.current).toBeGreaterThanOrEqual(2);
    // Push well past duration to settle.
    flushFrames(10, 50); // another 500ms
    expect(result.current).toBe(2);
  });

  it('snaps to the exact integer target (no float drift)', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { durationMs: 400 }),
      { initialProps: { v: 0 } },
    );
    act(() => rerender({ v: 7 }));
    flushFrames(20, 25); // 500ms total — past duration
    expect(result.current).toBe(7);
    expect(Number.isInteger(result.current)).toBe(true);
  });

  it('cancels the rAF on unmount without warning', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { result, rerender, unmount } = renderHook(
      ({ v }) => useCountUp(v, { durationMs: 400 }),
      { initialProps: { v: 0 } },
    );
    act(() => rerender({ v: 5 }));
    expect(rafCallbacks.length).toBe(1);
    unmount();
    flushFrames(5, 100);
    // No "setState on unmounted component" warning.
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Can't perform a React state update"),
    );
    consoleError.mockRestore();
  });

  it('respects a custom durationMs', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { durationMs: 100 }),
      { initialProps: { v: 0 } },
    );
    act(() => rerender({ v: 10 }));
    flushFrames(2, 60); // 120ms total — past duration
    expect(result.current).toBe(10);
  });

  it('handles rapid successive changes without freezing', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { durationMs: 400 }),
      { initialProps: { v: 0 } },
    );
    act(() => {
      rerender({ v: 1 });
      rerender({ v: 2 });
      rerender({ v: 5 });
    });
    flushFrames(15, 30); // 450ms total
    expect(result.current).toBe(5);
  });

  it('tweens NEGATIVE direction (rare, but supported)', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { durationMs: 400 }),
      { initialProps: { v: 10 } },
    );
    act(() => rerender({ v: -3 }));
    flushFrames(15, 30);
    expect(result.current).toBe(-3);
  });
});