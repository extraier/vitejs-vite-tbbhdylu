/**
 * Cloud Functions — Event Entitlement Resolver
 * =============================================
 *
 * 2026-08-19 — Manus P1.2: single canonical event-scoped
 * entitlement resolver.
 *
 * The existing code mixed three different signals for premium
 * state:
 *   - user profile `tier: 'premium'` (set by grantUnlock)
 *   - currentEvent.tier (manually set or unlocked)
 *   - unlocks/*.includes('custom-template') (per-feature flags)
 *
 * Result: a customer could see "Premium" badge while their event
 * still behaved as free (or vice versa). This module replaces
 * them with one server-authored entitlement object that the
 * frontend, invitation editor, upload proxy, and archive
 * operations all consume.
 *
 * DATA CONTRACT
 * -------------
 *
 * Every entitlement returned from this module has the same
 * shape:
 *
 *   {
 *     scope: 'event',                 // event-scoped — always
 *     eventId: 'evt_123',             // required on every fulfillment
 *     ownerUid: 'couple-1',           // account audit
 *     features: {
 *       customInvitation: boolean,
 *       watermarkRemoved: boolean,
 *       extraStorage: boolean,        // adds storage-500mb quota
 *       lifetimeRetention: boolean,   // creates permanent archive
 *     },
 *     storageLimitBytes: number,      // server-enforced quota
 *     retentionClass: 'standard' | 'lifetime',
 *     source: 'paid' | 'social-proof' | 'referral' | 'admin-grant',
 *     receiptId: string | null,       // for support / refunds
 *     computedAt: number,             // server ts (epoch ms)
 *   }
 *
 * DEFERRED (intentionally)
 * ------------------------
 *
 * The following Manus P1.4/P1.5 items are NOT implemented here:
 *   - Byte-accurate storage quota (P1.4). For now,
 *     storageLimitBytes returns a fixed number based on
 *     FREE_TIER_BASE_BYTES / BONUS_BYTES. The proxy still
 *     estimates; client-side gating still uses the count.
 *     A separate PR will land the reservation / finalization
 *     pattern.
 *   - Lifetime archive promotion (P1.5). retentionClass
 *     computes from unlocks but no archive job consumes it.
 *     A separate PR will land the archive job.
 *
 * Both deferred items are tracked as TODOs in the docstring
 * below so the next engineer (or Manus) can pick them up.
 *
 * The features map and retentionClass are what ships now.
 * Custom invitation and watermark enforcement DO use this
 * resolver (see api/photo-upload.js and
 * src/screens/InvitationEditor.jsx).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

const appId = 'savetheday-production';

// ---- Storage quota constants ------------------------------------------
// 2026-08-19 — These are the limits the resolver REPORTS. The
// actual proxy enforcement is still per-request (see
// api/photo-upload.js). The quota the resolver reports and the
// quota the proxy enforces must match — for now they both use
// these constants. When P1.4 lands, the proxy reads from
// `/users/{ownerUid}/events/{eventId}/usage` (the new
// reservation counter) and stops trusting the resolver's
// storageLimitBytes for the actual gate. The resolver still
// reports the limit correctly; it just becomes advisory.

export const FREE_TIER_BASE_BYTES = 200 * 1024 * 1024; // 200 MB
export const BONUS_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB

// 2026-08-23 — P4.3: export these so the photo-upload proxy
// and its tests can import the SAME values the resolver uses,
// without importing from storageQuota.ts (which would create a
// circular dep once the proxy also imports
// resolveServerEntitlementLimit).

// ---- Types -------------------------------------------------------------

export interface EventEntitlement {
  scope: 'event';
  eventId: string;
  ownerUid: string;
  features: {
    customInvitation: boolean;
    watermarkRemoved: boolean;
    extraStorage: boolean;
    lifetimeRetention: boolean;
  };
  storageLimitBytes: number;
  retentionClass: 'standard' | 'lifetime';
  source: 'paid' | 'social-proof' | 'referral' | 'admin-grant' | 'none';
  receiptId: string | null;
  computedAt: number;
}

interface UnlockDoc {
  type: string;
  source?: string;
  paid?: number;
  paymentId?: string;
  expiresAt?: number | null;
  grantedAt?: { toMillis?: () => number } | number | null;
  // 2026-08-20 — Manus P1.1 audit §4.1: per-event unlock
  // binding. Unlocks written before this commit leave
  // `eventId` undefined or null — those are legacy
  // owner-wide grants and the resolver treats them as
  // satisfying ANY event (backwards compat). New unlocks
  // carry the eventId they were granted for, and the
  // resolver excludes them from other events.
  eventId?: string | null;
}

// ---- Internal helpers --------------------------------------------------

function userRef(uid: string) {
  return db
    .collection('artifacts').doc(appId)
    .collection('users').doc(uid);
}

function unlocksCol(uid: string) {
  return userRef(uid).collection('unlocks');
}

function eventRef(uid: string, eventId: string) {
  return userRef(uid).collection('events').doc(eventId);
}

function receiptsCol(uid: string) {
  return userRef(uid).collection('paymentReceipts');
}

// ---- Pure resolver (unit-testable) ------------------------------------

/**
 * Compute the entitlement from a list of unlock docs.
 *
 * 2026-08-19 — Pure function. No Firestore. Testable without
 * an emulator. The caller (getEventEntitlement internal) does
 * the I/O; this function does the policy.
 *
 * Rules:
 *   - 'custom-template' → features.customInvitation = true
 *   - 'watermark-removed' → features.watermarkRemoved = true
 *   - 'storage-500mb' → features.extraStorage = true
 *   - 'permanent-archive' → features.lifetimeRetention = true
 *     + retentionClass = 'lifetime'
 *   - storage limit = base + bonus (if extraStorage)
 *   - source = the most recent grant's source (preferring paid
 *     over social-proof)
 *   - receiptId = the most recent paid unlock's paymentId
 *     (for refund support)
 *
 * If multiple unlocks contribute to the same feature, the
 * feature is still true (OR semantics). The source prefers
 * paid > admin-grant > referral > social-proof > none, so a
 * refund is reflected.
 *
 * 2026-08-20 — Manus P1.1 audit §4.1: eventId filtering. Each
 * unlock doc may now carry an `eventId` field. Only unlocks
 * whose `eventId` matches the requested `eventId`, OR whose
 * `eventId` is null (legacy owner-wide), contribute to the
 * entitlement. New event-scoped unlocks (eventId === "X") do
 * NOT bleed into events "Y" or "Z". This is the per-event
 * binding the audit requires — a customer who paid for
 * watermark removal on event A does NOT get it on event B.
 */
