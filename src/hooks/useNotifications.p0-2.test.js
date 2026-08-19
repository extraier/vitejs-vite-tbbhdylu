// 2026-08-19 — Manus P0.2 unit tests for the comment-alert
// normalizer. Pins the "prefer data.eventId over hook eventId"
// rule so a future refactor that drops the resolution (or
// reverses the order) fails the build instead of silently
// regressing the cross-event deep-link contract.

import { describe, it, expect } from 'vitest';
import { commentItems } from './useNotifications';

const baseDoc = {
  id: 'alert-1',
  kind: 'rundown',
  parentId: 'rd-1',
  parentTitle: '行禮',
  commentId: 'cm-1',
  authorUid: 'vendor-1',
  authorName: '靚相攝影',
  authorRole: 'vendor',
  text: '我會提早到場',
  createdAt: 1700000000000,
};

describe('commentItems (P0.2 eventId resolution)', () => {
  it('uses the alert doc eventId when present (authoritative path)', () => {
    const doc = { ...baseDoc, eventId: 'event-A' };
    const items = commentItems([doc], 'owner-1', 'event-B');
    expect(items).toHaveLength(1);
    expect(items[0].meta.eventId).toBe('event-A');
    expect(items[0].href.eventId).toBe('event-A');
  });

  it('falls back to the hook eventId when the alert doc has no eventId', () => {
    // Legacy alert doc written before the trigger started
    // persisting eventId. The hook's current event is the only
    // signal we have.
    const doc = { ...baseDoc };
    delete doc.eventId;
    const items = commentItems([doc], 'owner-1', 'event-B');
    expect(items[0].meta.eventId).toBe('event-B');
    expect(items[0].href.eventId).toBe('event-B');
  });

  it('returns null eventId when neither the doc nor the hook has one (vendor bell)', () => {
    // 2026-08-19 — This is the case the P0.2 spec explicitly
    // calls out: "A vendor bell commonly has no current event
    // value". Without the resolution rule, a vendor bell with
    // a legacy alert would have `undefined` bleeding into the
    // href and the App.jsx routing logic would treat that as
    // "current event is selected" — pointing the vendor at the
    // wrong wedding. Null is the right answer.
    const doc = { ...baseDoc };
    delete doc.eventId;
    const items = commentItems([doc], 'owner-1', null);
    expect(items[0].meta.eventId).toBe(null);
    expect(items[0].href.eventId).toBe(null);
  });

  it('does not let an empty-string doc eventId override the hook eventId', () => {
    // Defensive: a stray empty string from a malformed doc
    // shape should not become the resolved eventId. The hook
    // eventId is a meaningful fallback.
    const doc = { ...baseDoc, eventId: '' };
    const items = commentItems([doc], 'owner-1', 'event-B');
    expect(items[0].meta.eventId).toBe('event-B');
    expect(items[0].href.eventId).toBe('event-B');
  });

  it('preserves meta.alertId, parentId, kind, readAt unchanged', () => {
    const doc = {
      ...baseDoc,
      eventId: 'event-A',
      readAt: 1700000001000, // already read
    };
    const items = commentItems([doc], 'owner-1', 'event-B');
    expect(items[0].meta.alertId).toBe('alert-1');
    expect(items[0].meta.parentId).toBe('rd-1');
    expect(items[0].meta.kind).toBe('rundown');
    expect(items[0].readAt).toBe(1700000001000);
    expect(items[0].alertDocId).toBe('alert-1');
  });

  it('keeps meta and href in sync for both rundown and resources', () => {
    const rundownDoc = { ...baseDoc, id: 'a1', eventId: 'event-A', kind: 'rundown' };
    const resourcesDoc = { ...baseDoc, id: 'a2', eventId: 'event-A', kind: 'resources' };
    const items = commentItems([rundownDoc, resourcesDoc], 'owner-1', 'event-B');
    expect(items[0].meta.kind).toBe('rundown');
    expect(items[0].href.kind).toBe('rundown');
    expect(items[1].meta.kind).toBe('resources');
    expect(items[1].href.kind).toBe('resources');
    // Both should still resolve to event-A.
    expect(items[0].meta.eventId).toBe('event-A');
    expect(items[1].meta.eventId).toBe('event-A');
  });

  it('handles a multi-event fixture where the user is on event B', () => {
    // The exact scenario the P0.2 spec describes: hook selected
    // event B, but a comment alert for event A arrives. Without
    // the fix, the bell click would route to event B.
    const docs = [
      { ...baseDoc, id: 'a-event-a', eventId: 'event-A', parentId: 'rd-a' },
      { ...baseDoc, id: 'a-event-b', eventId: 'event-B', parentId: 'rd-b' },
    ];
    const items = commentItems(docs, 'owner-1', 'event-B');
    const a = items.find((i) => i.id === 'comment:a-event-a');
    const b = items.find((i) => i.id === 'comment:a-event-b');
    expect(a.meta.eventId).toBe('event-A');
    expect(a.href.eventId).toBe('event-A');
    expect(b.meta.eventId).toBe('event-B');
    expect(b.href.eventId).toBe('event-B');
  });

  it('an empty docs array returns an empty array (no crash)', () => {
    expect(commentItems([], 'owner-1', 'event-B')).toEqual([]);
  });
});