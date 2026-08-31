/**
 * 2026-08-31 — Manus P11. Pure-helper unit tests for
 * `helperAssignmentTrigger`.
 *
 * The trigger body needs a Firestore emulator; the seven
 * pure-helper unit tests below cover the full decision-tree
 * surface so the trigger can stay thin.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAssignmentNotificationId,
  diffKeys,
  MEANINGFUL_ITEM_FIELDS,
  resolveAssignmentRecipient,
  sourceVersion,
  validateTriggerPath,
} from '../src/helperAssignmentPure';

describe('validateTriggerPath', () => {
  const ok = {
    appId: 'savetheday-production',
    ownerUid: 'owner-1',
    eventId: 'event-1',
    parentKind: 'rundown',
    parentId: 'item-1',
  };

  it('accepts a production-path rundown write', () => {
    expect(validateTriggerPath({ ...ok, allowedParentKinds: ['rundown', 'resources'] })).toBeNull();
  });

  it('rejects a foreign app namespace', () => {
    expect(validateTriggerPath({ ...ok, appId: 'some-other-app', allowedParentKinds: ['rundown'] })).toBe('foreign-app');
  });

  it('rejects when ownerUid / eventId / parentId are blank', () => {
    expect(validateTriggerPath({ ...ok, ownerUid: '', allowedParentKinds: ['rundown'] })).toBe('missing-params');
    expect(validateTriggerPath({ ...ok, eventId: '   ', allowedParentKinds: ['rundown'] })).toBe('missing-params');
    expect(validateTriggerPath({ ...ok, parentId: null, allowedParentKinds: ['rundown'] })).toBe('missing-params');
  });

  it('rejects an unknown parent kind (e.g. a /vendors/ write)', () => {
    expect(validateTriggerPath({ ...ok, parentKind: 'vendors', allowedParentKinds: ['rundown'] })).toBe('unknown-parent-kind');
  });
});

describe('resolveAssignmentRecipient', () => {
  const helperA = 'helper-a';
  const helperB = 'helper-b';

  it('returns the newly assigned helper when assignment changes from empty to helper', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: { title: 'old' },
        afterData: { title: 'new', assignedHelperUid: helperB },
        changedKeys: ['assignedHelperUid'],
        previousHelperUid: null,
        currentHelperUid: helperB,
      }),
    ).toEqual({ recipient: helperB, action: 'assigned' });
  });

  it('returns the replacement helper, never the old helper, when helper changes', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: { assignedHelperUid: helperA },
        afterData: { assignedHelperUid: helperB },
        changedKeys: ['assignedHelperUid'],
        previousHelperUid: helperA,
        currentHelperUid: helperB,
      }),
    ).toEqual({ recipient: helperB, action: 'assigned' });
  });

  it('returns the same helper for a meaningful item update', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: { assignedHelperUid: helperA, title: 'old' },
        afterData: { assignedHelperUid: helperA, title: 'new' },
        changedKeys: ['title'],
        previousHelperUid: helperA,
        currentHelperUid: helperA,
      }),
    ).toEqual({ recipient: helperA, action: 'updated' });
  });

  it('returns no recipient for title-irrelevant metadata-only updates', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: { assignedHelperUid: helperA, updatedAt: 1 },
        afterData: { assignedHelperUid: helperA, updatedAt: 2 },
        changedKeys: ['updatedAt'],
        previousHelperUid: helperA,
        currentHelperUid: helperA,
      }),
    ).toEqual({ recipient: null, action: 'updated' });
  });

  it('returns no recipient when the document is deleted', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: { assignedHelperUid: helperA },
        afterData: null,
        changedKeys: [],
        previousHelperUid: helperA,
        currentHelperUid: null,
      }),
    ).toEqual({ recipient: null, action: 'updated' });
  });

  it('returns no recipient when the helper was removed', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: { assignedHelperUid: helperA },
        afterData: { title: 'still here' },
        changedKeys: ['assignedHelperUid'],
        previousHelperUid: helperA,
        currentHelperUid: null,
      }),
    ).toEqual({ recipient: null, action: 'updated' });
  });

  it('returns no recipient when no helper is assigned (was empty, still empty)', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: { title: 'old' },
        afterData: { title: 'new' },
        changedKeys: ['title'],
        previousHelperUid: null,
        currentHelperUid: null,
      }),
    ).toEqual({ recipient: null, action: 'updated' });
  });

  it('returns assignment action when a new doc is created with a helper assigned', () => {
    expect(
      resolveAssignmentRecipient({
        beforeData: null,
        afterData: { assignedHelperUid: helperB, title: 'fresh item' },
        changedKeys: ['title', 'assignedHelperUid'],
        previousHelperUid: null,
        currentHelperUid: helperB,
      }),
    ).toEqual({ recipient: helperB, action: 'assigned' });
  });
});

describe('MEANINGFUL_ITEM_FIELDS allowlist', () => {
  it('includes title, time, location, notes, helper assignment', () => {
    expect(MEANINGFUL_ITEM_FIELDS.has('title')).toBe(true);
    expect(MEANINGFUL_ITEM_FIELDS.has('startTime')).toBe(true);
    expect(MEANINGFUL_ITEM_FIELDS.has('endTime')).toBe(true);
    expect(MEANINGFUL_ITEM_FIELDS.has('location')).toBe(true);
    expect(MEANINGFUL_ITEM_FIELDS.has('address')).toBe(true);
    expect(MEANINGFUL_ITEM_FIELDS.has('notes')).toBe(true);
    expect(MEANINGFUL_ITEM_FIELDS.has('assignedHelperUid')).toBe(true);
    expect(MEANINGFUL_ITEM_FIELDS.has('assignedHelperName')).toBe(true);
  });

  it('excludes updatedAt / updatedByUid and other bookkeeping fields', () => {
    expect(MEANINGFUL_ITEM_FIELDS.has('updatedAt')).toBe(false);
    expect(MEANINGFUL_ITEM_FIELDS.has('updatedByUid')).toBe(false);
    expect(MEANINGFUL_ITEM_FIELDS.has('statusUpdatedAt')).toBe(false);
  });
});

describe('buildAssignmentNotificationId — idempotency', () => {
  it('returns the same id for the same input on a retry', () => {
    const id1 = buildAssignmentNotificationId({
      kind: 'assigned',
      eventId: 'event-1',
      parentKind: 'rundown',
      parentId: 'item-1',
      version: 1700000000000,
      recipientUid: 'helper-1',
    });
    const id2 = buildAssignmentNotificationId({
      kind: 'assigned',
      eventId: 'event-1',
      parentKind: 'rundown',
      parentId: 'item-1',
      version: 1700000000000,
      recipientUid: 'helper-1',
    });
    expect(id1).toBe(id2);
    expect(id1).toBe('bigday-assigned_event-1_rundown_item-1_1700000000000_helper-1');
  });

  it('produces different ids when the version changes', () => {
    const a = buildAssignmentNotificationId({
      kind: 'updated',
      eventId: 'event-1',
      parentKind: 'resources',
      parentId: 'item-2',
      version: 1700000000000,
      recipientUid: 'helper-1',
    });
    const b = buildAssignmentNotificationId({
      kind: 'updated',
      eventId: 'event-1',
      parentKind: 'resources',
      parentId: 'item-2',
      version: 1700000001000,
      recipientUid: 'helper-1',
    });
    expect(a).not.toBe(b);
  });

  it('uses noversion sentinel when the source has no updatedAt', () => {
    const id = buildAssignmentNotificationId({
      kind: 'assigned',
      eventId: 'event-1',
      parentKind: 'rundown',
      parentId: 'item-1',
      version: null,
      recipientUid: 'helper-1',
    });
    expect(id).toBe('bigday-assigned_event-1_rundown_item-1_noversion_helper-1');
  });
});

describe('diffKeys', () => {
  it('returns the union of keys from both snapshots', () => {
    expect(diffKeys({ a: 1, b: 2 }, { a: 1, c: 3 })).toEqual(
      expect.arrayContaining(['a', 'b', 'c']),
    );
  });
  it('handles both snapshots null', () => {
    expect(diffKeys(null, null)).toEqual([]);
  });
});

describe('sourceVersion', () => {
  it('returns the numeric updatedAt when present', () => {
    expect(sourceVersion({ updatedAt: 1700000000000 })).toBe(1700000000000);
  });
  it('returns Date.now() fallback when updatedAt is missing', () => {
    const before = Date.now();
    const v = sourceVersion({ title: 'no updatedAt' });
    expect(v).toBeGreaterThanOrEqual(before);
  });
});