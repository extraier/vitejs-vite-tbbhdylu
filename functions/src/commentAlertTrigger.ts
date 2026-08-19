/**
 * 2026-08-17 — Bidirectional Big Day comment alert trigger (Manus step 12).
 *
 * Subscribes to every new comment doc written to
 *   /artifacts/{appId}/users/{ownerUid}/events/{eventId}/
 *     {parentKind}/{parentId}/comments/{commentId}
 *
 * For each comment, it:
 *   1. Reads the comment doc (event.params.* carries ownerUid,
 *      eventId, parentKind, parentId — commentId is the doc id).
 *   2. Reads the parent rundown/resources doc to fetch its
 *      `title` (for the bell preview) and `assignedVendorUid` /
 *      `assignedHelperUid`.
 *   3. Reads the event doc to fetch its `coOwners` array
 *      (active co-owners also receive an alert).
 *   4. Builds the recipient set via the pure helper
 *      `buildNotificationRecipients` from vendorComment.ts —
 *      one alert doc per recipient, written with deterministic
 *      id `bigday-comment_{commentId}_{recipientUid}` so retries
 *      don't duplicate (acceptance A5).
 *
 * Why a TRIGGER (and not the callable `vendorPostComment`):
 *   - Couples, co-owners, direct SDK writes, AND the vendor CF
 *     all converge on this single docs-create path.
 *   - Couples / co-owners posting a comment bypass
 *     `vendorPostComment` entirely (they go through the
 *     rules-engine path), so fanning out from the CF alone
 *     would miss their writes. The trigger catches all of them.
 *
 * Idempotency:
 *   - Recipients are derived AUTHORITATIVELY from server docs
 *     (parent + event), NEVER from the browser (Manus spec 1.4).
 *   - Each recipient's notification doc id is deterministic, so
 *     a Firestore trigger retry rewrites the same doc (A5).
 *   - Author is always excluded (A1, A2, A3).
 *
 * Acceptance coverage:
 *   A1 — vendor comment → owner + active co-owners receive
 *        (each = 1 unread, vendor self-suppressed).
 *   A2 — helper comment → owner + active co-owners receive.
 *   A3 — owner reply → assigned vendor + assigned helper
 *        receive; owner self-suppressed.
 *   A5 — retries → exactly one notification doc per recipient.
 *   A6 — recipient-only inbox (handled by firestore.rules).
 *   A7 — client update only readAt (handled by rules).
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  buildCommentNotificationId,
  buildNotificationRecipients,
} from './vendorComment';

try {
  initializeApp();
} catch (_) {
  // Already initialized — admin SDK is a singleton.
}

const APP_ID = 'savetheday-production';
const db = getFirestore();

interface CommentDoc {
  authorUid?: unknown;
  authorName?: unknown;
  authorRole?: unknown;
  text?: unknown;
  createdAt?: unknown;
  parentAssignedVendorUid?: unknown;
  parentAssignedHelperUid?: unknown;
}

interface ParentDoc {
  title?: unknown;
  assignedVendorUid?: unknown;
  assignedHelperUid?: unknown;
}

interface EventDoc {
  coOwners?: unknown;
}

export function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function safeCreatedAt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    try { return (value as { toMillis: () => number }).toMillis(); }
    catch { /* fall through */ }
  }
  return Date.now();
}

