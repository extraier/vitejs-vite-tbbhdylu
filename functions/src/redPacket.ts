// redPacket.ts
// =============
//
// 2026-08-23 — Manus P2c: server-authoritative confirmation for the
// 電子人情 self-report. PDF §3.3 contract:
//
//   "Do not retain the direct handleGiveRedPacket write: map its
//    successful payment confirmation to a new server callable that
//    verifies the same guest link and creates a payment/audit
//    record. This prevents a guest from self-marking gift status
//    or amount."
//
// One callable: confirmRedPacket. It:
//
//   1. Verifies the guest link (same validateLinkShape from P2a).
//   2. Validates the amount (pure helper, clamps HK$88–100,000).
//   3. In ONE Firestore transaction:
//      a. Writes a payment/{paymentId} audit record
//      b. Merges hasGifted/giftAmount/lastGiftedAt onto the guest doc
//   4. Returns { ok: true, paymentId, amount }.
//
// P2c deliberately does NOT integrate with a payment processor —
// that's out of scope. The PaymentModal still shows the couple's
// uploaded QRs (PayMe / FPS / AlipayHK / WeChat Pay HK); the guest
// sends externally, then taps a "已發送 $X" button which triggers
// this callable to record their self-report. The audit trail is
// what makes this safe (no client-side hasGifted spoofing).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import {
  // P2c pure helpers (own file)
  validateRedPacketAmount,
  shouldAllowUpdate,
  buildPaymentAuditRecord,
  buildGuestMergeForGift,
  PAYMENT_STATUS_CONFIRMED,
} from './redPacket.pure';
// P2a pure helpers — the guest link validator and its error class
// are general-purpose enough to live in the P2a pure module rather
// than duplicate them in P2c.
import {
  LinkInvalidError,
  validateLinkShape,
} from './guestExperience.pure';

const db = getFirestore();
const APP_ID = 'savetheday-production';
const REGION = 'us-central1';

const PAYMENTS_COLLECTION = 'payments';

const eventRef = (ownerUid: string, eventId: string) =>
  db.doc(`artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}`);

const experienceDraftRef = (ownerUid: string, eventId: string) =>
  db.doc(
    `artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}/guestExperience/draft`,
  );

const linkRef = (ownerUid: string, authUid: string) =>
  db.doc(`artifacts/${APP_ID}/users/${ownerUid}/guestLinks/${authUid}`);

const guestRef = (ownerUid: string, eventId: string, guestDocId: string) =>
  db.doc(
    `artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}/guests/${guestDocId}`,
  );

const paymentRef = (ownerUid: string, eventId: string, paymentId: string) =>
  db.doc(
    `artifacts/${APP_ID}/users/${ownerUid}/events/${eventId}/${PAYMENTS_COLLECTION}/${paymentId}`,
  );

// ---------------------------------------------------------------------------
// confirmRedPacket
// ---------------------------------------------------------------------------

