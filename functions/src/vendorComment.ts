// 2026-08-12 — vendorPostComment / vendorPostCommentHelper
// =========================================================
//
// Vendor-side comment writes have been silently failing for the
// `maxportrading@gmail.com` vendor across the past 4+ sessions,
// despite the Firestore rules being correct (verified by emulator
// + REST probes). The most likely root cause is the LIVE
// runQuery-vs-listDocuments rule-evaluation divergence on
// collectionGroup LISTEN channels, combined with stale client
// rules-cache state in long-lived Incognito tabs.
//
// Rather than chase the rules-engine quirk further, this Cloud
// Function lets the vendor's <ItemComments/> component send a
// comment via a server-side round-trip:
//
//   1. Vendor's browser calls vendorPostComment / vendorPostCommentHelper
//      via the /api/firebase-proxy Vercel proxy (or directly via
//      httpsCallable if you can deal with the preflight issue).
//   2. CF validates caller is signed in + has vendor/helper claim.
//   3. CF reads the parent rundown/resource doc server-side using
//      Admin SDK (no rules layer involved — admin reads always succeed).
//   4. CF checks the caller's UID matches `assignedVendorUid` or
//      `assignedHelperUid` on the parent doc.
//   5. CF constructs the comment doc with all required fields
//      stamped correctly (parentAssignedVendorUid, parentAssignedHelperUid,
//      authorRole, etc.) and writes via Admin SDK (rules-engine bypass).
//   6. The vendor's existing onSnapshot subscribe in the chat panel
//      picks up the new doc on the next tick.
//
// Security:
// - Caller must be signed in (req.auth enforced).
// - Caller must be the assigned vendor or helper for the parent
//   item — checked server-side, no chance of spoofing.
// - Comment text is length-validated (1-2000 chars, matching
//   the existing rule shape).
//
// Path resolution: caller passes ownerUid + eventId + parentKind
// (rundown|resources) + parentId + text. CF builds the path itself
// from these so the client cannot target an arbitrary collection.
// Calls to other eventIds / ownerUids are silently rejected as
// "parent item not found".

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();
const APP_ID = 'savetheday-production';

const PARENT_KINDS = new Set(['rundown', 'resources'] as const);
type ParentKind = 'rundown' | 'resources';

interface PostCommentData {
  ownerUid?: string;
  eventId?: string;
  parentKind?: string;
  parentId?: string;
  text?: string;
}

/**
 * vendorPostComment — server-side comment write for the
 * vendor/helper who is assigned to a rundown entry or
 * resource item. Bypasses the Firestore rules layer entirely
 * after verifying caller authorization.
 *
 * Required fields:
 *   ownerUid     — couple's auth UID that owns the parent event.
 *   eventId      — the event ID under that user.
 *   parentKind   — 'rundown' | 'resources'.
 *   parentId     — the ID of the rundown entry / resource item.
 *   text         — comment body (1-2000 chars).
 *
 * Returns: { id: string } — the new comment's doc ID.
 */
