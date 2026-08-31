/**
 * 2026-08-31 — Manus P11.
 *
 * Big Day assignment / item-update alert trigger. Subscribes to
 * writes on:
 *
 *   /artifacts/{appId}/users/{ownerUid}/events/{eventId}/
 *     rundown/{parentId}
 *   /artifacts/{appId}/users/{ownerUid}/events/{eventId}/
 *     resources/{parentId}
 *
 * For each meaningful write, it derives the helper recipient
 * from the POST-write document (the recipient is NEVER taken
 * from a client-supplied payload — Manus §1.4, A4), and writes
 * a deterministic notification to:
 *
 *   /artifacts/{appId}/users/{recipientUid}/notifications/
 *     bigday-{kind}_{eventId}_{parentKind}_{parentId}_{version}_{recipientUid}
 *
 * The decision tree is in `helperAssignmentPure.resolveAssignment
 * Recipient`. This file only wraps the pure helper with the
 * Firestore reads + writes + Admin SDK plumbing.
 *
 * Idempotency: deterministic doc id + `merge: true` so a
 * Cloud Functions retry rewrites the same doc without
 * clobbering a recipient's existing `readAt`.
 *
 * Two thin wrappers are exported because the project's
 * Cloud Functions runtime does not yet support multi-pattern
 * registration for a single `onDocumentWritten`. Each wrapper
 * parses its own path params and calls `processAssignedItemWrite`
 * with the normalized shape.
 *
 * Acceptance coverage (Manus P11):
 *   - Helper newly assigned → notification.
 *   - Helper replaced (A → B) → B notified, A NOT.
 *   - Same helper + meaningful field changed → "update" alert.
 *   - Same helper + only bookkeeping changed → no alert.
 *   - Helper removed → no alert (handled in owner/co-owner
 *     channels separately, if at all).
 *   - Doc created with helper → assignment alert.
 *   - Doc deleted → no alert.
 *   - Foreign app namespace → no alert (security).
 *   - Client cannot forge recipient (always from post-write doc).
 *   - Recipient-only inbox (firestore.rules).
 *   - Update preserves `readAt` on retry.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  AssignmentAction,
  BigDayParentKind,
  buildAssignmentNotificationId,
  resolveAssignmentRecipient,
  sourceVersion,
  validateTriggerPath,
} from './helperAssignmentPure';

try {
  initializeApp();
} catch (_) {
  // Admin SDK is a singleton — already initialized.
}

const APP_ID = 'savetheday-production';
const db = getFirestore();

interface AssignedItemDoc {
  title?: unknown;
  assignedHelperUid?: unknown;
  assignedHelperName?: unknown;
  updatedAt?: unknown;
}

interface ChangeLike {
  before: { exists: boolean; data: () => unknown };
  after: { exists: boolean; data: () => unknown };
}

/**
 * Shared handler for both rundown + resources writes. The
 * caller passes the wildcard-resolved `parentKind` (already
 * validated) and the `event.params` from the trigger event.
 */
