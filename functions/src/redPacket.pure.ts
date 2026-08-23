// redPacket.pure.ts
// ==================
//
// 2026-08-23 — Manus P2c pure-logic helpers for the red-packet
// confirmation callable. PDF §3.3 mandates:
//
//   "Do not retain the direct handleGiveRedPacket write: map its
//    successful payment confirmation to a new server callable that
//    verifies the same guest link and creates a payment/audit
//    record. This prevents a guest from self-marking gift status
//    or amount."
//
// This file holds the policy logic that the callable enforces:
//   - Amount bounds (positive integer in a sensible HK$ range)
//   - Audit-record shape (what fields the payment/* doc carries)
//   - Status transitions (preventing double-counting via hasGifted)
//
// Why pure (firebase-functions-testability skill):
// The CF module that imports firebase-admin will run initializeApp()
// at module-load time. Vitest explodes without GOOGLE_APPLICATION_CREDENTIALS.
// All policy decisions live here so tests import only this file.

// ---------------------------------------------------------------------------
// Amount validation
// ---------------------------------------------------------------------------

/**
 * Minimum HK$ the guest can self-report. Below this is a joke
 * (not what someone would actually mean by 電子人情).
 */
export const MIN_RED_PACKET_HKD = 88;

/**
 * Maximum HK$ a single self-report can claim. Above this is almost
 * certainly a typo, fat-finger, or a malicious guest trying to
 * inflate the owner's tally. Even the most generous e-RP is well
 * under this.
 */
export const MAX_RED_PACKET_HKD = 100_000;

/**
 * Status the audit record writes. Always 'confirmed' — the guest's
 * claim is server-recorded the moment the callable fires (no payment
 * processor integration in P2c scope; the modal still shows the
 * QR-codes the owner uploaded and the guest self-reports after
 * sending).
 */
export const PAYMENT_STATUS_CONFIRMED = 'confirmed';

/**
 * Validate the red-packet amount shape.
 *
 * @param {unknown} amount
 * @returns {{ ok: true, amount: number } | { ok: false, reason: string }}
 *
 *   ok=true  → use `amount` as-is (positive integer, in range)
 *   ok=false → caller should surface `reason` to the user via HttpsError
 *
 * Pure function. Tests import directly.
 */
export function validateRedPacketAmount(amount: unknown): { ok: true; amount: number } | { ok: false; reason: string } {
  if (!Number.isInteger(amount)) {
    return { ok: false, reason: 'amount must be a whole number' };
  }
  // After Number.isInteger check, TS still sees `unknown`. Narrow with
  // a type guard — the integer check is the runtime proof.
  const n = amount as number;
  if (n < MIN_RED_PACKET_HKD) {
    return {
      ok: false,
      reason: `amount must be at least HK$${MIN_RED_PACKET_HKD}`,
    };
  }
  if (n > MAX_RED_PACKET_HKD) {
    return {
      ok: false,
      reason: `amount must not exceed HK$${MAX_RED_PACKET_HKD.toLocaleString()}`,
    };
  }
  return { ok: true, amount: n };
}

/**
 * Whether a guest's existing hasGifted/giftAmount state should
 * trigger a "double-gift" warning vs an outright rejection.
 *
 * P2c policy: allow the guest to update their self-reported amount
 * (people often get the wrong number the first time, and the owner
 * UI just shows the latest claim). We log the previous amount on the
 * audit record so the owner has a paper trail if anything looks
 * off — that's the whole point of the audit.
 */
export function shouldAllowUpdate(existing: Record<string, unknown> | undefined | null): boolean {
  if (!existing || existing.hasGifted !== true) return true;
  // Previously gifted; treat as an update. The audit record
  // captures the previous amount for transparency.
  return true;
}

// ---------------------------------------------------------------------------
// Audit record shape
// ---------------------------------------------------------------------------

/**
 * Shape the server writes to
 *   artifacts/{appId}/users/{ownerUid}/events/{eventId}/payments/{paymentId}
 *
 * Note: timestamps (createdAt / confirmedAt) are serverTimestamp()s
 * injected at write time by the CF module — this function only
 * builds the data payload.
 *
 * @param {object} args
 * @param {string} args.paymentId - Firestore doc id (caller-generated)
 * @param {string} args.ownerUid
 * @param {string} args.eventId
 * @param {string} args.guestDocId
 * @param {string} args.guestId - the canonical guestId (separate from docId)
 * @param {number} args.amount
 * @param {string} args.redeemedByUid - Firebase Auth uid at time of confirm
 * @param {number|null} args.previousAmount - the prior giftAmount, or null
 * @returns {object} Audit record ready for Firestore.set()
 */
export function buildPaymentAuditRecord(args: {
  paymentId: string;
  ownerUid: string;
  eventId: string;
  guestDocId: string;
  guestId: string;
  amount: number;
  redeemedByUid: string;
  previousAmount: number | null;
}) {
  return {
    paymentId: args.paymentId,
    ownerUid: args.ownerUid,
    eventId: args.eventId,
    guestDocId: args.guestDocId,
    guestId: args.guestId,
    amount: args.amount,
    status: PAYMENT_STATUS_CONFIRMED,
    redeemedByUid: args.redeemedByUid,
    previousAmount:
      typeof args.previousAmount === 'number' ? args.previousAmount : null,
    // Notes: this is an audit record — the "kind" field lets the
    // dashboard filter (e.g. owner invoice view, or future
    // reconciliation against a real payment processor).
    kind: 'red-packet-self-report',
  };
}

/**
 * Shape the guest-doc merge the CF does after the audit record
 * lands. Atomic with the audit record via Firestore transaction.
 *
 * @param {object} args
 * @param {number} args.amount
 * @returns {object} Field map suitable for setDoc(merge: true)
 */
export function buildGuestMergeForGift(args: { amount: number }): {
  hasGifted: true;
  giftAmount: number;
  lastGiftedAt: '__SERVER_TIMESTAMP__';
} {
  return {
    hasGifted: true,
    giftAmount: args.amount,
    lastGiftedAt: '__SERVER_TIMESTAMP__', // CF replaces with FieldValue.serverTimestamp()
  };
}

/**
 * P2c also wants the projection to reflect gift status IF the owner
 * has published one. But that's a separate write — the bootstrap
 * returns the bound guest's record including hasGifted/giftAmount,
 * so the portal already shows the current state. No additional
 * projection write needed in P2c.
 */