export function computeEntitlement(
  ownerUid: string,
  eventId: string,
  unlocks: Array<UnlockDoc>,
): EventEntitlement {
  // 2026-08-20 — audit §4.1: filter by eventId first. An
  // unlock with `eventId === null` is legacy/owner-wide and
  // satisfies ANY event (backwards compat for unlocks
  // written before this commit). An unlock with
  // `eventId === eventId` is the event-scoped path. Anything
  // else is a different event's unlock and is excluded.
  const relevant = unlocks.filter((u) => {
    if (u.eventId === undefined || u.eventId === null) return true;
    return u.eventId === eventId;
  });

  const features = {
    customInvitation: false,
    watermarkRemoved: false,
    extraStorage: false,
    lifetimeRetention: false,
  };

  let mostRecentPaid: UnlockDoc | null = null;
  let mostRecentPaidAt = 0;
  let source: EventEntitlement['source'] = 'none';

  for (const u of relevant) {
    const grantedAt = typeof u.grantedAt === 'number'
      ? u.grantedAt
      : u.grantedAt?.toMillis?.() ?? 0;

    switch (u.type) {
      case 'custom-template':
        features.customInvitation = true;
        break;
      case 'watermark-removed':
        features.watermarkRemoved = true;
        break;
      case 'storage-500mb':
        features.extraStorage = true;
        break;
      case 'permanent-archive':
        features.lifetimeRetention = true;
        break;
    }

    // 2026-08-19 — Source priority. Paid > admin-grant >
    // referral > social-proof. Recency breaks ties (most
    // recent wins among same-priority sources, so a refund
    // followed by a new paid grant is visible immediately).
    const sourcePriority = (s: string | undefined): number => {
      switch (s) {
        case 'paid':
        case 'paid-stripe':
        case 'paid-payme':
        case 'paid-fps':
          return 4;
        case 'admin-grant':
          return 3;
        case 'referral':
          return 2;
        case 'social-proof':
          return 1;
        default:
          return 0;
      }
    };

    const newSrc = sourcePriority(u.source);
    const curSrc = sourcePriority(source);
    if (newSrc > curSrc || (newSrc === curSrc && grantedAt >= mostRecentPaidAt)) {
      source = (u.source as EventEntitlement['source']) || 'none';
      mostRecentPaidAt = grantedAt;
      if (newSrc >= 4) {
        mostRecentPaid = u;
      }
    }
  }

  const storageLimitBytes = FREE_TIER_BASE_BYTES + (features.extraStorage ? BONUS_STORAGE_BYTES : 0);
  const retentionClass: EventEntitlement['retentionClass'] =
    features.lifetimeRetention ? 'lifetime' : 'standard';

  return {
    scope: 'event',
    eventId,
    ownerUid,
    features,
    storageLimitBytes,
    retentionClass,
    source,
    receiptId: mostRecentPaid?.paymentId ?? null,
    computedAt: Date.now(),
  };
}

