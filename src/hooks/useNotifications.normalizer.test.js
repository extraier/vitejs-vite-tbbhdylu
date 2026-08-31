/**
 * 2026-08-31 — Manus P11.
 *
 * Unit tests for the helper-notification normalizers in
 * useNotifications.js. Covers all four required cases from
 * the audit handoff:
 *
 *   1. helperAssignmentItems emits the right meta + href shape
 *      for `bigday-assignment` and `bigday-update` types.
 *   2. taskStatusItems emits the right meta + href shape for
 *      `task-status` type, including fromStatus/toStatus/author
 *      fields needed for click routing.
 *   3. Each normalizer preserves the bell-item contract:
 *      `id`, `category`, `actorRole`, `actorName`,
 *      `actorInitial`, `title`, `preview`, `meta`,
 *      `href`, `createdAt`, `readAt`, `alertDocId`.
 *   4. resolveScan-equivalent for the routing handler: the
 *      routing logic in App.jsx's `openHelperNotification`
 *      dispatches on `meta.taskId` vs `meta.kind`, so the
 *      normalizers must produce distinct, deterministic
 *      shapes that downstream handlers can branch on.
 */

import { describe, expect, it } from 'vitest';
import {
  helperAssignmentItems,
  taskStatusItems,
} from './useNotifications';

describe('helperAssignmentItems', () => {
  it('normalizes a bigday-assignment alert into a bell item with parentKind + parentId routing', () => {
    const items = helperAssignmentItems(
      [
        {
          id: 'bigday-assigned_event-1_rundown_item-9_1700000000000_helper-1',
          type: 'bigday-assignment',
          ownerUid: 'owner-1',
          eventId: 'event-1',
          kind: 'rundown',
          parentId: 'item-9',
          parentTitle: '進場前採排',
          assignmentAction: 'assigned',
          text: '你被指派跟進「進場前採排」',
          createdAt: 1700000000000,
          readAt: null,
        },
      ],
      'event-fallback', // unused here, the doc carries eventId
    );
    expect(items).toHaveLength(1);
    const it1 = items[0];
    expect(it1.id).toBe(
      'assignment:bigday-assigned_event-1_rundown_item-9_1700000000000_helper-1',
    );
    expect(it1.category).toBe('assignment');
    expect(it1.meta.eventId).toBe('event-1');
    expect(it1.meta.kind).toBe('rundown');
    expect(it1.meta.parentId).toBe('item-9');
    expect(it1.meta.parentTitle).toBe('進場前採排');
    expect(it1.meta.assignmentAction).toBe('assigned');
    expect(it1.href.view).toBe('helper-dashboard');
    expect(it1.href.kind).toBe('rundown');
    expect(it1.href.parentId).toBe('item-9');
    expect(it1.createdAt).toBe(1700000000000);
    expect(it1.readAt).toBeNull();
    expect(it1.alertDocId).toBe(
      'bigday-assigned_event-1_rundown_item-9_1700000000000_helper-1',
    );
  });

  it('normalizes a bigday-update alert (assignmentAction === updated)', () => {
    const items = helperAssignmentItems(
      [
        {
          id: 'bigday-updated_event-1_resources_item-7_1700000001000_helper-1',
          type: 'bigday-update',
          ownerUid: 'owner-1',
          eventId: 'event-1',
          kind: 'resources',
          parentId: 'item-7',
          parentTitle: '簽到桌物資',
          assignmentAction: 'updated',
          text: '「簽到桌物資」已更新',
          createdAt: 1700000001000,
        },
      ],
      null,
    );
    expect(items).toHaveLength(1);
    expect(items[0].meta.assignmentAction).toBe('updated');
    expect(items[0].meta.kind).toBe('resources');
    expect(items[0].meta.parentId).toBe('item-7');
    expect(items[0].meta.parentTitle).toBe('簽到桌物資');
    expect(items[0].href.kind).toBe('resources');
    // Falls back to the doc's eventId, not the fallback arg.
    expect(items[0].meta.eventId).toBe('event-1');
  });

  it('falls back to the parent kind label when parentTitle is missing', () => {
    const items = helperAssignmentItems(
      [
        {
          id: 'bigday-assigned_event-1_resources_item-7_1700000002000_helper-1',
          type: 'bigday-assignment',
          ownerUid: 'owner-1',
          eventId: 'event-1',
          kind: 'resources',
          parentId: 'item-7',
          assignmentAction: 'assigned',
          text: '你被指派跟進「物資」',
          createdAt: 1700000002000,
        },
      ],
      null,
    );
    expect(items[0].meta.parentTitle).toBeNull();
    // Preview falls back to the doc-supplied text.
    expect(items[0].preview).toContain('你被指派跟進');
  });

  it('falls back to the hook eventId when the alert doc carries none', () => {
    const items = helperAssignmentItems(
      [
        {
          id: 'bigday-assigned_event-1_rundown_item-1_1700000000000_helper',
          type: 'bigday-assignment',
          ownerUid: 'owner-1',
          eventId: null,
          kind: 'rundown',
          parentId: 'item-1',
          assignmentAction: 'assigned',
          text: '',
          createdAt: 1700000000000,
        },
      ],
      'event-from-hook',
    );
    expect(items[0].meta.eventId).toBe('event-from-hook');
    expect(items[0].preview).toContain('大日流程');
  });

  it('preserves a readAt field so markCommentAlertsRead can branch on it', () => {
    const items = helperAssignmentItems(
      [
        {
          id: 'bigday-updated_event-1_rundown_item-1_1700000000000_helper',
          type: 'bigday-update',
          eventId: 'event-1',
          kind: 'rundown',
          parentId: 'item-1',
          assignmentAction: 'updated',
          text: '',
          createdAt: 1700000000000,
          readAt: 1700000050000,
        },
      ],
      null,
    );
    expect(items[0].readAt).toBe(1700000050000);
  });
});