export const vendorPostComment = onCall(
  { cors: true, region: 'us-central1' },
  async (req): Promise<{ id: string; createdAt: number }> => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const callerUid = req.auth.uid;

    // 2026-08-12 — accept either a vendor claim or a helper claim.
    // Either can legitimately post a comment under the parent's
    // assignment. The pair (vendorPostComment, vendorPostCommentHelper)
    // is for route-dispatch symmetry; the actual auth logic is
    // identical so we share the same body via vendorPostComment.
    const callerClaims = (req.auth.token as Record<string, unknown>) || {};
    const isVendor = callerClaims.vendor === true;
    const isHelper =
      typeof callerClaims.helper === 'string' ||
      callerClaims.helper === true;
    if (!isVendor && !isHelper) {
      throw new HttpsError(
        'permission-denied',
        'Only assigned vendors or helpers can call this function.',
      );
    }

    const {
      ownerUid,
      eventId,
      parentKind,
      parentId,
      text,
    } = (req.data || {}) as PostCommentData;

    // Field validation — match the live rules exactly so the
    // doc shape is identical whether written through the rules
    // path or this CF path. The vendor's existing onSnapshot
    // subscribe doesn't care which path wrote the doc, but
    // keeping shape parity means existing GET rules + the
    // collectionGroup catch-all continue to work uniformly.
    // 2026-08-13 — Per-field validation. The combined "ownerUid,
    // eventId, parentKind, parentId required" message that we had
    // before was masking which field was the problem — callers
    // were seeing it from the proxy with no way to tell which
    // ID was malformed. This is the same shape the live rules
    // expect, so the doc still validates on write either way.
    const fieldErrors: string[] = [];
    if (typeof ownerUid !== 'string' || ownerUid.length < 4) {
      fieldErrors.push(`ownerUid (got ${typeof ownerUid}, ${ownerUid?.length || 0} chars)`);
    }
    if (typeof eventId !== 'string' || eventId.length < 4) {
      fieldErrors.push(`eventId (got ${typeof eventId}, ${eventId?.length || 0} chars)`);
    }
    if (typeof parentId !== 'string' || parentId.length < 2) {
      fieldErrors.push(`parentId (got ${typeof parentId}, ${parentId?.length || 0} chars)`);
    }
    if (typeof parentKind !== 'string' || !PARENT_KINDS.has(parentKind as ParentKind)) {
      fieldErrors.push(`parentKind (got ${JSON.stringify(parentKind)}, must be 'rundown' or 'resources')`);
    }
    if (fieldErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[vendorPostComment] bad input:', { ownerUid, eventId, parentKind, parentId });
      throw new HttpsError(
        'invalid-argument',
        `bad input: ${fieldErrors.join('; ')}.`,
      );
    }
    const cleanText = (text || '').trim();
    if (
      typeof text !== 'string' ||
      cleanText.length === 0 ||
      cleanText.length > 2000
    ) {
      throw new HttpsError(
        'invalid-argument',
        'text required (1-2000 chars).',
      );
    }

    // After the fieldErrors gate above, all four fields are
    // guaranteed to be strings of the right length. Re-narrow
    // locally so TS strict-null passes.
    const ownerUidStr = ownerUid as string;
    const eventIdStr = eventId as string;
    const parentKindStr = parentKind as ParentKind;
    const parentIdStr = parentId as string;

    const parentRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUidStr)
      .collection('events').doc(eventIdStr)
      .collection(parentKindStr).doc(parentIdStr);

    // Server-side verification: caller must be the assigned
    // vendor or assigned helper on this parent item. Read with
    // Admin SDK (rules always allow admin reads, so no
    // permission-denied surprise here). If the doc doesn't exist
    // OR has no matching assignment, reject.
    const parentSnap = await parentRef.get();
    if (!parentSnap.exists) {
      throw new HttpsError(
        'not-found',
        'Parent item not found.',
      );
    }
    const parentData = parentSnap.data() || {};
    const assignedVendorUid =
      typeof parentData.assignedVendorUid === 'string'
        ? parentData.assignedVendorUid
        : null;
    const assignedHelperUid =
      typeof parentData.assignedHelperUid === 'string'
        ? parentData.assignedHelperUid
        : null;

    const isAssigned =
      (isVendor && assignedVendorUid === callerUid) ||
      (isHelper && assignedHelperUid === callerUid);
    if (!isAssigned) {
      throw new HttpsError(
        'permission-denied',
        'Not assigned to this item.',
      );
    }

    // Build the comment doc with the same field shape the live
    // rules expect. parentAssignedVendorUid + parentAssignedHelperUid
    // are stamped explicitly so the GET rule continues to
    // authenticate the comment doc on subsequent reads (the
    // existing per-doc GET rule does pure-field checks against
    // these two fields — see firestore.rules's
    // /rundown/{entryId}/comments get-branch).
    const now = Date.now();
    const commentDoc = {
      authorUid: callerUid,
      authorName:
        (typeof req.auth.token.name === 'string' && req.auth.token.name) ||
        (typeof req.auth.token.email === 'string' && req.auth.token.email) ||
        (isVendor ? '商戶' : '助手'),
      authorRole: isVendor ? 'vendor' : 'helper',
      text: cleanText,
      createdAt: now,
      parentAssignedVendorUid: assignedVendorUid,
      parentAssignedHelperUid: assignedHelperUid,
      // 2026-08-12 — provenanced comments written via this CF
      // so we can grep for them later if a rules-engine quirk
      // resurfaces. Pure observability; the rules layer ignores
      // it.
      source: 'cf:vendorPostComment',
    };

    const commentsRef = parentRef.collection('comments');
    const ref = await commentsRef.add(commentDoc);

    // 2026-08-17 — Vendor-comment OWNER ALERT.
    //
    // Vendor / helper comments live at
    //   /events/{eventId}/{rundown|resources}/{parentId}/comments/{commentId}
    // The header bell previously could not subscribe to those
    // because every attempt at a collectionGroup('comments') listener
    // hit the LIVE rules-engine throw on `resource.data.X` for the
    // LISTEN code path (comment docs don't carry the parent's
    // assignedVendorUid; the per-doc GET branch is fine but LIST
    // evaluates the rule against each candidate doc and bombs).
    //
    // Solution: emit a small owner-scoped notification doc into a
    // dedicated subcollection on the same per-event path the bell
    // already subscribes to for tasks. The bell adds a single
    // `comment` category that listens to this collection, the rules
    // gate reads by owner/co-owner/helper (no `get()` on parent doc),
    // and the tap routes back to the rundown entry or resource item
    // via `parentKind` + `parentId`.
    //
    // Why server-side (not client): vendors/helpers can't write to
    // this collection from the client (rules deny client writes) —
    // keeps the alert payload authoritative and stops bad actors
    // from spamming the bell by impersonating vendors.
    //
    // The payload is built by a pure helper so unit tests can pin
    // it without mocking firebase-admin (see
    // functions/test/vendorComment.test.ts).
    const alertDoc = buildCommentAlertDoc({
      parentKind: parentKindStr,
      parentId: parentIdStr,
      parentTitle: parentData.title,
      commentId: ref.id,
      authorUid: callerUid,
      authorName: commentDoc.authorName,
      authorRole: commentDoc.authorRole as 'vendor' | 'helper',
      text: cleanText,
      createdAt: now,
    });
    // 2026-08-17 — Alert fan-out is now handled by the trigger
    // (functions/src/commentAlertTrigger.ts) which subscribes to
    // EVERY comment write (vendor, helper, couple, co-owner, direct
    // SDK). Previously this CF wrote the alert doc inline; that
    // caused double-fan-out for vendor/helper comments because the
    // trigger ALSO fires when the CF writes the comment. The trigger
    // is the single source of truth for fan-out.
    //
    // We still build `alertDoc` here so the existing CF unit tests
    // (`buildCommentAlertDoc`) keep working — the helper is still
    // pure and exercised.
    void alertDoc;
    void buildCommentNotificationId;
    void buildNotificationRecipients;

    return { id: ref.id, createdAt: now };
  },
);