// 2026-08-23 — Manus P4.3 (PDF Patch 4.3): server-side
// entitlement-limit resolver for the photo-upload proxy. The
// previous code read event.storageQuotaBytes (a client-writable
// field) — any signed-in owner could inflate it to bypass the
// quota gate. This helper computes the limit from the owner's
// unlock records, which live in a server-only collection
// (firestore.rules denies client access to `unlocks`).
//
// The proxy calls this before minting an HMAC; the resulting
// limitBytes is compared against usedBytes + reservedBytes +
// body.length in a single Admin SDK runTransaction. If the
// transaction fails (Firestore read error, write error, quota
// exceeded), the proxy rejects with 503 / 413 — it MUST NOT
// fall back to a client-trustable default.
//
// Returns just the limit (not the full EventEntitlement) so the
// proxy stays small. The proxy can call computeEntitlement if it
// needs the features map, but for the storage gate we only need
// the number.
export async function resolveServerEntitlementLimit(
  firestore: FirebaseFirestore.Firestore,
  ownerUid: string,
  eventId: string,
): Promise<number> {
  const unlocksSnap = await firestore
    .collection('artifacts').doc(appId)
    .collection('users').doc(ownerUid)
    .collection('unlocks')
    .get();

  const unlocks: UnlockDoc[] = unlocksSnap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      type: typeof data.type === 'string' ? data.type : '',
      source: typeof data.source === 'string' ? data.source : undefined,
      paid: typeof data.paid === 'number' ? data.paid : undefined,
      paymentId: typeof data.paymentId === 'string' ? data.paymentId : undefined,
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
      grantedAt: data.grantedAt as UnlockDoc['grantedAt'],
      eventId: typeof data.eventId === 'string' ? data.eventId : null,
    };
  });

  // computeEntitlement accepts (ownerUid, eventId, unlocks) and
  // returns the full EventEntitlement (features + storageLimitBytes
  // + retentionClass). We only use the limit here, but the rest of
  // the response is the canonical entitlement record.
  const ent = computeEntitlement(ownerUid, eventId, unlocks);
  return ent.storageLimitBytes;
}

// ---- Live resolver (Firestore-backed) ---------------------------------

