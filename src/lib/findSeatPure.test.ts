import { describe, it, expect } from 'vitest';
import {
  generateFindSeatToken,
  defaultTokenExpiry,
  formatTokenExpiry,
  tokenTimeRemaining,
  buildPublicSnapshot,
  validatePublicUrl,
  buildFindSeatUrl,
  fetchPublicSnapshot,
} from './findSeatPure';

describe('generateFindSeatToken', () => {
  it('returns a 24-char URL-safe string', () => {
    const t = generateFindSeatToken();
    expect(typeof t).toBe('string');
    expect(t).toHaveLength(24); // 18 bytes base64url = 24 chars
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('produces different tokens each call', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateFindSeatToken()));
    // Birthday paradox: 50 tokens in 24-char space — collisions
    // are impossible (16^36 keyspace).
    expect(seen.size).toBe(50);
  });
});

describe('defaultTokenExpiry', () => {
  it('sets expiry to 23:59:59.999 of today', () => {
    const ref = new Date('2026-09-18T15:30:00Z');
    const exp = defaultTokenExpiry(ref);
    expect(exp.getHours()).toBe(23);
    expect(exp.getMinutes()).toBe(59);
    expect(exp.getSeconds()).toBe(59);
    expect(exp.getMilliseconds()).toBe(999);
  });
  it('rolls forward if today is already past 23:59', () => {
    const ref = new Date('2026-09-18T23:59:59.999Z');
    const exp = defaultTokenExpiry(ref);
    expect(exp.getTime()).toBeGreaterThan(ref.getTime());
    // Same hour/min/sec but next day.
    expect(exp.getHours()).toBe(23);
  });
});

describe('formatTokenExpiry', () => {
  it('formats midday as 12:00 PM', () => {
    const d = new Date('2026-09-18T12:00:00');
    expect(formatTokenExpiry(d)).toBe('12:00 PM');
  });
  it('formats midnight as 12:00 AM', () => {
    const d = new Date('2026-09-18T00:00:00');
    expect(formatTokenExpiry(d)).toBe('12:00 AM');
  });
  it('formats 11pm as 11:00 PM', () => {
    const d = new Date('2026-09-18T23:00:00');
    expect(formatTokenExpiry(d)).toBe('11:00 PM');
  });
  it('pads single-digit minutes', () => {
    const d = new Date('2026-09-18T15:05:00');
    expect(formatTokenExpiry(d)).toBe('3:05 PM');
  });
});

describe('tokenTimeRemaining', () => {
  it('returns hours + minutes when > 1h', () => {
    const now = 1_700_000_000_000;
    const deadline = now + (5 * 60 + 23) * 60_000;
    expect(tokenTimeRemaining(deadline, now)).toBe('5h 23m');
  });
  it('returns minutes when < 1h', () => {
    const now = 1_700_000_000_000;
    const deadline = now + 12 * 60_000;
    expect(tokenTimeRemaining(deadline, now)).toBe('12m');
  });
  it('returns "已過期" when past deadline', () => {
    const now = 1_700_000_000_000;
    expect(tokenTimeRemaining(now - 1, now)).toBe('已過期');
  });
});

describe('buildPublicSnapshot', () => {
  it('strips guest assignments (only metadata)', () => {
    const snap = buildPublicSnapshot(
      'event-1',
      'owner-1',
      { canvasWidth: 1200, canvasHeight: 800, background: 'banquet' },
      [{ id: 'T-1', label: 'T-01', shape: 'round', capacity: 10, x: 100, y: 100, rotation: 0, tableCategory: 'friends' }],
      new Date('2026-09-18T23:59:59'),
    );
    expect(snap.eventId).toBe('event-1');
    expect(snap.ownerUid).toBe('owner-1');
    expect(snap.canvas.width).toBe(1200);
    expect(snap.canvas.background).toBe('banquet');
    expect(snap.tables[0].label).toBe('T-01');
    expect(snap.tables[0].capacity).toBe(10);
    // No "guests" field on the public snapshot — privacy by design.
    expect((snap as any).assignments).toBeUndefined();
  });
  it('handles missing fields with sensible defaults', () => {
    const snap = buildPublicSnapshot(
      'e', 'o',
      {},
      [{ id: 'T-1' }],
      new Date(),
    );
    expect(snap.canvas.width).toBe(1200);
    expect(snap.canvas.height).toBe(800);
    expect(snap.tables[0].label).toBe('T-01');
    expect(snap.tables[0].capacity).toBe(10);
    expect(snap.tables[0].shape).toBe('round');
  });
});

