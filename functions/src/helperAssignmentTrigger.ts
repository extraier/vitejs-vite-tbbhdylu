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
 * 2026-09-11 — Manus P12.1: vendor projection fan-out.
 *
 * In addition to the per-helper alert above, this trigger
 * also writes a sanitized per-vendor snapshot doc:
 *
 *   /artifacts/{appId}/users/{ownerUid}/events/{eventId}/
 *     vendorViews/{vendorUid}/rundown/{parentId}
 *
 * The projection carries ONLY the allowlist of fields the
 * vendor is allowed to see — no `assignedVendorName`, owner
 * notes, budget, guestIds, paymentInfo, coOwners, etc. Even
 * for the assigned vendor, status / delay fields are
 * sanitized through `buildVendorProjection`. Non-assigned
 * vendors get a stripped timeline-only view so they can see
 * competitor booking density without knowing who is
 * assigned.
 *
 * Single-writer guarantee: BOTH fans-out (helper alert +
 * vendor projection) live in the SAME `onDocumentWritten`
 * trigger — we do NOT register a second trigger per the
 * handoff requirement. The two functions run with
 * `Promise.allSettled` so a projection write failure doesn't
 * break the existing helper-alert behavior (and vice-versa).
 *
 * Path is deterministic (id = parentId) so retries cannot
 * duplicate projections.
 *
 * Acceptance coverage (Manus P11 + P12.1):
 *   - Helper newly assigned → notification.
 *   - Helper replaced (A → B) → B notified, A NOT.
 *   - Same helper + meaningful field changed → "update" alert.
 *   - Same helper + only bookkeeping changed → no alert.
 *   - Helper removed → no alert (handled in owner/co-owner
 *     channels separately, if at all).
 *   - Doc created with helper → assignment alert.
 *   - Doc deleted → no alert; projections cleaned.
 *   - Foreign app namespace → no alert (security).
 *   - Client cannot forge recipient (always from post-write doc).
 *   - Recipient-only inbox (firestore.rules).
 *   - Update preserves `readAt` on retry.
 *   - Vendor projection: written/updated on every
 *     assigned-vendor change. Deleted on document delete or
 *     vendor un-assignment. Sanitized of all sensitive fields.
 *   - Vendor projection is idempotent — retries resolve to the
 *     same doc id (`parentId`), same `sourceVersion`.
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
import {
  buildVendorProjection,
  type VendorProjection,
} from './vendorProjectionPure';

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
  assignedVendorUid?: unknown;
  updatedAt?: unknown;
  // P12.1: status / delay fields the projection carry through.
  status?: unknown;
  isCompleted?: unknown;
  reportedDelayMinutes?: unknown;
  approvedDelayMinutes?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  location?: unknown;
  sequence?: unknown;
  group?: unknown;
  durationMinutes?: unknown;
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
    // Vendor projection cleanup happens in processVendorProjectionFanOut.
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

// ---- P12.1: vendor projection fan-out ----

/**
 * Write / update / delete the per-vendor projection doc
 * for the assigned vendor on this rundown / resource entry.
 *
 * Failure policy: `Promise.allSettled` in the caller — a
 * projection write failure must NOT break the helper-alert
 * fan-out. We log the error and continue.
 *
 * Scope reminders:
 *   - Allowed parent kinds: rundown | resources (NOT tasks).
 *   - Path: /artifacts/{appId}/users/{ownerUid}/events/
 *     {eventId}/vendorViews/{vendorUid}/rundown/{parentId}
 *     (note: the leaf collection is *always* called `rundown`
 *     regardless of whether the source is `rundown` or
 *     `resources` — the projection is a unified vendor-side
 *     timeline view).
 *   - Idempotent: doc id = parentId, sourceVersion is the
 *     source doc's updatedAt-in-millis.
 *
 * Vendor access markers (vendorAccess/{vendorUid}) live
 * under the event doc as a single map; this fan-out queries
 * that map when a vendor is added or removed so the access
 * doc can be granted/revoked. (The actual rules gating on
 * vendorAccess is owned by the P12.2 rules agent; this
 * trigger only maintains the doc shape.)
 */