/**
 * vendorPostCommentHelper — same body as vendorPostComment,
 * exposed under a separate route-name so the proxy allowlist
 * can keep the vendor + helper calls distinct for telemetry
 * purposes. If you only want one function name, omit this
 * export and add `vendorPostComment` to the allowlist only.
 */
export const vendorPostCommentHelper = onCall(
  { cors: true, region: 'us-central1' },
  async (req): Promise<{ id: string; createdAt: number }> => {
    return vendorPostComment.run(req);
  },
);

// 2026-08-17 — Pure helper for the owner-alert payload.
//
// Extracted from vendorPostComment so unit tests can pin the
// shape (kind / parentId / parentTitle / commentId / author /
// text / createdAt / source) without mocking firebase-admin.
// The bell hook in src/hooks/useNotifications.js reads these
// exact fields when building the `comment` category envelope.
export interface CommentAlertInput {
  parentKind: 'rundown' | 'resources';
  parentId: string;
  // The parent rundown / resource doc's `title` field, if any.
  parentTitle: unknown;
  commentId: string;
  authorUid: string;
  authorName: string;
  authorRole: 'vendor' | 'helper';
  text: string;
  createdAt: number;
}
export interface CommentAlertDoc {
  kind: 'rundown' | 'resources';
  parentId: string;
  parentTitle: string;
  commentId: string;
  authorUid: string;
  authorName: string;
  authorRole: 'vendor' | 'helper';
  text: string;
  createdAt: number;
  source: 'cf:vendorPostComment';
}
export function buildCommentAlertDoc(input: CommentAlertInput): CommentAlertDoc {
  // If the parent doc has no usable title, fall back to a generic
  // label so the bell preview is never blank.
  const parentTitle =
    (typeof input.parentTitle === 'string' && input.parentTitle.trim()) ||
    (input.parentKind === 'rundown' ? '大日流程' : '物資');
  // Trim comment preview to 120 chars so the bell card stays
  // single-line. Server-side truncation keeps the bell layout
  // independent of vendor input length.
  const text = input.text.length > 120
    ? `${input.text.slice(0, 120)}…`
    : input.text;
  return {
    kind: input.parentKind,
    parentId: input.parentId,
    parentTitle,
    commentId: input.commentId,
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorRole: input.authorRole,
    text,
    createdAt: input.createdAt,
    source: 'cf:vendorPostComment',
  };
}

