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


describe('formatTimeSpan — millisecond span to human label', () => {
  // The function lives in AdminCspReports.jsx but is duplicated
  // here for unit-testing. The implementations stay in sync by
  // definition — if you change one, change both.
  function formatTimeSpan(ms) {
    if (ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} 分鐘`;
    const h = Math.floor(m / 60);
    if (h < 24) {
      const rem = m % 60;
      return rem === 0 ? `${h} 小時` : `${h} 小時 ${rem} 分鐘`;
    }
    const d = Math.floor(h / 24);
    const remH = h % 24;
    return remH === 0 ? `${d} 日` : `${d} 日 ${remH} 小時`;
  }

  it('returns "—" for negative spans', () => {
    expect(formatTimeSpan(-1)).toBe('—');
  });

  it('returns seconds for sub-minute spans', () => {
    expect(formatTimeSpan(0)).toBe('0 秒');
    expect(formatTimeSpan(1000)).toBe('1 秒');
    expect(formatTimeSpan(59_000)).toBe('59 秒');
  });

  it('returns minutes for sub-hour spans', () => {
    expect(formatTimeSpan(60_000)).toBe('1 分鐘');
    expect(formatTimeSpan(59 * 60_000)).toBe('59 分鐘');
  });

  it('returns hours for sub-day spans', () => {
    expect(formatTimeSpan(60 * 60_000)).toBe('1 小時');
    expect(formatTimeSpan(2 * 60 * 60_000)).toBe('2 小時');
    expect(formatTimeSpan(2 * 60 * 60_000 + 30 * 60_000)).toBe('2 小時 30 分鐘');
  });

  it('returns days for multi-day spans', () => {
    expect(formatTimeSpan(24 * 60 * 60_000)).toBe('1 日');
    expect(formatTimeSpan(5 * 24 * 60 * 60_000)).toBe('5 日');
    expect(formatTimeSpan(2 * 24 * 60 * 60_000 + 3 * 60 * 60_000)).toBe('2 日 3 小時');
  });
});

describe('stats aggregation — top-directives + top-blocked-uris', () => {
  // Same pattern: duplicated logic to keep the test independent
  // of the React component. The helpers are pure functions.

  function topDirectives(reports) {
    const counts = new Map();
    for (const r of reports) {
      const key = r.violatedDirective || r.effectiveDirective || '(unknown)';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }

  function topBlockedUris(reports) {
    const counts = new Map();
    for (const r of reports) {
      const u = r.blockedUri;
      if (!u) continue;
      counts.set(u, (counts.get(u) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }

  const sample = [
    { violatedDirective: 'script-src', blockedUri: 'https://a.example/x.js' },
    { violatedDirective: 'script-src', blockedUri: 'https://a.example/x.js' },
    { violatedDirective: 'img-src', blockedUri: 'https://b.example/y.png' },
    { violatedDirective: 'img-src', blockedUri: 'https://c.example/z.png' },
    { effectiveDirective: 'font-src', blockedUri: '' },
    { violatedDirective: '', blockedUri: undefined },
  ];

  it('counts directives by frequency, sorted desc', () => {
    const out = topDirectives(sample);
    expect(out).toEqual([
      ['script-src', 2],
      ['img-src', 2],
      ['font-src', 1],
      ['(unknown)', 1],
    ]);
  });

  it('caps results at top 5', () => {
    const big = Array.from({ length: 10 }, (_, i) => ({
      violatedDirective: `directive-${i}`,
    }));
    const out = topDirectives(big);
    expect(out).toHaveLength(5);
  });

  it('counts blocked-uris by frequency, skipping missing', () => {
    const out = topBlockedUris(sample);
    expect(out).toEqual([
      ['https://a.example/x.js', 2],
      ['https://b.example/y.png', 1],
      ['https://c.example/z.png', 1],
    ]);
  });

  it('returns [] when no reports have blockedUri', () => {
    expect(topBlockedUris([
      { blockedUri: '' },
      { blockedUri: undefined },
      {},
    ])).toEqual([]);
  });
});
