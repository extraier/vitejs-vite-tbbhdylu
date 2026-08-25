// 2026-08-25 — Manus P9.
//
// Web Audio success chime for ReceptionScanner. Pure helper that
// schedules two short sine tones (E5 + G5) on the provided audio
// context. Returns the list of scheduled nodes so tests can assert
// the chime was scheduled correctly without depending on real
// audio playback. Exported separately so the component can wrap
// it with the user-gesture enable step and the React state.
//
// We deliberately do NOT auto-play on mount. Browsers require a
// user gesture to start audio. The component surfaces a button
// that calls AudioContext.resume() and then playSuccessChime()
// becomes available.

/**
 * @param {object} params
 * @param {AudioContext | null} params.context
 *        The AudioContext to schedule on. Must be running
 *        (state === 'running') — caller is responsible for
 *        ensuring that.
 * @returns {Array<{ frequency: number, offset: number }>}
 *        A list of the tones that were scheduled. Empty array
 *        if the context was unavailable. Tests assert on the
 *        returned shape rather than on actual playback.
 */
export function playSuccessChime({ context }) {
  if (!context || context.state !== 'running') return [];

  const tones = [
    { frequency: 659.25, offset: 0 },    // E5
    { frequency: 783.99, offset: 0.12 },  // G5
  ];

  const startAt = context.currentTime;
  for (const { frequency, offset } of tones) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt + offset);
    // Short attack + decay envelope keeps the chime unobtrusive.
    gain.gain.setValueAtTime(0.0001, startAt + offset);
    gain.gain.exponentialRampToValueAtTime(0.13, startAt + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt + offset);
    oscillator.stop(startAt + offset + 0.24);
  }

  return tones;
}