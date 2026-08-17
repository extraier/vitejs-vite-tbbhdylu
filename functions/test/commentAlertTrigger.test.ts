/**
 * 2026-08-17 — commentAlertTrigger pure-helper unit tests (Manus step 12).
 *
 * The trigger's most subtle logic is in four small pure helpers:
 *   safeString — normalizes a comment/parent doc field to a
 *     trimmed string or null.
 *   safeCreatedAt — accepts raw number OR a Firestore Timestamp
 *     (which has .toMillis()) and returns millis.
 *   truncatePreview — 120-char preview with ellipsis, identical
 *     to `buildCommentAlertDoc`'s truncation so the trigger and
 *     the CF produce the same preview string.
 *   safeParentTitle — falls back to '大日流程' / '物資' when the
 *     parent has no title.
 *
 * The trigger body itself needs a Firestore emulator (and is
 * therefore not unit-tested here) — these four helpers cover
 * the trigger's full pure surface.
 */

import { describe, it, expect, vi } from 'vitest';

// 2026-08-17 — the trigger imports `initializeApp` at module-load
// time, which throws in our test env (no Firebase Admin context).
// Stub `firebase-admin/app` so the module evaluates.
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));
// Stub firestore too — the trigger imports `getFirestore`.
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  FieldValue: {
    serverTimestamp: vi.fn(() => ({ __isServerTimestamp: true })),
  },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (opts: unknown) => (_handler: unknown) => ({
    _opts: opts,
  }),
}));

import {
  safeString,
  safeCreatedAt,
  truncatePreview,
  safeParentTitle,
} from '../src/commentAlertTrigger';

describe('safeString (input normalizer)', () => {
  it('returns trimmed string for non-empty input', () => {
    expect(safeString('  hello  ')).toBe('hello');
  });

  it('returns null for empty / whitespace-only strings', () => {
    expect(safeString('')).toBe(null);
    expect(safeString('   ')).toBe(null);
    expect(safeString('\n\t')).toBe(null);
  });

  it('returns null for non-string types', () => {
    expect(safeString(undefined)).toBe(null);
    expect(safeString(null)).toBe(null);
    expect(safeString(42)).toBe(null);
    expect(safeString({})).toBe(null);
    expect(safeString([])).toBe(null);
    expect(safeString(true)).toBe(null);
  });
});

describe('safeCreatedAt (timestamp normalizer)', () => {
  it('accepts a raw number', () => {
    expect(safeCreatedAt(1700000000000)).toBe(1700000000000);
  });

  it('accepts a Firestore Timestamp-like object', () => {
    expect(safeCreatedAt({ toMillis: () => 1700000000000 })).toBe(1700000000000);
  });

  it('falls back to Date.now() for null / undefined', () => {
    const before = Date.now();
    const result = safeCreatedAt(null);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('falls back to Date.now() for non-finite numbers', () => {
    expect(safeCreatedAt(NaN)).toBeGreaterThan(0);
    expect(safeCreatedAt(Infinity)).toBeGreaterThan(0);
  });

  it('falls back to Date.now() for objects with non-function toMillis', () => {
    expect(safeCreatedAt({ toMillis: 'not a function' })).toBeGreaterThan(0);
  });

  it('falls back to Date.now() for primitive non-numbers', () => {
    expect(safeCreatedAt('not a number')).toBeGreaterThan(0);
  });
});

describe('truncatePreview (120-char bell preview)', () => {
  it('returns input unchanged when <= 120 chars', () => {
    expect(truncatePreview('short msg')).toBe('short msg');
    const exact = 'a'.repeat(120);
    expect(truncatePreview(exact)).toBe(exact);
  });

  it('truncates at 120 chars + ellipsis when > 120 chars', () => {
    const long = 'a'.repeat(200);
    const out = truncatePreview(long);
    expect(out.length).toBe(121); // 120 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('preserves non-ASCII characters', () => {
    expect(truncatePreview('兄弟姊妹集合')).toBe('兄弟姊妹集合');
    const cjk = '物'.repeat(150);
    const out = truncatePreview(cjk);
    expect(out.length).toBe(121);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('safeParentTitle (parent-title fallback)', () => {
  it('returns the parent title when present', () => {
    expect(safeParentTitle('兄弟姊妹集合', 'rundown')).toBe('兄弟姊妹集合');
  });

  it('falls back to 大日流程 for rundown with no title', () => {
    expect(safeParentTitle(null, 'rundown')).toBe('大日流程');
    expect(safeParentTitle(undefined, 'rundown')).toBe('大日流程');
    expect(safeParentTitle('   ', 'rundown')).toBe('大日流程');
    expect(safeParentTitle(42, 'rundown')).toBe('大日流程');
  });

  it('falls back to 物資 for resources with no title', () => {
    expect(safeParentTitle(null, 'resources')).toBe('物資');
    expect(safeParentTitle('', 'resources')).toBe('物資');
  });
});