describe('validatePublicUrl', () => {
  it('returns null for a valid URL with find-seat token', () => {
    expect(validatePublicUrl('https://savetheday.io/?find-seat=abc123def456ghi789')).toBeNull();
  });
  it('rejects URL with no query', () => {
    expect(validatePublicUrl('https://savetheday.io/')).toBe('missing-token');
  });
  it('rejects URL missing find-seat param', () => {
    expect(validatePublicUrl('https://savetheday.io/?foo=bar')).toBe('missing-token');
  });
  it('rejects too-short tokens', () => {
    expect(validatePublicUrl('https://savetheday.io/?find-seat=abc')).toBe('malformed-token');
  });
  it('rejects empty string', () => {
    expect(validatePublicUrl('')).toBe('missing-url');
  });
  it('rejects undefined', () => {
    expect(validatePublicUrl(undefined)).toBe('missing-url');
  });
});

describe('buildFindSeatUrl', () => {
  it('preserves host, sets find-seat param', () => {
    expect(buildFindSeatUrl('https://savetheday.io/', 'tok123'))
      .toBe('https://savetheday.io/?find-seat=tok123');
  });
  it('preserves existing query params', () => {
    const url = buildFindSeatUrl('https://savetheday.io/?utm=foo', 'tok456');
    expect(url).toContain('utm=foo');
    expect(url).toContain('find-seat=tok456');
  });
});