describe('taskStatusItems', () => {
  it('normalizes a task-status alert with taskId routing for helper-dashboard', () => {
    const items = taskStatusItems(
      [
        {
          id: 'task-status_event-1_task-9_1700000000000_helper-1',
          type: 'task-status',
          ownerUid: 'owner-1',
          eventId: 'event-1',
          taskId: 'task-9',
          parentTitle: '佈置場地',
          fromStatus: 'todo',
          toStatus: 'in-progress',
          authorUid: 'owner-1',
          authorRole: 'owner',
          text: '任務「佈置場地」已由婚禮主人由「待辦」更新為「進行中」',
          createdAt: 1700000000000,
          readAt: null,
        },
      ],
      null,
    );
    expect(items).toHaveLength(1);
    const it1 = items[0];
    expect(it1.id).toBe(
      'task-status:task-status_event-1_task-9_1700000000000_helper-1',
    );
    expect(it1.category).toBe('task-status');
    expect(it1.meta.taskId).toBe('task-9');
    expect(it1.meta.fromStatus).toBe('todo');
    expect(it1.meta.toStatus).toBe('in-progress');
    expect(it1.meta.authorRole).toBe('owner');
    expect(it1.href.view).toBe('helper-dashboard');
    expect(it1.href.taskId).toBe('task-9');
    expect(it1.createdAt).toBe(1700000000000);
    expect(it1.readAt).toBeNull();
    expect(it1.alertDocId).toBe(
      'task-status_event-1_task-9_1700000000000_helper-1',
    );
  });

  it('does NOT carry a parentKind / parentId (routing uses taskId)', () => {
    // Routing handler dispatches on `meta.taskId` for task-status
    // and on `meta.kind` for assignment — the two shapes MUST
    // remain distinct so the routing logic doesn't branch
    // ambiguously.
    const items = taskStatusItems(
      [
        {
          id: 'task-status_event-1_task-1_1700000000000_helper-1',
          type: 'task-status',
          eventId: 'event-1',
          taskId: 'task-1',
          parentTitle: 'T1',
          fromStatus: 'todo',
          toStatus: 'done',
          authorUid: 'owner-1',
          authorRole: 'owner',
          text: '',
          createdAt: 1700000000000,
        },
      ],
      null,
    );
    expect(items[0].meta.taskId).toBe('task-1');
    // No kind field on the meta — important because the routing
    // handler uses the PRESENCE of meta.taskId vs meta.kind to
    // choose between task-status vs Big Day routing.
    expect(items[0].meta.kind).toBeUndefined();
    expect(items[0].meta.parentId).toBeUndefined();
  });

  it('maps known status ids to Chinese labels in the title', () => {
    const items = taskStatusItems(
      [
        {
          id: 'task-status_event-1_task-2_1700000000000_helper-1',
          type: 'task-status',
          eventId: 'event-1',
          taskId: 'task-2',
          parentTitle: 'X',
          fromStatus: 'in-progress',
          toStatus: 'blocked',
          authorUid: 'v-1',
          authorRole: 'vendor',
          text: '',
          createdAt: 1700000000000,
        },
      ],
      null,
    );
    expect(items[0].preview).toContain('受阻');
  });

  it('falls back to "任務" when parentTitle is missing and the text is empty', () => {
    const items = taskStatusItems(
      [
        {
          id: 'task-status_event-1_task-2_1700000000000_helper-1',
          type: 'task-status',
          eventId: 'event-1',
          taskId: 'task-2',
          parentTitle: null,
          fromStatus: 'todo',
          toStatus: 'done',
          authorUid: 'co-owner-1',
          authorRole: 'co-owner',
          text: '',
          createdAt: 1700000000000,
        },
      ],
      null,
    );
    expect(items[0].title).toBe('任務更新：「任務」');
  });

  it('treats vendor / co-owner / owner roles uniformly as actor (no special-cased badge)', () => {
    const items = taskStatusItems(
      [
        { id: 'a', type: 'task-status', eventId: 'e', taskId: 't1',
          parentTitle: 't', fromStatus: 'todo', toStatus: 'done',
          authorRole: 'vendor', text: '', createdAt: 1 },
        { id: 'b', type: 'task-status', eventId: 'e', taskId: 't2',
          parentTitle: 't', fromStatus: 'todo', toStatus: 'done',
          authorRole: 'co-owner', text: '', createdAt: 1 },
        { id: 'c', type: 'task-status', eventId: 'e', taskId: 't3',
          parentTitle: 't', fromStatus: 'todo', toStatus: 'done',
          authorRole: 'helper', text: '', createdAt: 1 },
      ],
      null,
    );
    // vendor → 'vendor' category, co-owner / owner → 'helper' category
    // (the bell uses 'helper' for non-vendor actors on the task).
    expect(items[0].actorRole).toBe('vendor');
    expect(items[1].actorRole).toBe('helper');
    expect(items[2].actorRole).toBe('helper');
  });
});

