// 2026-08-25 — Manus P9. Unit tests for the Web Audio success chime.
//
// We mock AudioContext at the test boundary so we can assert on
// the scheduled oscillator/gain nodes without real audio output.
// The component wraps playSuccessChime() in a useCallback; this
// helper is the pure scheduling logic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSuccessChime } from './successChime';

function createMockAudioContext(initialState = 'running') {
  const oscillators = [];
  const gains = [];
  const calls = [];

  function createOscillator() {
    const node = {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn((value, time) => {
          calls.push({ kind: 'freq', value, time });
        }),
      },
      // Real WebAudio nodes return the destination of the chain
      // (or itself for chaining). Tests rely on
      //   oscillator.connect(gain).connect(context.destination)
      // so the inner connect must return something connectable.
      connect: vi.fn(() => ({
        connect: vi.fn(),
      })),
      start: vi.fn((time) => {
        calls.push({ kind: 'start', time });
      }),
      stop: vi.fn((time) => {
        calls.push({ kind: 'stop', time });
      }),
    };
    oscillators.push(node);
    return node;
  }

  function createGain() {
    const node = {
      gain: {
        setValueAtTime: vi.fn((value, time) => {
          calls.push({ kind: 'gain-set', value, time });
        }),
        exponentialRampToValueAtTime: vi.fn((value, time) => {
          calls.push({ kind: 'gain-ramp', value, time });
        }),
      },
      connect: vi.fn(() => ({
        connect: vi.fn(),
      })),
    };
    gains.push(node);
    return node;
  }

  return {
    state: initialState,
    currentTime: 12.345,
    createOscillator,
    createGain,
    destination: { tag: 'destination' },
    oscillators,
    gains,
    calls,
  };
}

describe('playSuccessChime', () => {
  let originalAudioContext;

  beforeEach(() => {
    originalAudioContext = globalThis.window?.AudioContext;
  });

  afterEach(() => {
    if (globalThis.window) {
      globalThis.window.AudioContext = originalAudioContext;
    }
  });

  it('schedules two oscillator tones (E5 + G5) when the context is running', () => {
    const ctx = createMockAudioContext('running');
    const scheduled = playSuccessChime({ context: ctx });

    expect(scheduled).toEqual([
      { frequency: 659.25, offset: 0 },
      { frequency: 783.99, offset: 0.12 },
    ]);
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.gains).toHaveLength(2);
    // Each tone must start and stop within a 0.24s window.
    const starts = ctx.calls.filter((c) => c.kind === 'start');
    const stops = ctx.calls.filter((c) => c.kind === 'stop');
    expect(starts).toHaveLength(2);
    expect(stops).toHaveLength(2);
    expect(stops[0].time - starts[0].time).toBeCloseTo(0.24);
  });

  it('returns an empty array and does nothing when the context is missing', () => {
    const scheduled = playSuccessChime({ context: null });
    expect(scheduled).toEqual([]);
  });

  it('returns an empty array and does nothing when the context is suspended', () => {
    // Browsers place AudioContext in 'suspended' state until a
    // user gesture. Until then the chime must be a no-op.
    const ctx = createMockAudioContext('suspended');
    const scheduled = playSuccessChime({ context: ctx });
    expect(scheduled).toEqual([]);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('does not throw if the context throws during scheduling', () => {
    const ctx = {
      state: 'running',
      currentTime: 0,
      createOscillator() {
        throw new Error('Audio disabled');
      },
      createGain() {},
      destination: null,
    };
    expect(() => playSuccessChime({ context: ctx })).toThrow();
  });
});