async function processAssignedItemWrite(opts: {
  appId: string | undefined;
  ownerUid: string | undefined;
  eventId: string | undefined;
  parentKind: BigDayParentKind;
  parentId: string | undefined;
  change: ChangeLike;
}): Promise<void> {
  const skipReason = validateTriggerPath({
    appId: opts.appId,
    ownerUid: opts.ownerUid,
    eventId: opts.eventId,
    parentKind: opts.parentKind,
    parentId: opts.parentId,
    allowedParentKinds: ['rundown', 'resources'],
    expectedAppId: APP_ID,
  });
  if (skipReason) {
    if (skipReason === 'foreign-app') {
      console.warn('[helperAssignmentTrigger] foreign appId — skipping:', {
        appId: opts.appId,
        expected: APP_ID,
      });
    } else if (skipReason === 'missing-params') {
      console.warn('[helperAssignmentTrigger] missing path params — skipping:', opts);
    }
    return;
  }

  const { ownerUid, eventId, parentKind, parentId } = opts;
  if (!ownerUid || !eventId || !parentId) return; // narrowed by validateTriggerPath

  // Step 1: read the before/after snapshots.
  const beforeExists = opts.change.before.exists;
  const afterExists = opts.change.after.exists;
  if (!afterExists) {
    // Doc was deleted — no helper alert (handoff table row 6).
    return;
  }
  const beforeData = beforeExists
    ? (opts.change.before.data() as AssignedItemDoc)
    : null;
  const afterData = opts.change.after.data() as AssignedItemDoc;

  const previousHelperUid = safeString(beforeData?.assignedHelperUid);
  const currentHelperUid = safeString(afterData.assignedHelperUid);

  // Build a synthetic changedKeys list for the pure helper.
  // The trigger doesn't carry `affectedKeys()` in this context
  // (we read via get()), so we diff the keys ourselves. The
  // pure helper treats this as a hint — the meaningful-field
  // allowlist already filters out bookkeeping noise.
  const changedKeys = diffKeys(
    beforeExists ? (beforeData as unknown as Record<string, unknown>) : null,
    afterData as unknown as Record<string, unknown>,
  );

  // Step 2: resolve recipient via the pure helper.
  const { recipient, action } = resolveAssignmentRecipient({
    beforeData: beforeExists
      ? (beforeData as unknown as Record<string, unknown>)
      : null,
    afterData: afterData as unknown as Record<string, unknown>,
    changedKeys,
    previousHelperUid,
    currentHelperUid,
  });

  if (!recipient) {
    console.log(
      '[helperAssignmentTrigger] no recipient:',
      { ownerUid, eventId, parentKind, parentId, action },
    );
    return;
  }

  // Step 3: build the deterministic notification id + payload.
  const version = sourceVersion(afterData as Record<string, unknown>);
  const notifId = buildAssignmentNotificationId({
    kind: action,
    eventId,
    parentKind,
    parentId,
    version,
    recipientUid: recipient,
  });
  const parentTitle = safeTitle(afterData.title, parentKind);
  const text =
    action === 'assigned'
      ? `你被指派跟進「${parentTitle}」`
      : `「${parentTitle}」已更新`;

  const notifRef = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(recipient)
    .collection('notifications')
    .doc(notifId);

  // merge: true is critical — a recipient who already marked
  // the alert read must NOT see their `readAt` wiped on retry.
  await notifRef.set(
    {
      type: action === 'assigned' ? 'bigday-assignment' : 'bigday-update',
      notificationVersion: 1,
      recipientUid: recipient,
      ownerUid,
      eventId,
      kind: parentKind,
      parentId,
      parentTitle,
      assignmentAction: action as AssignmentAction,
      text,
      createdAt: typeof version === 'number' ? version : FieldValue.serverTimestamp(),
      source: 'trigger:helperAssignmentTrigger',
      alertedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log(
    '[helperAssignmentTrigger] alert written:',
    {
      recipient,
      parentKind,
      parentId,
      action,
      notifId,
    },
  );
}

// ---- Helpers ----

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeTitle(value: unknown, parentKind: string): string {
  const t = safeString(value);
  if (t) return t;
  return parentKind === 'rundown' ? '大日流程' : '物資';
}

function diffKeys(
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown>,
): string[] {
  const keys = new Set<string>();
  for (const k of Object.keys(beforeData || {})) keys.add(k);
  for (const k of Object.keys(afterData || {})) keys.add(k);
  return Array.from(keys);
}

// ---- Cloud Functions v2 wrappers ----

export const onRundownAssignedItemWritten = onDocumentWritten(
  {
    document:
      'artifacts/{appId}/users/{ownerUid}/events/{eventId}/rundown/{parentId}',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    retry: true,
  },
  (event) =>
    processAssignedItemWrite({
      appId: event.params.appId,
      ownerUid: event.params.ownerUid,
      eventId: event.params.eventId,
      parentKind: 'rundown',
      parentId: event.params.parentId,
      change: event.data as unknown as ChangeLike,
    }),
);

export const onResourcesAssignedItemWritten = onDocumentWritten(
  {
    document:
      'artifacts/{appId}/users/{ownerUid}/events/{eventId}/resources/{parentId}',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    retry: true,
  },
  (event) =>
    processAssignedItemWrite({
      appId: event.params.appId,
      ownerUid: event.params.ownerUid,
      eventId: event.params.eventId,
      parentKind: 'resources',
      parentId: event.params.parentId,
      change: event.data as unknown as ChangeLike,
    }),
);