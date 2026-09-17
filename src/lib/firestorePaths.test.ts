import { describe, it, expect } from 'vitest';
import {
  parseEventScopedRef,
  parseCommentPath,
  commentsCollectionPath,
  commentDocPath,
  eventItemPath,
  parseOwnerUid,
  parseGuestQrToken,
  assertAssignedTaskContext,
  seatingItemPath,
  seatingCollectionPath,
  parseSeatingItemPath,
  type SeatingCollection,
} from './firestorePaths';

describe('parseEventScopedRef', () => {
  it('parses canonical event-scoped path', () => {
    const path = 'artifacts/savetheday-production/users/UID123/events/EVT456/rundown/ITEM1';
    expect(parseEventScopedRef(path)).toEqual({
      ownerUid: 'UID123',
      eventId: 'EVT456',
    });
  });

  it('handles deeply nested paths', () => {
    const path = 'artifacts/savetheday-production/users/UID123/events/EVT456/rundown/ITEM1/comments/CMT1';
    expect(parseEventScopedRef(path)).toEqual({
      ownerUid: 'UID123',
      eventId: 'EVT456',
    });
  });

  it('returns null for paths without events segment', () => {
    expect(parseEventScopedRef('artifacts/savetheday-production/users/UID123/socialProofs/P1')).toBeNull();
    expect(parseEventScopedRef('vendors/abc')).toBeNull();
    expect(parseEventScopedRef('')).toBeNull();
  });

  it('returns null for malformed paths', () => {
    // No eventId after events
    expect(parseEventScopedRef('artifacts/savetheday-production/users/UID123/events/')).toBeNull();
    // events at start, no ownerUid before
    expect(parseEventScopedRef('events/EVT456/rundown/ITEM1')).toBeNull();
  });

  it('handles trailing slash', () => {
    expect(parseEventScopedRef('artifacts/savetheday-production/users/UID123/events/EVT456/rundown/ITEM1/')).toEqual({
      ownerUid: 'UID123',
      eventId: 'EVT456',
    });
  });
});

describe('parseCommentPath', () => {
  it('parses a comment path with kind=rundown', () => {
    const path = 'artifacts/savetheday-production/users/UID123/events/EVT456/rundown/ITEM1/comments/CMT1';
    expect(parseCommentPath(path)).toEqual({
      ownerUid: 'UID123',
      eventId: 'EVT456',
      kind: 'rundown',
      itemId: 'ITEM1',
      commentId: 'CMT1',
    });
  });

  it('parses a comment path with kind=resources', () => {
    const path = 'artifacts/app/users/UID/events/EVT/resources/RES1/comments/COM1';
    expect(parseCommentPath(path)).toEqual({
      ownerUid: 'UID',
      eventId: 'EVT',
      kind: 'resources',
      itemId: 'RES1',
      commentId: 'COM1',
    });
  });

  it('parses a comments collection reference for Cloud Function writes', () => {
    const path = 'artifacts/app/users/UID/events/EVT/rundown/ITEM1/comments';
    expect(parseCommentPath(path)).toEqual({
      ownerUid: 'UID',
      eventId: 'EVT',
      kind: 'rundown',
      itemId: 'ITEM1',
      commentId: null,
    });
  });

  it('returns null if the comments segment is missing', () => {
    expect(parseCommentPath('artifacts/app/users/UID/events/EVT/rundown/ITEM1')).toBeNull();
  });
});

describe('path constructors', () => {
  const ctx = { ownerUid: 'UID123', eventId: 'EVT456', kind: 'rundown', itemId: 'ITEM1' };

  it('commentsCollectionPath', () => {
    expect(commentsCollectionPath('my-app', ctx))
      .toBe('artifacts/my-app/users/UID123/events/EVT456/rundown/ITEM1/comments');
  });

  it('commentDocPath', () => {
    expect(commentDocPath('my-app', { ...ctx, commentId: 'CMT1' }))
      .toBe('artifacts/my-app/users/UID123/events/EVT456/rundown/ITEM1/comments/CMT1');
  });

  it('eventItemPath', () => {
    expect(eventItemPath('my-app', ctx))
      .toBe('artifacts/my-app/users/UID123/events/EVT456/rundown/ITEM1');
  });
});

describe('parseOwnerUid', () => {
  it('returns uid from owner-scoped nested path', () => {
    expect(parseOwnerUid('artifacts/app/users/UID123/socialProofs/P1')).toBe('UID123');
  });
  it('returns uid from event-scoped path', () => {
    expect(parseOwnerUid('artifacts/app/users/UID123/events/EVT/rundown/I')).toBe('UID123');
  });
  it('returns null when no users segment', () => {
    expect(parseOwnerUid('artifacts/app/vendors/V1')).toBeNull();
    expect(parseOwnerUid('')).toBeNull();
  });
});

