/**
 * 2026-08-31 — Manus P11.
 *
 * Task status-change alert trigger for assigned helpers.
 *
 * Subscribes to writes on:
 *
 *   /artifacts/{appId}/users/{ownerUid}/events/{eventId}/tasks/{taskId}
 *
 * When the task's `status` field changes AND a helper is assigned
 * AND the actor is not the helper themselves, it writes one
 * private notification to the helper's inbox:
 *
 *   /artifacts/{appId}/users/{helperUid}/notifications/
 *     task-status_{eventId}_{taskId}_{revision}_{helperUid}
 *
 * The recipient is the AFTER-snapshot's `assignedHelperUid` —
 * NEVER a client-supplied value (Manus §1.4, A4).
 *
 * Self-suppression: when the writer is the assigned helper
 * themselves (`statusUpdatedByUid === assignedHelperUid`), no
 * alert fires. The writer's identity is read from the source
 * doc — the Firestore rules enforce that `statusUpdatedByUid`
 * must equal `request.auth.uid` on every direct update (see
 * the helper update branch in firestore.rules).
 *
 * Fail-closed on missing actor: if `statusUpdatedByUid` is
 * absent from the after-snapshot, no alert fires. A missing
 * actor field is a malformed write that the rules should
 * reject; if a callable CF ever bypasses that, we still don't
 * notify the helper rather than risk a self-alert.
 *
 * Idempotency: deterministic doc id + `merge: true` so a
 * Cloud Functions retry rewrites the same doc without wiping
 * a recipient's existing `readAt`.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  buildTaskStatusNotificationId,
  resolveTaskStatusRecipient,
  statusRevision,
  validateTriggerPath,
} from './taskStatusPure';

try {
  initializeApp();
} catch (_) {
  // Admin SDK is a singleton — already initialized.
}

const APP_ID = 'savetheday-production';
const db = getFirestore();

interface ChangeLike {
  before: { exists: boolean; data: () => unknown };
  after: { exists: boolean; data: () => unknown };
}

const STATUS_LABEL_ZH: Record<string, string> = {
  'todo': '待辦',
  'in-progress': '進行中',
  'done': '已完成',
  'blocked': '受阻',
};

function labelFor(status: string | null): string {
  if (!status) return '已更新';
  return STATUS_LABEL_ZH[status] || status;
}

function actorLabel(role: string | null | undefined): string {
  if (role === 'owner' || role === 'co-owner') return '婚禮主人';
  if (role === 'vendor') return '商戶';
  if (role === 'helper') return '助手';
  return '團隊成員';
}

async function processTaskStatusWrite(opts: {
  appId: string | undefined;
  ownerUid: string | undefined;
  eventId: string | undefined;
  taskId: string | undefined;
  change: ChangeLike;
}): Promise<void> {
  const skipReason = validateTriggerPath({
    appId: opts.appId,
    ownerUid: opts.ownerUid,
    eventId: opts.eventId,
    parentKind: 'tasks',
    parentId: opts.taskId,
    allowedParentKinds: ['tasks'],
    expectedAppId: APP_ID,
  });
  if (skipReason) {
    if (skipReason === 'foreign-app') {
      console.warn('[taskStatusTrigger] foreign appId — skipping:', {
        appId: opts.appId,
        expected: APP_ID,
      });
    } else if (skipReason === 'missing-params') {
      console.warn('[taskStatusTrigger] missing path params — skipping:', opts);
    }
    return;
  }
  const { ownerUid, eventId, taskId } = opts;
  if (!ownerUid || !eventId || !taskId) return;

  const beforeData = opts.change.before.exists
    ? (opts.change.before.data() as Record<string, unknown>)
    : null;
  const afterData = opts.change.after.exists
    ? (opts.change.after.data() as Record<string, unknown>)
    : null;

  const result = resolveTaskStatusRecipient({ beforeData, afterData });
  if (!result.recipient) {
    if (result.skipReason && result.skipReason !== 'after-missing' && result.skipReason !== 'before-missing') {
      console.log(
        '[taskStatusTrigger] skip:',
        { taskId, skipReason: result.skipReason },
      );
    }
    return;
  }

  const revision = statusRevision(afterData);
  const notifId = buildTaskStatusNotificationId({
    eventId,
    taskId,
    statusRevision: revision,
    recipientUid: result.recipient,
  });

  const fromLabel = labelFor(result.fromStatus);
  const toLabel = labelFor(result.toStatus);
  const actorName = actorLabel(
    typeof afterData?.statusUpdatedByRole === 'string'
      ? afterData.statusUpdatedByRole
      : null,
  );
  const text = `任務「${result.taskTitle}」已由${actorName}由「${fromLabel}」更新為「${toLabel}」`;

  const notifRef = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(result.recipient)
    .collection('notifications')
    .doc(notifId);

  await notifRef.set(
    {
      type: 'task-status',
      notificationVersion: 1,
      recipientUid: result.recipient,
      ownerUid,
      eventId,
      taskId,
      kind: 'task',
      parentId: taskId,
      parentTitle: result.taskTitle,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      authorUid: result.actorUid,
      authorRole:
        typeof afterData?.statusUpdatedByRole === 'string'
          ? afterData.statusUpdatedByRole
          : null,
      text,
      createdAt: typeof revision === 'number' ? revision : FieldValue.serverTimestamp(),
      source: 'trigger:taskStatusTrigger',
      alertedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log(
    '[taskStatusTrigger] alert written:',
    {
      recipient: result.recipient,
      taskId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      notifId,
    },
  );
}

export const onTaskStatusWritten = onDocumentWritten(
  {
    document:
      'artifacts/{appId}/users/{ownerUid}/events/{eventId}/tasks/{taskId}',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    retry: true,
  },
  (event) =>
    processTaskStatusWrite({
      appId: event.params.appId,
      ownerUid: event.params.ownerUid,
      eventId: event.params.eventId,
      taskId: event.params.taskId,
      change: event.data as unknown as ChangeLike,
    }),
);