describe('fetchPublicSnapshot', () => {
  // Mock Firestore doc ref that returns a predetermined value.
  function mockRef(getImpl: () => Promise<{ exists: boolean; data: () => unknown }>) {
    return { doc: () => ({ get: getImpl }) };
  }

  it('returns ok=true with snap when doc exists and not expired', async () => {
    const now = 1_700_000_000_000;
    const data = {
      eventId: 'e-1', ownerUid: 'o-1',
      expiresAt: now + 60_000,
      canvas: { width: 1200, height: 800 },
      tables: [],
    };
    const out = await fetchPublicSnapshot(
      mockRef(async () => ({ exists: true, data: () => data })),
      'tok123456789012345678',
      now,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.snap.eventId).toBe('e-1');
  });

  it('returns not_found when doc does not exist', async () => {
    const out = await fetchPublicSnapshot(
      mockRef(async () => ({ exists: false, data: () => null })),
      'tok123456789012345678',
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_found');
  });

  it('returns expired when deadline has passed', async () => {
    const now = 1_700_000_000_000;
    const data = {
      eventId: 'e-1', ownerUid: 'o-1',
      expiresAt: now - 1, // expired 1ms ago
      canvas: { width: 1200, height: 800 },
      tables: [],
    };
    const out = await fetchPublicSnapshot(
      mockRef(async () => ({ exists: true, data: () => data })),
      'tok123456789012345678',
      now,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('expired');
  });

  it('returns malformed_token for too-short tokens without doing a fetch', async () => {
    let fetched = false;
    const out = await fetchPublicSnapshot(
      mockRef(async () => { fetched = true; return { exists: false, data: () => null }; }),
      'tok',
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('malformed_token');
    expect(fetched).toBe(false);
  });
});

// ---- V2: redacted assignments + name-search ----
// (2026-09-20 — P13.4.5 V2)

import {
  buildRedactedAssignments,
  matchGuestName,
} from './findSeatPure';

describe('buildRedactedAssignments (V2)', () => {
  const guestsById = {
    g1: { name: 'Chan Tai Man' },
    g2: { name: 'Lee 小明' },
    g3: { name: 'Wong 大文' },
    g4: { name: '   ' }, // blank name — drops
    g5: { name: 'Orphan' }, // no assignment
  };
  const tablesById = {
    t1: { label: 'T-01' },
    t2: { label: 'T-02 主家席' },
    t3: { label: 'T-03' },
  };

  it('emits one row per assigned guest with name + tableId + tableLabel', () => {
    const rows = buildRedactedAssignments(
      [
        { guestId: 'g1', tableId: 't1' },
        { guestId: 'g2', tableId: 't2' },
        { guestId: 'g3', tableId: 't3' },
      ],
      guestsById,
      tablesById,
    );
    expect(rows).toEqual([
      { guestId: 'g1', name: 'Chan Tai Man', tableId: 't1', tableLabel: 'T-01' },
      { guestId: 'g2', name: 'Lee 小明', tableId: 't2', tableLabel: 'T-02 主家席' },
      { guestId: 'g3', name: 'Wong 大文', tableId: 't3', tableLabel: 'T-03' },
    ]);
  });

  it('drops assignments pointing at missing guests', () => {
    const rows = buildRedactedAssignments(
      [{ guestId: 'ghost', tableId: 't1' }],
      guestsById,
      tablesById,
    );
    expect(rows).toEqual([]);
  });

  it('drops assignments pointing at missing tables', () => {
    const rows = buildRedactedAssignments(
      [{ guestId: 'g1', tableId: 'ghost-table' }],
      guestsById,
      tablesById,
    );
    expect(rows).toEqual([]);
  });

  it('drops guests with blank names', () => {
    const rows = buildRedactedAssignments(
      [{ guestId: 'g4', tableId: 't1' }],
      guestsById,
      tablesById,
    );
    expect(rows).toEqual([]);
  });

  it('falls back to tableId when label is missing', () => {
    const rows = buildRedactedAssignments(
      [{ guestId: 'g1', tableId: 't1' }],
      guestsById,
      { t1: {} as { label?: string } },
    );
    expect(rows[0]?.tableLabel).toBe('t1');
  });

  it('trims surrounding whitespace from names', () => {
    const rows = buildRedactedAssignments(
      [{ guestId: 'g1', tableId: 't1' }],
      { g1: { name: '  Chan Tai Man  ' } },
      tablesById,
    );
    expect(rows[0]?.name).toBe('Chan Tai Man');
  });
});

describe('matchGuestName (V2)', () => {
  const rows = [
    { guestId: 'g1', name: 'Chan Tai Man', tableId: 't1', tableLabel: 'T-01' },
    { guestId: 'g2', name: 'Chan Tai Man Wong', tableId: 't2', tableLabel: 'T-02' },
    { guestId: 'g3', name: 'Lee 小明', tableId: 't3', tableLabel: 'T-03' },
    { guestId: 'g4', name: 'Wong 大文', tableId: 't4', tableLabel: 'T-04' },
    { guestId: 'g5', name: 'Alice', tableId: 't5', tableLabel: 'T-05' },
    { guestId: 'g6', name: 'Alex', tableId: 't6', tableLabel: 'T-06' },
  ];

  it('returns empty array on empty query', () => {
    expect(matchGuestName(rows, '')).toEqual([]);
    expect(matchGuestName(rows, '   ')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const m = matchGuestName(rows, 'CHAN');
    expect(m).toHaveLength(2);
    expect(m.map((r) => r.guestId)).toContain('g1');
    expect(m.map((r) => r.guestId)).toContain('g2');
  });

  it('matches substrings within names', () => {
    const m = matchGuestName(rows, 'tai');
    expect(m.length).toBeGreaterThanOrEqual(2);
  });

  it('collapses whitespace in both query and stored names', () => {
    const m = matchGuestName(rows, '  chan   ');
    expect(m.length).toBe(2);
  });

  it('returns shortest-name-first on ties', () => {
    const m = matchGuestName(rows, 'chan');
    expect(m[0]?.name).toBe('Chan Tai Man'); // shorter than "Chan Tai Man Wong"
  });

  it('caps results at the supplied limit', () => {
    // 6 rows match any partial alphanum; limit=2 → 2 returned
    const m = matchGuestName(rows, 'a', 2);
    expect(m).toHaveLength(2);
  });

  it('matches CJK characters in names', () => {
    expect(matchGuestName(rows, '小明')).toHaveLength(1);
    expect(matchGuestName(rows, '大文')).toHaveLength(1);
  });

  it('handles a name containing both Latin + CJK', () => {
    const mixed = [
      ...rows,
      { guestId: 'g7', name: 'Chan 大文', tableId: 't7', tableLabel: 'T-07' },
    ];
    const m = matchGuestName(mixed, '大文');
    expect(m.map((r) => r.guestId)).toContain('g4');
    expect(m.map((r) => r.guestId)).toContain('g7');
  });

  it('returns empty when nothing matches', () => {
    expect(matchGuestName(rows, 'xyz123')).toEqual([]);
  });
});
