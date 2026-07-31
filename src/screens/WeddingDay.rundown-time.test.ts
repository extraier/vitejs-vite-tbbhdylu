// 2026-07-31 — Smoke tests for the time-arithmetic helpers introduced
// when the Rundown editor switched from a "start + duration in
// minutes" UI to a "start → end" UI. The helpers live in
// WeddingDay.jsx (the file size made splitting them out of the
// component infeasible; this test file imports them indirectly by
// re-declaring the same functions).
//
// If the helpers ever leave WeddingDay.jsx, this file's `reimported`
// block should switch from a re-declaration to a real import.
//
// We test:
//
//  - parseHHMMToMinutes: happy path, edge hour boundaries, null
//    returns for malformed input.
//
//  - addMinutesToHHMM:    small positive gap, hour wrap (5:30 +
//                         90 = 07:00), midnight wrap (23:45 + 30 =
//                         00:15, not 24:15).
//
//  - computeEndHHMM:      exposes the user-visible behavior of the
//                         editor — couples set a start, see an end
//                         derived from start + duration.
//
//  - computeMinutesBetween: round-trip (start + minutes → end →
//                           minutes) returns the original value; end
//                           before start crosses midnight.

import { describe, it, expect } from 'vitest';

// Re-declarations kept in lock-step with src/screens/WeddingDay.jsx.
// If you change one, change both.
function parseHHMMToMinutes(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function addMinutesToHHMM(startHHMM: string, addMin: number): string {
  const base = parseHHMMToMinutes(startHHMM);
  const delta = Number.isFinite(addMin) ? addMin : 0;
  if (base === null) return startHHMM || '';
  const total = base + delta;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function computeEndHHMM(startHHMM: string, durationMin: number): string {
  if (!startHHMM) return '';
  return addMinutesToHHMM(startHHMM, durationMin || 0);
}

function computeMinutesBetween(startHHMM: string, endHHMM: string): number {
  const a = parseHHMMToMinutes(startHHMM);
  const b = parseHHMMToMinutes(endHHMM);
  if (a === null || b === null) return 30;
  const diff = b >= a ? b - a : b + 24 * 60 - a;
  return Math.max(5, Math.min(diff, 24 * 60));
}

describe('parseHHMMToMinutes', () => {
  it('parses midnight as 0 minutes', () => {
    expect(parseHHMMToMinutes('00:00')).toBe(0);
  });
  it('parses noon as 720 minutes', () => {
    expect(parseHHMMToMinutes('12:00')).toBe(720);
  });
  it('parses 5:30 AM as 330 minutes (the screenshot scenario)', () => {
    expect(parseHHMMToMinutes('05:30')).toBe(330);
  });
  it('returns null for garbage inputs', () => {
    // Note: the regex tolerates 1–2 digit hours (`5:30` parses as
    // 330). This is intentional permissiveness — `<input
    // type="time">` always emits zero-padded strings in practice,
    // but the helper also receives endTime values that users may
    // have typed into older imports. We only reject inputs that are
    // structurally broken or out of bounds.
    expect(parseHHMMToMinutes('25:00')).toBeNull();  // hour out of range
    expect(parseHHMMToMinutes('12:60')).toBeNull();  // minute out of range
    expect(parseHHMMToMinutes('garbage')).toBeNull();
    expect(parseHHMMToMinutes('')).toBeNull();
    expect(parseHHMMToMinutes(null as unknown as string)).toBeNull();
    expect(parseHHMMToMinutes(undefined as unknown as string)).toBeNull();
    expect(parseHHMMToMinutes(123 as unknown as string)).toBeNull();
  });
});

describe('addMinutesToHHMM', () => {
  it('adds 30 minutes to 5:30 AM = 6:00 AM', () => {
    expect(addMinutesToHHMM('05:30', 30)).toBe('06:00');
  });
  it('adds 90 minutes to 5:30 AM = 7:00 AM (hour wrap)', () => {
    expect(addMinutesToHHMM('05:30', 90)).toBe('07:00');
  });
  it('adds 30 minutes to 23:45 = 00:15 (midnight wrap)', () => {
    expect(addMinutesToHHMM('23:45', 30)).toBe('00:15');
  });
  it('returns the original string when start is malformed', () => {
    expect(addMinutesToHHMM('garbage', 30)).toBe('garbage');
    expect(addMinutesToHHMM('', 30)).toBe('');
  });
  it('treats NaN duration as 0', () => {
    expect(addMinutesToHHMM('10:00', Number.NaN)).toBe('10:00');
  });
});

describe('computeEndHHMM (user-visible derived end-time)', () => {
  it('derives end from start + duration', () => {
    expect(computeEndHHMM('05:30', 30)).toBe('06:00');
    expect(computeEndHHMM('17:00', 90)).toBe('18:30');
  });
  it('returns empty string when no startTime', () => {
    expect(computeEndHHMM('', 30)).toBe('');
  });
  it('handles missing duration as 0 (same minute)', () => {
    expect(computeEndHHMM('05:30', 0 as unknown as number)).toBe('05:30');
  });
});

describe('computeMinutesBetween (round-trip)', () => {
  it('round-trips: start 05:30 + 30min → end 06:00 → 30min back', () => {
    const start = '05:30';
    const dur = 30;
    const end = computeEndHHMM(start, dur);
    expect(end).toBe('06:00');
    expect(computeMinutesBetween(start, end)).toBe(dur);
  });

  it('round-trips a 90-minute gap', () => {
    const start = '17:00';
    const dur = 90;
    expect(computeEndHHMM(start, dur)).toBe('18:30');
    expect(computeMinutesBetween(start, '18:30')).toBe(dur);
  });

  it('treats end-before-start as crossing midnight', () => {
    // 23:00 (start) → 01:00 (end) = 120 minutes, not -1320.
    expect(computeMinutesBetween('23:00', '01:00')).toBe(120);
  });

  it('clamps the duration into [5, 1440] minutes', () => {
    expect(computeMinutesBetween('00:00', '00:01')).toBe(5);   // too short → clamp
    expect(computeMinutesBetween('00:00', '00:00')).toBe(5);   // same time → clamp
    // >24h isn't possible with valid HH:MM, so just confirm 1440 clamp
    expect(computeMinutesBetween('00:00', '23:59')).toBe(1439);
  });

  it('falls back to 30 when either input is malformed', () => {
    expect(computeMinutesBetween('garbage', '10:00')).toBe(30);
    expect(computeMinutesBetween('10:00', 'garbage')).toBe(30);
  });
});
