// api/photo-upload-quota.js
// ============================
//
// 2026-08-23 — Manus P4.3 (PDF Patch 4.3): server-only
// storage-quota accounting for the photo-upload proxy.
//
// Why this module exists:
// The previous quota gate (api/photo-upload.js:425-486) read
// `event.storageQuotaBytes` + `event.storageUsageBytes` —
// BOTH are writable by the signed-in owner via the event
// update rule. Any owner can inflate storageQuotaBytes to
// bypass the cap, or zero storageUsageBytes to reset the
// counter. This module replaces that gate with a server-only
// flow:
//
//   1. Read the entitlement limit via
//      `resolveServerEntitlementLimit(admin.db, ownerUid, eventId)`.
//      This computes the limit from the owner's UNLOCK records,
//      which live in a server-only collection (firestore.rules
//      denies client access). The owner cannot self-promote.
//
//   2. Inside a single Admin SDK `runTransaction(...)`:
//      - READ  /artifacts/{appId}/users/{ownerUid}/events/{eventId}/
//              privateUsage/storage   (default to 0/0 if absent)
//      - CHECK usedBytes + reservedBytes + addBytes <= limitBytes
//      - WRITE reservedBytes += addBytes
//      The transaction's atomicity closes the TOCTOU window
//      where two concurrent uploads both pass the check and
//      then both succeed past the limit.
//
//   3. If NAS upload succeeds (2xx):
//      Inside a second transaction, decrement `reservedBytes`
//      and increment `usedBytes` by the SAME addBytes amount.
//      This is the "finalize" step — bytes that were reserved
//      are now permanently counted.
//
//   4. If NAS upload fails / aborts / times out:
//      Inside a third transaction, decrement `reservedBytes`
//      only. This is the "release" step — the slot is freed so
//      the next upload can take it.
//
// Fail-closed posture:
//   - If `resolveServerEntitlementLimit` throws → reject 503.
//     Do NOT fall back to a client-trustable default (the old
//     code did this, and a transient Firestore blip would let
//     uploads through unaccounted).
//   - If the reservation transaction throws → reject 503.
//     The quota gate is mandatory; no silent pass-through.
//   - If the finalize transaction throws → log loud, do NOT
//     fail the upload (the photo is already on NAS). The
//     reservation stays as `reservedBytes`; a daily cron
//     reconciles drift.
//   - If the release transaction throws → log loud. Worst
//     case: a slot stays reserved for an upload that didn't
//     land, slowly leaking the user's apparent quota. The
//     same cron reconciles.
//
// The actual Admin SDK calls live here; the proxy imports
// these helpers and never touches Firestore directly for
// quota accounting.

const DEFAULT_QUOTA_DOC = Object.freeze({
  usedBytes: 0,
  reservedBytes: 0,
  updatedAt: null,
});

function privateUsagePath(appId, ownerUid, eventId) {
  return `artifacts/${appId}/users/${ownerUid}/events/${eventId}/privateUsage/storage`;
}

/**
 * Read the current usage snapshot for an event. Returns
 * `{ usedBytes, reservedBytes, exists }`. If the doc doesn't
 * exist yet (legacy event, first upload), returns defaults.
 */
async function readUsage(db, appId, ownerUid, eventId) {
  const ref = db.doc(privateUsagePath(appId, ownerUid, eventId));
  const snap = await ref.get();
  if (!snap.exists) {
    return { ...DEFAULT_QUOTA_DOC, exists: false };
  }
  const data = snap.data() || {};
  return {
    usedBytes: Number.isFinite(data.usedBytes) ? data.usedBytes : 0,
    reservedBytes: Number.isFinite(data.reservedBytes) ? data.reservedBytes : 0,
    updatedAt: data.updatedAt || null,
    exists: true,
  };
}

/**
 * Reserve `addBytes` against the event's quota. Atomic via
 * `runTransaction` so concurrent uploads can't both pass the
 * gate when only one slot is available.
 *
 * Resolves with `{ ok: true, limitBytes, usedBytes, reservedBytes }`
 * on success, or throws `QuotaExceededError` if the upload would
 * exceed the limit.
 *
 * If the `privateUsage/storage` doc doesn't exist yet, this
 * transaction creates it (admin SDK can write to the
 * deny-all-by-client path because it bypasses security rules).
 */