// 120-char preview helper — kept in sync with vendorComment.ts's
// `buildCommentAlertDoc` so the trigger and the CF produce the
// SAME preview string for the same input. Extracted here to avoid
// a circular import (vendorComment imports from this module).
export function truncatePreview(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * 2026-08-19 — Manus P0.1: pure validation extracted from the
 * trigger entry so the namespace guard is unit-testable without a
 * Firestore emulator. Returns null if the event should proceed,
 * or a short reason string if it should be skipped.
 *
 * Three short-circuit rules in priority order:
 *   1. App namespace guard — the wildcard accepts any appId but
 *      downstream writes use a hardcoded APP_ID constant, so a
 *      foreign-namespace write would either silently read from the
 *      production tree (data leak) or fan out using wrong context.
 *      Reject before any read happens.
 *   2. Required path params — Firestore normally guarantees these,
 *      but the typed shape is nullable and a wildcard miss would
 *      be silently destructive downstream.
 *   3. parentKind whitelisted — only 'rundown' and 'resources'
 *      are valid Big Day comment collections. Anything else is
 *      either a misconfigured caller or a future doc shape we
 *      don't fan out from yet.
 */
export function validateBigDayCommentEvent(opts: {
  appId: string | undefined;
  ownerUid: string | undefined;
  eventId: string | undefined;
  parentKind: string | undefined;
  parentId: string | undefined;
  commentId: string | undefined;
  expectedAppId: string;
}): null | 'foreign-app' | 'missing-params' | 'unknown-parent-kind' {
  const { appId, ownerUid, eventId, parentKind, parentId, commentId } = opts;
  // 2026-08-19 — Treat empty / whitespace-only strings the same
  // as missing. A wildcard miss that produces an empty param is
  // indistinguishable from a real null in this layer; downstream
  // `db.doc('').collection(...)` would throw with a confusing
  // error, so we surface the skip here.
  const isBlank = (v: string | undefined): boolean =>
    !v || !v.trim();
  if (!appId || appId !== opts.expectedAppId) return 'foreign-app';
  if (
    isBlank(ownerUid) ||
    isBlank(eventId) ||
    isBlank(parentKind) ||
    isBlank(parentId) ||
    isBlank(commentId)
  ) {
    return 'missing-params';
  }
  if (parentKind !== 'rundown' && parentKind !== 'resources') {
    return 'unknown-parent-kind';
  }
  return null;
}

export function safeParentTitle(value: unknown, parentKind: string): string {
  const t = safeString(value);
  if (t) return t;
  return parentKind === 'rundown' ? '大日流程' : '物資';
}

/**
 * Fire the trigger once per recipient — deterministic doc id
 * makes retries safe. Writes via Admin SDK (rules bypass).
 */
async function fanOutAlert(opts: {
  commentId: string;
  ownerUid: string;
  eventId: string;
  parentKind: 'rundown' | 'resources';
  parentId: string;
  parentTitle: string;
  authorUid: string;
  authorName: string;
  authorRole: 'vendor' | 'helper' | 'owner' | 'co-owner';
  text: string;
  createdAt: number;
  recipients: readonly string[];
}): Promise<void> {
  const preview = truncatePreview(opts.text);
  const baseInbox = db
    .collection('artifacts').doc(APP_ID)
    .collection('users');
  // Use a batched commit so multi-recipient fan-out is atomic-ish:
  // either every recipient gets their alert or none do (per the
  // batch's all-or-nothing semantics on the writes inside it).
  // Firestore best-practice for this exact use case.
  const batch = db.batch();
  for (const recipientUid of opts.recipients) {
    const notifId = buildCommentNotificationId(opts.commentId, recipientUid);
    const docRef = baseInbox
      .doc(recipientUid)
      .collection('notifications')
      .doc(notifId);
    batch.set(
      docRef,
      {
        type: 'bigday-comment',
        notificationVersion: 1,
        recipientUid,
        kind: opts.parentKind,
        parentId: opts.parentId,
        parentTitle: opts.parentTitle,
        commentId: opts.commentId,
        authorUid: opts.authorUid,
        authorName: opts.authorName,
        authorRole: opts.authorRole,
        text: preview,
        createdAt: opts.createdAt,
        ownerUid: opts.ownerUid,
        eventId: opts.eventId,
        source: 'trigger:commentAlertTrigger',
        // Server-write timestamp for ordering + audit.
        alertedAt: FieldValue.serverTimestamp(),
      },
      // merge=true so retries don't clobber an existing readAt
      // that the recipient already wrote. Critical: if a user
      // marks the alert read BEFORE the trigger retries, the
      // retry must NOT undo their readAt.
      { merge: true },
    );
  }
  await batch.commit();
  console.log(
    `[commentAlertTrigger] commentId=${opts.commentId} ` +
    `recipients=${opts.recipients.length} ` +
    `authorRole=${opts.authorRole}`,
  );
}

/**
 * Trigger entry point.
 *
 * Path shape (firestore v2 wildcard):
 *   artifacts/{appId}/users/{ownerUid}/events/{eventId}/
 *     {parentKind}/{parentId}/comments/{commentId}
 *
 * parentKind is constrained at the trigger level — we accept
 * 'rundown' and 'resources' and silently skip anything else
 * (e.g. accidental /events/{eventId}/vendors/{vendorId}/comments/
 * doc if the rules layer ever permitted it; better to skip than
 * to crash on an unrelated doc shape).
 *
 * 2026-08-19 — The handler body is exported as `runHandler` so
 * the unit tests can drive it directly with a fabricated event
 * (no Firestore emulator required). The `onDocumentCreated`
 * registration below is the thin Cloud Functions wrapper.
 */
export async function runHandler(event: {
  params: Record<string, string | undefined>;
  data?: { data: () => unknown };
}): Promise<void> {
  const params = event.params as {
    appId?: string;
    ownerUid?: string;
    eventId?: string;
    parentKind?: string;
    parentId?: string;
    commentId?: string;
  };
  const { appId, ownerUid, eventId, parentKind, parentId, commentId } = params;
  // 2026-08-19 — Manus P0.1: validate via the pure helper so the
  // rules are unit-tested without an emulator. The handler's
  // own logger is intentionally omitted for the foreign-app case
  // (validate is shared with future handlers and shouldn't carry
  // this trigger's logger).
  const skipReason = validateBigDayCommentEvent({
    appId,
    ownerUid,
    eventId,
    parentKind,
    parentId,
    commentId,
    expectedAppId: APP_ID,
  });
  if (skipReason === 'foreign-app') {
    console.warn(
      '[commentAlertTrigger] foreign appId — skipping:',
      { appId, expected: APP_ID, ownerUid, eventId, commentId },
    );
    return;
  }
  if (skipReason === 'missing-params') {
    console.warn(
      '[commentAlertTrigger] missing path params — skipping:',
      params,
    );
    return;
  }
  if (skipReason === 'unknown-parent-kind') {
    // Not a Big Day comment — let other triggers (if any) handle.
    return;
  }
  // After validation, params are non-null — narrow the type for TS.
  if (!ownerUid || !eventId || !parentKind || !parentId || !commentId) {
    return;
  }

  // Step 1: comment doc.
  const commentSnap = event.data;
  if (!commentSnap) {
    // Defensive — should not happen for onDocumentCreated.
    console.warn('[commentAlertTrigger] no data on event');
    return;
  }
  const commentRaw = commentSnap.data() as CommentDoc;
  const authorUid = safeString(commentRaw.authorUid);
  const authorName =
    safeString(commentRaw.authorName) || '未知用戶';
  const authorRoleRaw = safeString(commentRaw.authorRole);
  const authorRole: 'vendor' | 'helper' | 'owner' | 'co-owner' =
    authorRoleRaw === 'vendor' || authorRoleRaw === 'helper' ||
    authorRoleRaw === 'owner' || authorRoleRaw === 'co-owner'
      ? authorRoleRaw
      : 'vendor'; // safe fallback (better than skipping)
  const text = safeString(commentRaw.text) || '';
  const createdAt = safeCreatedAt(commentRaw.createdAt);

  // The authorUid is REQUIRED for self-suppression (A1/A2/A3).
  // A doc with no authorUid is malformed — skip rather than
  // risk fanning out to the wrong people.
  if (!authorUid) {
    console.warn(
      '[commentAlertTrigger] comment has no authorUid — skipping:',
      { commentId, ownerUid, eventId, parentId },
    );
    return;
  }

  // Step 2: parent rundown/resources doc.
  const parentRef = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(ownerUid)
    .collection('events').doc(eventId)
    .collection(parentKind).doc(parentId);
  let parentSnap;
  try {
    parentSnap = await parentRef.get();
  } catch (err) {
    // Transient read error — re-throw so the trigger retries.
    console.error('[commentAlertTrigger] parent read failed', err);
    throw err;
  }
  if (!parentSnap.exists) {
    // The parent was deleted between comment-write and trigger.
    // Spec 1.4 says "Abort safely if a source document has been
    // deleted" — log and exit cleanly.
    console.log(
      '[commentAlertTrigger] parent doc gone — aborting:',
      { ownerUid, eventId, parentKind, parentId },
    );
    return;
  }
  const parentData = parentSnap.data() as ParentDoc;
  const parentTitle = safeParentTitle(parentData.title, parentKind);
  const assignedVendorUid = safeString(parentData.assignedVendorUid);
  const assignedHelperUid = safeString(parentData.assignedHelperUid);

  // Step 3: event doc for coOwners.
  const eventRef = db
    .collection('artifacts').doc(APP_ID)
    .collection('users').doc(ownerUid)
    .collection('events').doc(eventId);
  let eventSnap;
  try {
    eventSnap = await eventRef.get();
  } catch (err) {
    console.error('[commentAlertTrigger] event read failed', err);
    throw err;
  }
  const eventData = eventSnap.exists ? (eventSnap.data() as EventDoc) : {};
  const coOwnersRaw = Array.isArray(eventData.coOwners)
    ? (eventData.coOwners as unknown[])
    : [];
  const activeCoOwnerUids = coOwnersRaw
    .filter((u): u is string => typeof u === 'string' && !!u.trim())
    .filter((u) => u !== ownerUid); // owner is already in the set

  // Step 4: build the recipient set via the pure helper.
  const { recipients, excluded } = buildNotificationRecipients({
    authorUid,
    ownerUid,
    assignedVendorUid,
    assignedHelperUid,
    activeCoOwnerUids,
  });

  // Step 5: fan out.
  if (recipients.length === 0) {
    // No recipients (author==owner, no co-owners, no assigned
    // vendor/helper). Spec §1.7 doesn't explicitly say to skip
    // in this case, but fanning out to nobody is a no-op.
    console.log(
      '[commentAlertTrigger] no recipients:',
      { commentId, authorUid, excluded },
    );
    return;
  }

  await fanOutAlert({
    commentId,
    ownerUid,
    eventId,
    parentKind: parentKind as 'rundown' | 'resources',
    parentId,
    parentTitle,
    authorUid,
    authorName,
    authorRole,
    text,
    createdAt,
    recipients,
  });
}

/**
 * Cloud Functions v2 trigger entry. Thin wrapper over the exported
 * `runHandler` so the unit tests can drive it directly.
 */
export const onBigDayCommentCreated = onDocumentCreated(
  {
    document:
      'artifacts/{appId}/users/{ownerUid}/events/{eventId}/{parentKind}/{parentId}/comments/{commentId}',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    retry: true, // re-run on transient errors; doc id is deterministic so safe
  },
  (event) => runHandler(event as unknown as {
    params: Record<string, string | undefined>;
    data?: { data: () => unknown };
  }),
);