describe('parseGuestQrToken', () => {
  it('parses the canonical owner/event/guest invitation URL', () => {
    expect(
      parseGuestQrToken('https://savetheday.io/?o=owner-1&e=event-1&g=guest-1'),
    ).toEqual({
      ownerUid: 'owner-1',
      eventId: 'event-1',
      guestId: 'guest-1',
    });
  });

  it('rejects an incomplete canonical invitation URL', () => {
    expect(
      parseGuestQrToken('https://savetheday.io/?o=owner-1&e=event-1'),
    ).toBeNull();
  });

  it('parses raw eventId/guestId', () => {
    expect(parseGuestQrToken('EVT/GUEST')).toEqual({
      ownerUid: null,
      eventId: 'EVT',
      guestId: 'GUEST',
    });
  });

  it('parses URL with ?q=', () => {
    expect(parseGuestQrToken('https://savetheday.io/?q=EVT/GUEST')).toEqual({
      ownerUid: null,
      eventId: 'EVT',
      guestId: 'GUEST',
    });
  });

  it('parses URL-encoded values', () => {
    expect(parseGuestQrToken('https://savetheday.io/?q=EVT%2FGUEST')).toEqual({
      ownerUid: null,
      eventId: 'EVT',
      guestId: 'GUEST',
    });
  });

  it('returns only guestId when no eventId', () => {
    expect(parseGuestQrToken('GUEST')).toEqual({
      ownerUid: null,
      eventId: null,
      guestId: 'GUEST',
    });
  });

  it('returns null for empty string', () => {
    expect(parseGuestQrToken('')).toBeNull();
  });
});

describe('assertAssignedTaskContext', () => {
  it('does not throw for valid context', () => {
    expect(() =>
      assertAssignedTaskContext({
        ownerUid: 'UID',
        eventId: 'EVT',
        kind: 'rundown',
        itemId: 'ITEM',
      }),
    ).not.toThrow();
  });

  it('throws with the missing field names', () => {
    expect(() => assertAssignedTaskContext({ ownerUid: 'UID' })).toThrow(/eventId.*kind.*itemId/);
  });

  it('lists all missing fields', () => {
    try {
      assertAssignedTaskContext({});
    } catch (e: unknown) {
      expect((e as Error).message).toContain('ownerUid');
      expect((e as Error).message).toContain('eventId');
      expect((e as Error).message).toContain('kind');
      expect((e as Error).message).toContain('itemId');
    }
  });
});

/* ============================================================
 * 2026-09-12 — Hermes P13 (seating chart) path helpers
 * ============================================================ */
const APP = 'savetheday-production';
const P = (rest: string) => `artifacts/${APP}/users/owner-a/events/event-1/${rest}`;

describe('seatingItemPath', () => {
  it('builds a seating meta path', () => {
    expect(
      seatingItemPath(APP, {
        ownerUid: 'owner-a',
        eventId: 'event-1',
        collection: 'seating',
        itemId: 'main',
      }),
    ).toBe(P('seating/main'));
  });

  it('builds a tables path', () => {
    expect(
      seatingItemPath(APP, {
        ownerUid: 'owner-a',
        eventId: 'event-1',
        collection: 'tables',
        itemId: 't1',
      }),
    ).toBe(P('tables/t1'));
  });

  it('builds a tableAssignments path (guestId = docId)', () => {
    expect(
      seatingItemPath(APP, {
        ownerUid: 'owner-a',
        eventId: 'event-1',
        collection: 'tableAssignments',
        itemId: 'guest-123',
      }),
    ).toBe(P('tableAssignments/guest-123'));
  });

  it('builds a floorDecor path', () => {
    expect(
      seatingItemPath(APP, {
        ownerUid: 'owner-a',
        eventId: 'event-1',
        collection: 'floorDecor',
        itemId: 'wall-1',
      }),
    ).toBe(P('floorDecor/wall-1'));
  });

  it('round-trips through parseSeatingItemPath', () => {
    for (const collection of ['seating', 'tables', 'tableAssignments', 'floorDecor'] as SeatingCollection[]) {
      const path = seatingItemPath(APP, {
        ownerUid: 'owner-a', eventId: 'event-1', collection, itemId: 'abc',
      });
      expect(parseSeatingItemPath(path)).toEqual({
        ownerUid: 'owner-a', eventId: 'event-1', collection, itemId: 'abc',
      });
    }
  });
});

describe('seatingCollectionPath', () => {
  it('returns the collection root without itemId', () => {
    expect(
      seatingCollectionPath(APP, {
        ownerUid: 'owner-a', eventId: 'event-1', collection: 'tables',
      }),
    ).toBe(P('tables'));
  });
});

describe('parseSeatingItemPath — guards', () => {
  it('returns null on a non-seating path', () => {
    expect(parseSeatingItemPath(P('rundown/r1'))).toBeNull();
  });

  it('returns null on a foreign-app path', () => {
    expect(
      parseSeatingItemPath('artifacts/other-app/users/o/events/e/tables/t1'),
    ).toBeNull();
  });

  it('returns null on a too-short path', () => {
    expect(parseSeatingItemPath('artifacts/x/users/o')).toBeNull();
  });

  it('returns null on a non-string input', () => {
    // @ts-expect-error – intentionally wrong type
    expect(parseSeatingItemPath(null)).toBeNull();
    // @ts-expect-error – intentionally wrong type
    expect(parseSeatingItemPath(42)).toBeNull();
  });
});