async function reserveQuota({ db, appId, ownerUid, eventId, addBytes, limitBytes }) {
  if (!Number.isFinite(addBytes) || addBytes <= 0) {
    throw new Error(`reserveQuota: addBytes must be > 0 (got ${addBytes})`);
  }
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    throw new Error(`reserveQuota: limitBytes must be > 0 (got ${limitBytes})`);
  }
  const ref = db.doc(privateUsagePath(appId, ownerUid, eventId));

  // 2026-08-23 — P4.3: read-then-write MUST be in a single
  // transaction. The previous proxy did this outside a
  // transaction, which meant two concurrent uploads could
  // both pass the check (each sees reservedBytes=0), then
  // both increment past the limit. `runTransaction` retries
  // on conflict so the second writer sees the new
  // reservedBytes and gets a fresh `withinQuota` decision.
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? {
          usedBytes: Number.isFinite((snap.data() || {}).usedBytes)
            ? snap.data().usedBytes : 0,
          reservedBytes: Number.isFinite((snap.data() || {}).reservedBytes)
            ? snap.data().reservedBytes : 0,
        }
      : { usedBytes: 0, reservedBytes: 0 };

    const projectedUsed = current.usedBytes + current.reservedBytes + addBytes;
    if (projectedUsed > limitBytes) {
      const err = new Error(
        `storage quota exceeded: used=${current.usedBytes}, ` +
        `reserved=${current.reservedBytes}, addBytes=${addBytes}, limit=${limitBytes}`,
      );
      err.code = 'STORAGE_QUOTA_EXCEEDED';
      err.usedBytes = current.usedBytes;
      err.reservedBytes = current.reservedBytes;
      err.limitBytes = limitBytes;
      err.addBytes = addBytes;
      throw err;
    }

    const newReserved = current.reservedBytes + addBytes;
    // `set` (not update) on first write creates the doc with
    // the full shape; on subsequent writes it merges. The
    // `merge: true` flag preserves any sibling fields that
    // future maintenance scripts may add (drift counters,
    // lastReservationId, etc.).
    tx.set(
      ref,
      {
        usedBytes: current.usedBytes,
        reservedBytes: newReserved,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      ok: true,
      limitBytes,
      usedBytes: current.usedBytes,
      reservedBytes: newReserved,
    };
  });
}

/**
 * After a successful NAS upload, move `addBytes` from
 * `reservedBytes` to `usedBytes`. Atomic via runTransaction.
 * Idempotent ONLY if the caller is willing to pass addBytes=0;
 * a double-finalize will double-count usedBytes.
 */
async function finalizeQuota({ db, appId, ownerUid, eventId, addBytes }) {
  if (!Number.isFinite(addBytes) || addBytes <= 0) {
    throw new Error(`finalizeQuota: addBytes must be > 0 (got ${addBytes})`);
  }
  const ref = db.doc(privateUsagePath(appId, ownerUid, eventId));
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? {
          usedBytes: Number.isFinite((snap.data() || {}).usedBytes)
            ? snap.data().usedBytes : 0,
          reservedBytes: Number.isFinite((snap.data() || {}).reservedBytes)
            ? snap.data().reservedBytes : 0,
        }
      : { usedBytes: 0, reservedBytes: 0 };

    const newReserved = Math.max(current.reservedBytes - addBytes, 0);
    const newUsed = current.usedBytes + addBytes;
    tx.set(
      ref,
      {
        usedBytes: newUsed,
        reservedBytes: newReserved,
        lastFinalizedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { usedBytes: newUsed, reservedBytes: newReserved };
  });
}

/**
 * After a FAILED NAS upload, decrement `reservedBytes` so the
 * slot is freed for the next upload. Atomic via runTransaction.
 * Failure to release is non-fatal (the photo didn't land; the
 * worst case is a leaking slot, which the daily cron reconciles).
 */
async function releaseQuota({ db, appId, ownerUid, eventId, addBytes }) {
  if (!Number.isFinite(addBytes) || addBytes <= 0) {
    throw new Error(`releaseQuota: addBytes must be > 0 (got ${addBytes})`);
  }
  const ref = db.doc(privateUsagePath(appId, ownerUid, eventId));
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? {
          usedBytes: Number.isFinite((snap.data() || {}).usedBytes)
            ? snap.data().usedBytes : 0,
          reservedBytes: Number.isFinite((snap.data() || {}).reservedBytes)
            ? snap.data().reservedBytes : 0,
        }
      : { usedBytes: 0, reservedBytes: 0 };

    const newReserved = Math.max(current.reservedBytes - addBytes, 0);
    tx.set(
      ref,
      {
        usedBytes: current.usedBytes,
        reservedBytes: newReserved,
        lastReleasedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { usedBytes: current.usedBytes, reservedBytes: newReserved };
  });
}

// FieldValue is required by the helpers above (serverTimestamp,
// increment). The proxy imports it from firebase-admin/firestore
// and threads it through. We pull it in here so this module is
// self-contained for tests; tests that stub firebase-admin
// provide their own FieldValue.
import { FieldValue } from 'firebase-admin/firestore';

export {
  privateUsagePath,
  readUsage,
  reserveQuota,
  finalizeQuota,
  releaseQuota,
  DEFAULT_QUOTA_DOC,
};