export const confirmRedPacket = onCall({ region: REGION }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError('unauthenticated', 'guest session required');
  }
  const ownerUid = String(req.data?.ownerUid ?? '').trim().slice(0, 128);
  const eventId = String(req.data?.eventId ?? '').trim().slice(0, 128);
  if (!ownerUid || !eventId) {
    throw new HttpsError('invalid-argument', 'ownerUid and eventId required');
  }

  // 1. Validate amount (pure). The helper accepts `unknown` and
  // returns a discriminated union, so TS narrows correctly.
  const amountCheck = validateRedPacketAmount(req.data?.amount);
  if (!amountCheck.ok) {
    throw new HttpsError('invalid-argument', amountCheck.reason);
  }
  const amount: number = amountCheck.amount;

  // 2. Verify the guest link (same pattern as P2a callables).
  let guestDocId: string;
  let guestId: string;
  try {
    const link = await linkRef(ownerUid, req.auth.uid).get();
    const verified = validateLinkShape(
      link.data() ?? null,
      ownerUid,
      eventId,
      req.auth.uid,
    );
    guestDocId = verified.guestDocId;
    guestId = verified.guestId;
  } catch (err: unknown) {
    if (err instanceof LinkInvalidError) {
      throw new HttpsError('permission-denied', err.message);
    }
    throw err;
  }

  // 3. Read the current guest state (for previousAmount + idempotency).
  // Done BEFORE the transaction because the transaction needs the
  // values upfront.
  const guestSnap = await guestRef(ownerUid, eventId, guestDocId).get();
  if (!guestSnap.exists) {
    throw new HttpsError('not-found', 'guest record not found');
  }
  const existing = guestSnap.data() ?? {};
  if (existing.guestId !== guestId) {
    // The link says one guestId; the doc says another. Bail — this
    // shouldn't happen unless data is corrupted.
    throw new HttpsError('failed-precondition', 'guest identity mismatch');
  }
  const previousAmount =
    typeof existing.giftAmount === 'number' && existing.hasGifted === true
      ? existing.giftAmount
      : null;

  // P2c policy: updates are allowed (people fat-finger). The audit
  // record captures previousAmount for transparency.
  if (!shouldAllowUpdate(existing)) {
    // Currently unreachable (shouldAllowUpdate always returns true)
    // — kept as a future-proofing check.
    throw new HttpsError(
      'failed-precondition',
      'red-packet already recorded for this guest',
    );
  }

  // 4. Atomic write: audit record + guest merge.
  const paymentId = db.collection('payments').doc().id; // client-generated unique id
  const audit = buildPaymentAuditRecord({
    paymentId,
    ownerUid,
    eventId,
    guestDocId,
    guestId,
    amount,
    redeemedByUid: req.auth.uid,
    previousAmount,
  });
  const guestMerge = buildGuestMergeForGift({ amount });

  await db.runTransaction(async (tx) => {
    // Re-read inside the transaction to avoid TOCTOU. The values we
    // already captured are still authoritative for THIS call's
    // intent, but the transaction body uses the live snapshot.
    const liveSnap = await tx.get(guestRef(ownerUid, eventId, guestDocId));
    if (!liveSnap.exists) {
      throw new HttpsError('not-found', 'guest record disappeared');
    }
    tx.set(paymentRef(ownerUid, eventId, paymentId), {
      ...audit,
      // serverTimestamp injected at write time — the pure helper
      // leaves a placeholder so we can't accidentally write a
      // client-supplied timestamp.
      confirmedAt: FieldValue.serverTimestamp(),
    });
    tx.set(guestRef(ownerUid, eventId, guestDocId), {
      ...guestMerge,
      lastGiftedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { ok: true, paymentId, amount, status: PAYMENT_STATUS_CONFIRMED };
});

// ---------------------------------------------------------------------------
// Internal / dev-only: helper to ensure the event + draft exist before
// publishGuestExperience runs. Not exported — used by smoke scripts.
// ---------------------------------------------------------------------------

/**
 * Ensure /events/{eventId} exists and has the minimum fields the
 * publishGuestExperience helper checks (ownerUid + coOwners[]).
 * Idempotent. Used by smoke tests; not callable-facing.
 */
export async function _devEnsureEventShape(ownerUid: string, eventId: string) {
  const snap = await eventRef(ownerUid, eventId).get();
  if (!snap.exists) return;
  const data = snap.data() ?? {};
  const patch: Record<string, unknown> = {};
  if (!Array.isArray(data.coOwners)) patch.coOwners = [];
  if (Object.keys(patch).length === 0) return;
  await eventRef(ownerUid, eventId).set(patch, { merge: true });
}

export async function _devEnsureDraftExists(ownerUid: string, eventId: string) {
  const draftSnap = await experienceDraftRef(ownerUid, eventId).get();
  if (draftSnap.exists) return;
  await experienceDraftRef(ownerUid, eventId).set({
    schemaVersion: 1,
    hero: { coupleNames: 'Smoke Test', dateLabel: '2026-12-31' },
    theme: { templateId: 'plain', accentColor: '#D45478' },
    rsvp: { enabled: false },
    venues: [],
    schedule: [],
    calendar: {},
    messages: { welcome: '', thankYou: '' },
    updatedAt: FieldValue.serverTimestamp(),
  });
}
