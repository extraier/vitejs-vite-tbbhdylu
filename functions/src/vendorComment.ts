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
    if (
      typeof ownerUid !== 'string' || ownerUid.length < 4 ||
      typeof eventId !== 'string' || eventId.length < 4 ||
      typeof parentId !== 'string' || parentId.length < 2 ||
      typeof parentKind !== 'string' ||
      !PARENT_KINDS.has(parentKind as ParentKind)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'ownerUid, eventId, parentKind (rundown|resources), parentId required.',
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

    const parentRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('users').doc(ownerUid)
      .collection('events').doc(eventId)
      .collection(parentKind).doc(parentId);

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
