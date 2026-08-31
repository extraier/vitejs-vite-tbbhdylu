/**
 * 2026-08-31 — Manus P11. Pure-helper unit tests for
 * `taskStatusTrigger`.
 *
 * The trigger body needs a Firestore emulator; the six pure-
 * helper unit tests below cover the full recipient-decision
 * surface so the trigger stays a thin Firestore wrapper.
 */

import { describe, expect, it } from 'vitest';
import {
  buildTaskStatusNotificationId,
  resolveTaskStatusRecipient,
  statusRevision,
} from '../src/taskStatusPure';

const HELPER = 'helper-1';
const OWNER = 'owner-1';
const OTHER_USER = 'co-owner-1';

describe('resolveTaskStatusRecipient', () => {
  it('notifies the assigned helper when an owner changes task status', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: { status: 'todo', assignedHelperUid: HELPER, title: '佈置場地' },
      afterData: {
        status: 'in-progress',
        assignedHelperUid: HELPER,
        title: '佈置場地',
        statusUpdatedAt: 1700000000000,
        statusUpdatedByUid: OWNER,
        statusUpdatedByRole: 'owner',
      },
    });
    expect(result.skipReason).toBeNull();
    expect(result.recipient).toBe(HELPER);
    expect(result.fromStatus).toBe('todo');
    expect(result.toStatus).toBe('in-progress');
    expect(result.taskTitle).toBe('佈置場地');
    expect(result.actorUid).toBe(OWNER);
  });

  it('does not notify when status is unchanged', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: { status: 'done', assignedHelperUid: HELPER },
      afterData: {
        status: 'done',
        assignedHelperUid: HELPER,
        statusUpdatedAt: 1700000000000,
      },
    });
    expect(result.skipReason).toBe('status-unchanged');
    expect(result.recipient).toBeNull();
  });

  it('does not notify when no helper is assigned', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: { status: 'todo', assignedHelperUid: null },
      afterData: {
        status: 'done',
        statusUpdatedAt: 1700000000000,
        statusUpdatedByUid: OWNER,
      },
    });
    expect(result.skipReason).toBe('no-helper-assigned');
    expect(result.recipient).toBeNull();
  });

  it('suppresses the helper self-notification when the helper changed their own status', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: { status: 'todo', assignedHelperUid: HELPER },
      afterData: {
        status: 'done',
        assignedHelperUid: HELPER,
        statusUpdatedAt: 1700000000000,
        statusUpdatedByUid: HELPER, // helper wrote their own status
        statusUpdatedByRole: 'helper',
      },
    });
    expect(result.skipReason).toBe('self-update');
    expect(result.recipient).toBeNull();
  });

  it('fails closed (no alert) when the actor UID is missing entirely', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: { status: 'todo', assignedHelperUid: HELPER },
      afterData: {
        status: 'in-progress',
        assignedHelperUid: HELPER,
        statusUpdatedAt: 1700000000000,
        // statusUpdatedByUid missing — rules enforce this on direct writes,
        // but if a callable or future schema skips the field, we do NOT
        // notify the helper rather than fire a possibly-self alert.
      },
    });
    expect(result.skipReason).toBe('actor-unknown');
    expect(result.recipient).toBeNull();
  });

  it('returns after-missing for a delete', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: { status: 'todo', assignedHelperUid: HELPER },
      afterData: null,
    });
    expect(result.skipReason).toBe('after-missing');
    expect(result.recipient).toBeNull();
  });

  it('returns before-missing for a brand-new task', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: null,
      afterData: { status: 'todo', assignedHelperUid: HELPER, title: '新任務' },
    });
    expect(result.skipReason).toBe('before-missing');
    expect(result.recipient).toBeNull();
  });

  it('notifies when the actor is anyone other than the assigned helper (vendor / co-owner / etc.)', () => {
    for (const actor of ['vendor-1', 'co-owner-1', 'other-helper']) {
      const result = resolveTaskStatusRecipient({
        beforeData: { status: 'todo', assignedHelperUid: HELPER },
        afterData: {
          status: 'in-progress',
          assignedHelperUid: HELPER,
          statusUpdatedAt: 1700000000000,
          statusUpdatedByUid: actor,
        },
      });
      expect(result.skipReason, `actor=${actor}`).toBeNull();
      expect(result.recipient, `actor=${actor}`).toBe(HELPER);
    }
  });

  it('falls back to "任務" when the task has no title', () => {
    const result = resolveTaskStatusRecipient({
      beforeData: { status: 'todo', assignedHelperUid: HELPER },
      afterData: {
        status: 'in-progress',
        assignedHelperUid: HELPER,
        statusUpdatedAt: 1700000000000,
        statusUpdatedByUid: OTHER_USER,
      },
    });
    expect(result.skipReason).toBeNull();
    expect(result.taskTitle).toBe('任務');
  });
});

describe('buildTaskStatusNotificationId — idempotency', () => {
  it('returns the same id for the same revision', () => {
    const id1 = buildTaskStatusNotificationId({
      eventId: 'event-1',
      taskId: 'task-1',
      statusRevision: 1700000000000,
      recipientUid: HELPER,
    });
    const id2 = buildTaskStatusNotificationId({
      eventId: 'event-1',
      taskId: 'task-1',
      statusRevision: 1700000000000,
      recipientUid: HELPER,
    });
    expect(id1).toBe(id2);
    expect(id1).toBe(`task-status_event-1_task-1_1700000000000_${HELPER}`);
  });

  it('produces different ids for different status revisions', () => {
    const a = buildTaskStatusNotificationId({
      eventId: 'event-1',
      taskId: 'task-1',
      statusRevision: 1700000000000,
      recipientUid: HELPER,
    });
    const b = buildTaskStatusNotificationId({
      eventId: 'event-1',
      taskId: 'task-1',
      statusRevision: 1700000001000,
      recipientUid: HELPER,
    });
    expect(a).not.toBe(b);
  });

  it('uses noversion sentinel when the source has no updatedAt', () => {
    const id = buildTaskStatusNotificationId({
      eventId: 'event-1',
      taskId: 'task-1',
      statusRevision: null,
      recipientUid: HELPER,
    });
    expect(id).toBe(`task-status_event-1_task-1_noversion_${HELPER}`);
  });
});

describe('statusRevision', () => {
  it('prefers statusUpdatedAt over updatedAt', () => {
    expect(
      statusRevision({ statusUpdatedAt: 1700000000000, updatedAt: 1699999999000 }),
    ).toBe(1700000000000);
  });

  it('falls back to updatedAt when statusUpdatedAt is absent', () => {
    expect(statusRevision({ updatedAt: 1700000000000 })).toBe(1700000000000);
  });

  it('falls back to Date.now() when both are missing', () => {
    const before = Date.now();
    const v = statusRevision({ title: 'no timestamps' });
    expect(v).toBeGreaterThanOrEqual(before);
  });
});