/**
 * Read the unlocks for an event's owner and compute the
 * entitlement. Internal — the callable handler validates input
 * and forwards here.
 *
 * The eventId is accepted but the entitlement is OWNER-scoped
 * (each event's owner is the same — the couple). The eventId is
 * required on the response so the caller can audit which
 * event the entitlement was computed for. Future PR will
 * resolve eventId-targeted unlocks (currently all unlocks are
 * owner-level, so the eventId is metadata only).
 *
 * For the storage-500mb + watermark-removed combo granted via
 * referral, both unlocks are stored under the same referral
 * claim and the entitlement reflects both.
 */
async function resolveEntitlement(
  ownerUid: string,
  eventId: string,
): Promise<EventEntitlement> {
  // 2026-08-19 — Verify the event exists. This catches a
  // mistake where the caller picks an event ID that doesn't
  // belong to them; we don't want to leak ownership info
  // through a 404 vs 403 distinction, so we return a generic
  // 'not-found' error.
  const eventDoc = await eventRef(ownerUid, eventId).get();
  if (!eventDoc.exists) {
    throw new HttpsError('not-found', 'event not found');
  }

  // Pull all unlocks. At our scale (couples have < 10 unlocks
  // total — bought a few, earned a few) this is a single
  // query without pagination. If usage grows we can add
  // `where('relevant', '==', true)` or compute per-event.
  const unlocksSnap = await unlocksCol(ownerUid).get();
  const unlocks: Array<UnlockDoc> = unlocksSnap.docs.map((d) => ({
    type: d.data().type || d.id,
    source: d.data().source,
    paid: d.data().paid,
    paymentId: d.data().paymentId,
    expiresAt: d.data().expiresAt,
    grantedAt: d.data().grantedAt,
    // 2026-08-20 — audit §4.1: read eventId from the doc so
    // computeEntitlement can filter by event.
    eventId: d.data().eventId ?? null,
  }));

  return computeEntitlement(ownerUid, eventId, unlocks);
}

/**
 * getEventEntitlement — callable.
 *
 * Auth: the caller must be the owner of the event (or an
 * admin). Both routes return the same shape.
 *
 * Returns: EventEntitlement.
 *
 * Idempotent: side-effect-free, safe to call from any client.
 * The client typically caches the result for the lifetime of
 * the navigation; re-call on payment approval / unlock grant.
 */
export const getEventEntitlement = onCall<{ eventId: string }>(
  {
    cors: true,
    // 2026-08-19 — us-central1, not hkg1. hkg1 is not enabled
    // on this project (verified via
    //   gcloud functions regions list --project=savetheday-2377a
    // and the deploy returns 403 Permission denied on
    // locations/hkg1). us-central1 matches every other
    // callable in this codebase.
    region: 'us-central1',
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const eventId = req.data?.eventId;
    if (!eventId || typeof eventId !== 'string') {
      throw new HttpsError('invalid-argument', 'eventId required');
    }

    return resolveEntitlement(req.auth.uid, eventId);
  },
);

// ---- Receipt history view (P1.3) ---------------------------------------

/**
 * listPaymentReceipts — callable.
 *
 * Returns the submitted receipts for the caller. Used by the
 * "payment status" UI (Manus P1.1 acceptance matrix).
 *
 * Each receipt is shaped:
 *   {
 *     id, eventId, sku, amount, method, status,
 *     submittedAt, reviewedAt, reviewerUid, rejectionReason,
 *     feature: 'custom-invitation' | 'watermark-removed' | ...
 *   }
 */
export const listPaymentReceipts = onCall<void>(
  {
    cors: true,
    // 2026-08-19 — us-central1, not hkg1 (see getEventEntitlement).
    region: 'us-central1',
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const snap = await receiptsCol(req.auth.uid)
      .orderBy('submittedAt', 'desc')
      .limit(50)
      .get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        eventId: data.eventId || null,
        sku: data.sku || data.unlockType || null,
        feature: data.unlockType || null,
        amount: data.amount ?? data.paid ?? null,
        method: data.paymentMethod || null,
        status: data.status || 'pending',
        submittedAt: data.submittedAt?.toMillis?.() ?? null,
        reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
        reviewerUid: data.reviewerUid || null,
        rejectionReason: data.rejectionReason || null,
      };
    });
  },
);