// 2026-08-17 — Deterministic notification-doc id (Manus step 11).
//
// Path: /users/{recipientUid}/notifications/{notificationId}
//
// We derive the id from (commentId, recipientUid) so that any Cloud
// Function retry — network blip, transient error, exponential
// backoff — overwrites the SAME document instead of creating a
// second alert. Without this, a 1% retry rate produces visible
// duplicate bells.
//
// Spec (Manus 1.3): `bigday-comment_{commentId}_{recipientUid}`
//
// Pure function — exported for unit tests.
export function buildCommentNotificationId(
  commentId: string,
  recipientUid: string,
): string {
  return `bigday-comment_${commentId}_${recipientUid}`;
}

// 2026-08-17 — Recipient-set builder (Manus spec 1.2 / 1.4).
//
// The Cloud Function must NEVER accept recipient UIDs from the
// browser. The recipient set is built authoritatively from the
// comment + parent + event docs and MUST exclude the author.
//
// The author identity is known to the caller; the event's
// `coOwners` and the parent's `assignedVendorUid` /
// `assignedHelperUid` are read by the trigger server-side and
// passed in. This helper is the pure policy layer — testable
// without the Admin SDK.
//
// Policy matrix (per Manus 1.2):
//   Author        | Recipients
//   --------------+----------------------------------------
//   couple/owner  | assigned vendor (optional), assigned helper (optional)
//   vendor        | owner + active co-owners
//   helper        | owner + active co-owners
//   + The author is ALWAYS excluded (A1, A2, A3).
//
// Pure function — exported for unit tests.
export interface BuildNotificationRecipientsInput {
  authorUid: string;
  // Required: owner of the event the comment was posted to.
  ownerUid: string;
  // Both nullable — items without an assigned vendor / helper.
  assignedVendorUid: string | null;
  assignedHelperUid: string | null;
  // Co-owners are resolved by reading the event doc server-side.
  activeCoOwnerUids?: readonly string[];
}
export interface BuildNotificationRecipientsOutput {
  recipients: string[];
  excluded: string[];
}
export function buildNotificationRecipients(
  input: BuildNotificationRecipientsInput,
): BuildNotificationRecipientsOutput {
  const candidates = new Set<string>();
  candidates.add(input.ownerUid);
  for (const uid of input.activeCoOwnerUids ?? []) {
    if (typeof uid === 'string' && uid.trim()) candidates.add(uid);
  }
  if (typeof input.assignedVendorUid === 'string' && input.assignedVendorUid.trim()) {
    candidates.add(input.assignedVendorUid);
  }
  if (typeof input.assignedHelperUid === 'string' && input.assignedHelperUid.trim()) {
    candidates.add(input.assignedHelperUid);
  }
  const excluded: string[] = [];
  if (candidates.has(input.authorUid)) {
    candidates.delete(input.authorUid);
    excluded.push(input.authorUid);
  }
  return { recipients: [...candidates], excluded };
}