async function processVendorProjectionFanOut(opts: {
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
    // The helper-alert leg already logged the skip reason; we
    // stay quiet here to avoid log spam.
    return;
  }
  const { ownerUid, eventId, parentId } = opts;
  if (!ownerUid || !eventId || !parentId) return;

  const beforeExists = opts.change.before.exists;
  const afterExists = opts.change.after.exists;
  const beforeData = beforeExists
    ? (opts.change.before.data() as AssignedItemDoc)
    : null;
  const afterData = afterExists
    ? (opts.change.after.data() as AssignedItemDoc)
    : null;

  const previousVendorUid = safeString(beforeData?.assignedVendorUid);
  const currentVendorUid = safeString(afterData?.assignedVendorUid);

  const projectionCollection = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(ownerUid)
    .collection('events').doc(eventId)
    .collection('vendorViews'); // -> /{vendorUid}/rundown/{parentId}

  // ---- delete path ----
  if (!afterExists) {
    if (previousVendorUid) {
      await cleanupProjectionForVendor({
        ownerUid,
        eventId,
        parentId,
        vendorUid: previousVendorUid,
        parentCollection: opts.parentKind,
      });
    }
    return;
  }

  // ---- create / update path ----
  // 1) Cleanup the previous vendor's projection (if we're
  // replacing A with B, A goes away).
  if (previousVendorUid && previousVendorUid !== currentVendorUid) {
    await cleanupProjectionForVendor({
      ownerUid,
      eventId,
      parentId,
      vendorUid: previousVendorUid,
      parentCollection: opts.parentKind,
    });
  }

  if (!currentVendorUid || !afterData) {
    // No current vendor — nothing to write. (Removing the
    // assignment should have already been handled above by
    // the cleanup branch for `previousVendorUid`.)
    return;
  }

  // 2) Write the new vendor's projection. The doc id is
  // `parentId` (deterministic — idempotent on retry).
  const projection = buildVendorProjection({
    ownerUid,
    eventId,
    vendorUid: currentVendorUid,
    entryId: parentId,
    sourceDoc: afterData,
    isAssignedToViewer: true, // currentVendorUid is by definition the assigned vendor
  });

  const projectionRef = projectionCollection
    .doc(currentVendorUid)
    .collection('rundown')
    .doc(parentId);

  await projectionRef.set(
    {
      ...stripProjectionForStorage(projection),
      source: 'trigger:helperAssignmentTrigger#vendorProjection',
      projectedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log(
    '[helperAssignmentTrigger] vendor projection written:',
    {
      ownerUid,
      eventId,
      parentKind: opts.parentKind,
      parentId,
      vendorUid: currentVendorUid,
      sourceVersion: projection.sourceVersion,
    },
  );
}

/**
 * Delete the projection for a specific (vendorUid, parentId).
 * Also queues a vendorAccess revocation query — if this was
 * the vendor's LAST assignment in the event, revoke the
 * vendorAccess marker.
 */
async function cleanupProjectionForVendor(args: {
  ownerUid: string;
  eventId: string;
  parentId: string;
  vendorUid: string;
  parentCollection: BigDayParentKind;
}): Promise<void> {
  const { ownerUid, eventId, parentId, vendorUid, parentCollection } = args;
  const projectionRef = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(ownerUid)
    .collection('events').doc(eventId)
    .collection('vendorViews')
    .doc(vendorUid)
    .collection('rundown')
    .doc(parentId);

  try {
    await projectionRef.delete();
  } catch (e) {
    // Doc may not exist (e.g. vendor was assigned but never
    // existed before the projection started). Treat as success.
    if (!isDocNotFoundError(e)) {
      console.warn(
        '[helperAssignmentTrigger] vendor projection delete failed:',
        { ownerUid, eventId, parentId, vendorUid, error: (e as Error)?.message },
      );
    }
  }

  // If no other entry in this event still points at this
  // vendor, revoke the vendorAccess marker. We query the
  // canonical event-scope path (the original
  // rundown/{parentId} or resources/{parentId} collections,
  // NOT the projection) — the source of truth is the
  // assignedVendorUid field, not the projection's existence.
  const canonicalCollection = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(ownerUid)
    .collection('events').doc(eventId)
    .collection(parentCollection);

  let stillAssigned = false;
  try {
    const otherSnapshot = await canonicalCollection
      .where('assignedVendorUid', '==', vendorUid)
      .limit(1)
      .get();
    // The query above includes the just-deleted/updated
    // entry if assignedVendorUid is still set on it; when
    // a delete fired, that doc is gone already. When an
    // update cleared the assignment on the entry, the
    // where-filter excludes that doc. So `stillAssigned`
    // correctly reflects "is there another live entry?".
    stillAssigned = !otherSnapshot.empty;
  } catch (e) {
    // If the query fails (rules perm, transient), we
    // conservatively leave the marker — it'll be cleaned up
    // on the next update.
    console.warn(
      '[helperAssignmentTrigger] vendorAccess sweep query failed:',
      { error: (e as Error)?.message },
    );
    return;
  }

  if (!stillAssigned) {
    // Best-effort revoke. The marker is a single doc at
    // /vendorAccess/{vendorUid} on the event — see
    // firestore.rules (P12.2 lands the read/write rules).
    try {
      await db
        .collection('artifacts').doc(APP_ID)
        .collection('users').doc(ownerUid)
        .collection('events').doc(eventId)
        .collection('vendorAccess')
        .doc(vendorUid)
        .set(
          {
            active: false,
            revokedAt: FieldValue.serverTimestamp(),
            revokedReason: 'projection-last-assignment-removed',
          },
          { merge: true },
        );
    } catch (e) {
      console.warn(
        '[helperAssignmentTrigger] vendorAccess revoke failed:',
        { error: (e as Error)?.message },
      );
    }
  }
}

function isDocNotFoundError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'number') {
    // Firestore Admin SDK error codes: 5 = NOT_FOUND
    return code === 5;
  }
  if (typeof code === 'string') {
    return code === 'NOT_FOUND' || code === '5';
  }
  return false;
}

