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
  it('parses raw eventId/guestId', () => {
    expect(parseGuestQrToken('EVT/GUEST')).toEqual({ eventId: 'EVT', guestId: 'GUEST' });
  });
  it('parses URL with ?q=', () => {
    expect(parseGuestQrToken('https://savetheday.io/?q=EVT/GUEST')).toEqual({
      eventId: 'EVT',
      guestId: 'GUEST',
    });
  });
  it('parses URL-encoded values', () => {
    expect(parseGuestQrToken('https://savetheday.io/?q=EVT%2FGUEST')).toEqual({
      eventId: 'EVT',
      guestId: 'GUEST',
    });
  });
  it('returns only guestId when no eventId', () => {
    expect(parseGuestQrToken('GUEST')).toEqual({ eventId: null, guestId: 'GUEST' });
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