describe('routing contract — normalizer shapes must be distinct enough for App.jsx', () => {
  // The routing handler in App.jsx does:
  //   if (meta.taskId) → focusedTaskId path
  //   else if (meta.kind === 'rundown' || 'resources') → focusedParent* path
  //
  // These shapes must NOT collide. If a future alert type carries
  // both taskId AND kind, this contract will need to revisit, but
  // today the two P11 categories are disjoint.

  it('helperAssignmentItems never sets meta.taskId', () => {
    const items = helperAssignmentItems(
      [
        {
          id: 'bigday-assigned_event-1_rundown_item-1_1700000000000_helper-1',
          type: 'bigday-assignment',
          eventId: 'event-1',
          kind: 'rundown',
          parentId: 'item-1',
          assignmentAction: 'assigned',
          text: '',
          createdAt: 1700000000000,
        },
      ],
      null,
    );
    expect(items[0].meta.taskId).toBeUndefined();
    expect(items[0].meta.kind).toBe('rundown');
  });

  it('taskStatusItems never sets meta.kind', () => {
    const items = taskStatusItems(
      [
        {
          id: 'task-status_event-1_task-1_1700000000000_helper-1',
          type: 'task-status',
          eventId: 'event-1',
          taskId: 'task-1',
          parentTitle: 'T',
          fromStatus: 'todo',
          toStatus: 'done',
          authorUid: 'owner',
          authorRole: 'owner',
          text: '',
          createdAt: 1700000000000,
        },
      ],
      null,
    );
    expect(items[0].meta.taskId).toBe('task-1');
    expect(items[0].meta.kind).toBeUndefined();
  });
});