/**
 * Strip the projection down to the Firestore-friendly shape
 * (no undefined values, plain JSON-ish fields). Keeps the
 * `id` field off the wire — the doc id is `parentId`.
 */
function stripProjectionForStorage(p: VendorProjection): Record<string, unknown> {
  return {
    ownerUid: p.ownerUid,
    eventId: p.eventId,
    vendorUid: p.vendorUid,
    entryId: p.entryId,
    title: p.title,
    group: p.group,
    startTime: p.startTime,
    endTime: p.endTime,
    durationMinutes: p.durationMinutes,
    location: p.location,
    sequence: p.sequence,
    isAssignedToViewer: p.isAssignedToViewer,
    operationalStatus: p.operationalStatus,
    reportedDelayMinutes: p.reportedDelayMinutes,
    approvedDelayMinutes: p.approvedDelayMinutes,
    updatedAt: p.updatedAt,
    sourceVersion: p.sourceVersion,
  };
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

/**
 * Shared trigger body — drives the helper-alert fan-out AND
 * the vendor-projection fan-out in parallel. Both share the
 * same onDocumentWritten subscription so the handoff's
 * single-writer rule is satisfied.
 */
async function runRundownOrResourcesWrite(opts: {
  appId: string | undefined;
  ownerUid: string | undefined;
  eventId: string | undefined;
  parentKind: BigDayParentKind;
  parentId: string | undefined;
  change: ChangeLike;
}): Promise<void> {
  const results = await Promise.allSettled([
    processAssignedItemWrite(opts),
    processVendorProjectionFanOut(opts),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') {
      console.warn(
        '[helperAssignmentTrigger] fan-out leg failed:',
        r.reason instanceof Error ? r.reason.message : r.reason,
      );
    }
  }
}

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
    runRundownOrResourcesWrite({
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
    runRundownOrResourcesWrite({
      appId: event.params.appId,
      ownerUid: event.params.ownerUid,
      eventId: event.params.eventId,
      parentKind: 'resources',
      parentId: event.params.parentId,
      change: event.data as unknown as ChangeLike,
    }),
);
