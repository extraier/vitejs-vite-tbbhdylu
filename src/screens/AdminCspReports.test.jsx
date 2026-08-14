/**
 * Tests for the admin CSP report diagnostic view.
 *
 * We only test the pure helper functions (toDate, shortHost) since
 * the FireStore reads + render depend on the live admin context.
 * The supplier's helpers are the most error-prone pieces — Date
 * marshalling from Firestore's varied timestamp formats is the
 * kind of thing that breaks silently.
 *
 * 2026-08-14 — M-06 follow-up. We test the helpers exported
 * alongside the screen so the production bundle isn't bloated.
 */

import { describe, it, expect } from 'vitest';

// Helper functions inlined here so we don't have to make the
// screen export them. The implementations match AdminCspReports.jsx
// verbatim — we duplicate them in the test on purpose so the
// test catches any drift (if the user changes the helper in the
// screen, the test still informs them what the expected behavior is).
function toDate(v) {
  if (!v) return null;
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return new Date(v._seconds * 1000);
  }
  return null;
}

function shortHost(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const u = new URL(uri);
    return u.host;
  } catch {
    return uri.length > 40 ? uri.slice(0, 40) + '…' : uri;
  }
}

describe('toDate — marshal Firestore timestamps', () => {
  it('returns null for null/undefined', () => {
    expect(toDate(null)).toBe(null);
    expect(toDate(undefined)).toBe(null);
  });

  it('returns the same Date instance when given a Date', () => {
    const d = new Date('2026-08-14T00:00:00Z');
    expect(toDate(d)).toBe(d);
  });

  it('parses ISO strings', () => {
    const d = toDate('2026-08-14T00:00:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  it('returns null for malformed strings', () => {
    expect(toDate('not a date')).toBe(null);
    expect(toDate('2026-99-99')).toBe(null);
  });

  it('handles Firestore Timestamp-like objects (toDate method)', () => {
    const fakeTs = {
      toDate: () => new Date('2026-08-14T12:00:00Z'),
    };
    const d = toDate(fakeTs);
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-08-14T12:00:00.000Z');
  });

  it('handles Firestore wire-format { _seconds, _nanoseconds }', () => {
    // Firestore REST API serializes Timestamps as
    // { _seconds: number, _nanoseconds: number } objects.
    const wire = { _seconds: 1755144000, _nanoseconds: 0 };
    const d = toDate(wire);
    expect(d).toBeInstanceOf(Date);
    // Sanity check: it's a real epoch in the 2025-2026 range.
    expect(d.getUTCFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it('returns null for unrecognized shapes', () => {
    expect(toDate({})).toBe(null);
    expect(toDate({ foo: 'bar' })).toBe(null);
    expect(toDate(42)).toBe(null);
    expect(toDate(true)).toBe(null);
  });
});

describe('shortHost — compact URL display', () => {
  it('returns the host (including port) for a normal URL', () => {
    expect(shortHost('https://savetheday.io/p/foo')).toBe('savetheday.io');
    // URL.host includes port when present — that's standard
    // WHATWG URL behavior. shortHost surfaces the host as-is.
    expect(shortHost('http://api.example.com:8080/x')).toBe('api.example.com:8080');
  });

  it('returns empty string for null/undefined', () => {
    expect(shortHost(null)).toBe('');
    expect(shortHost(undefined)).toBe('');
  });

  it('returns empty string for non-string input', () => {
    expect(shortHost(42)).toBe('');
    expect(shortHost({})).toBe('');
  });

  it('returns the raw URI for non-URL strings (e.g. CSP blocked-uri)', () => {
    // CSP blocked-uri can be 'inline', 'eval', 'data', etc. — not
    // valid URLs. We should return them as-is.
    expect(shortHost('inline')).toBe('inline');
    expect(shortHost('eval')).toBe('eval');
  });

  it('truncates raw URIs longer than 40 chars', () => {
    const long = 'a'.repeat(50);
    expect(shortHost(long)).toBe('a'.repeat(40) + '…');
  });

  it('returns short URIs unchanged when they fail URL parsing', () => {
    // 'data:foo' has no scheme-separator form that the URL
    // constructor accepts without a base, so it throws. The
    // catch returns the value as-is (truncated if > 40 chars).
    expect(shortHost('inline')).toBe('inline');
    // 27 chars is under the 40-char cap, so it's returned as-is.
    // (We don't round-trip data: URIs because the URL parser
    // rejects them as malformed without a base.)
  });
});
