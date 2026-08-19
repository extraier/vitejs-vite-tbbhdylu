/**
 * Cloud Functions — Storage quota helpers
 * =======================================
 *
 * 2026-08-19 — Manus P1.4.a: storage-quota helpers. The
 *           /api/photo-upload proxy and the getUploadPreferencesToken
 *           both need to answer the same question:
 *
 *           "If I upload N more bytes to eventId, will I exceed
 *           the entitlement-derived quota?"
 *
 * Until P1.4.a, the answer was estimated from a 1.5-MB-
 * per-photo approximation in the React UI. The /api/photo-
 * upload proxy had no quota check at all, so an unprivileged
 * caller could upload past the limit indefinitely. The NAS
 * receiver applied JPEG compression and watermark but didn't
 * know about the entitlement. Net effect: the
 * "升級解鎖 +500MB 容量" promise was enforced only on the
 * upload-prefs HMAC token (where watermark-removed is read
 * but quota isn't), not on the upload itself.
 *
 * P1.4.a fix.
 * -----------
 *
 *   1. Add two fields to event docs:
 *        - storageUsageBytes (number, atomic counter)
 *        - storageQuotaBytes (number, derived from the
 *          entitlement each time it's computed)
 *
 *   2. Add the helper this file exports:
 *        - resolveStorageQuota(entitlement): { limitBytes, usedBytes }
 *        - wouldUploadExceedQuota(usedBytes, addBytes, limitBytes)
 *        - assertWithinQuota(usedBytes, addBytes, limitBytes): throws
 *
 *   3. /api/photo-upload.js now reads the counter + quota BEFORE
 *      forwarding to the NAS and rejects with HTTP 413 if the
 *      upload would exceed the quota. After a successful upload,
 *      it atomically increments the counter.
 *
 *   4. getUploadPreferencesToken now ALSO returns quota info so
 *      a client-rendered photo drop can show "X MB used / Y MB"
 *      with real numbers, not the 1.5-MB-per-photo estimate.
 *
 * DEFERRED (P1.4.b / c — separate PRs).
 * -------------------------------------
 *
 *   - Reservation pattern: atomically increment BEFORE the NAS
 *     upload, decrement if the upload fails. Currently we
 *     increment-after-success which leaks quota when uploads
 *     fail at the network layer (a 25 MB upload that's network-
 *     dropped shows as 0 used; the user retries and uploads 25
 *     more, the counter is now 25 behind reality). Reserved for
 *     P1.4.b.
 *
 *   - Drift correction: nightly reconciliation job that lists
 *     NAS storage per event and corrects any drift in the
 *     counter. Reserved for P1.4.c.
 *
 * Both deferred items are clearly documented inline so the next
 * engineer (or Manus) can pick them up.
 */

import { computeEntitlement, type EventEntitlement } from './entitlementResolver';

// ---- Constants ---------------------------------------------------------

// Source of truth for the base free-tier limit. Mirrors
// FREE_TIER_BASE_BYTES in entitlementResolver.ts and the
// legacy FREE_TIER_LIMIT_MB constant in src/lib/config.ts
// (100 MB) — see the migration comment below.
//
// 2026-08-19 — Migration in progress. Historically the UI
// assumed 100 MB but the resolver now reports 200 MB. The
// new quota field on the event doc is set from the
// resolver every time the entitlement is computed. The
// legacy 100 MB UI estimate is a separate bug; the resolver
// path wins, and the UI estimate will be removed in a
// follow-up PR.
export const FREE_TIER_BASE_BYTES = 200 * 1024 * 1024;       // 200 MB
export const BONUS_STORAGE_BYTES = 500 * 1024 * 1024;       // 500 MB

// 25 MB matches MAX_FORWARD_BYTES in api/photo-upload.js. If
// the proxy rejects at this bound the counter never sees the
// bytes, so the helper accepts any "addBytes" up to the
// proxy-bound without complaining (it's not the helper's
// job to enforce per-upload size).
export const MAX_SINGLE_UPLOAD_BYTES = 25 * 1024 * 1024;

// ---- Types -------------------------------------------------------------

export interface QuotaCheck {
  withinQuota: boolean;
  usedBytes: number;
  addBytes: number;
  limitBytes: number;
  projectedUsedBytes: number;   // = usedBytes + addBytes
  remainingBytes: number;       // = max(limitBytes - usedBytes, 0)
  overageBytes: number;         // = max(projectedUsedBytes - limitBytes, 0)
}

export interface StorageFieldUpdate {
  storageUsageBytes: number;    // atomic FieldValue.increment(addBytes)
  storageQuotaBytes?: number;   // set on first entitlement compute or
                                // when quota changes; absent thereafter
}

// ---- Pure policy helpers (no I/O; unit-testable) -----------------------

/**
 * Resolve the quota (bytes) from an entitlement object.
 *
 * The resolver already computes `storageLimitBytes` — we
 * just pass it through. This helper exists so the rest of
 * the codebase doesn't have to remember whether the
 * entitlement shape uses bytes or MB, and so the boundary
 * "where do the constants live" is in one place.
 */
export function resolveStorageQuota(entitlement: EventEntitlement): number {
  if (!entitlement || typeof entitlement.storageLimitBytes !== 'number') {
    return FREE_TIER_BASE_BYTES; // safe default
  }
  return entitlement.storageLimitBytes;
}

/**
 * Decide whether an upload of `addBytes` would exceed the
 * quota. Pure. No side effects.
 *
 * Returns a QuotaCheck describing the exact math, so the
 * caller can render a precise "you have X MB free, this
 * photo is Y MB, choose something smaller" message.
 *
 * Edge cases pinned by tests:
 *   - used = 0, add = any, limit = any  →  used + add vs limit
 *   - used = limit, add = 0             →  withinQuota = true (no-op)
 *   - used = limit, add = 1             →  withinQuota = false
 *   - used = limit + 1 (drift), add = 0 →  withinQuota = false (already over)
 *   - limit = 0 (degenerate config)     →  any add fails
 */
export function wouldUploadExceedQuota(
  usedBytes: number,
  addBytes: number,
  limitBytes: number,
): QuotaCheck {
  const safeUsed = Math.max(0, Number.isFinite(usedBytes) ? usedBytes : 0);
  const safeAdd = Math.max(0, Number.isFinite(addBytes) ? addBytes : 0);
  const safeLimit = Math.max(0, Number.isFinite(limitBytes) ? limitBytes : 0);

  const projectedUsedBytes = safeUsed + safeAdd;
  const remainingBytes = Math.max(safeLimit - safeUsed, 0);
  const overageBytes = Math.max(projectedUsedBytes - safeLimit, 0);
  const withinQuota = projectedUsedBytes <= safeLimit;

  return {
    withinQuota,
    usedBytes: safeUsed,
    addBytes: safeAdd,
    limitBytes: safeLimit,
    projectedUsedBytes,
    remainingBytes,
    overageBytes,
  };
}

/**
 * Build the Firestore field-update payload for the event doc.
 * Pure. The proxy calls this after a successful NAS upload to
 * get the +N-bytes patch.
 *
 * `quotaBytes` is optional: if provided, the field is set
 * (used on the FIRST upload to seed the quota); if omitted, the
 * existing quotaBytes field is left as-is. The atomic increment
 * is always applied.
 */
export function buildStorageIncrement(
  addBytes: number,
  quotaBytes?: number,
): StorageFieldUpdate {
  const safeAdd = Math.max(0, Math.floor(Number.isFinite(addBytes) ? addBytes : 0));
  const out: StorageFieldUpdate = {
    storageUsageBytes: safeAdd, // caller wraps in FieldValue.increment
  };
  if (typeof quotaBytes === 'number' && Number.isFinite(quotaBytes) && quotaBytes > 0) {
    out.storageQuotaBytes = Math.floor(quotaBytes);
  }
  return out;
}

/**
 * Convenience: assert that an upload of `addBytes` is within
 * the quota. Throws an Error with a precise message so the proxy
 * can surface a 413 with the same detail.
 *
 * Used at the /api/photo-upload boundary BEFORE minting the
 * upload-prefs HMAC. Two reasons:
 *   1. We don't want to mint a token for an upload we can't
 *      accept (the NAS receiver would store the bytes against
 *      a wedding whose counter says "you're at the limit").
 *   2. We want a precise error message; a 5xx "unable to mint"
 *      tells the customer nothing.
 */
export function assertWithinQuota(
  usedBytes: number,
  addBytes: number,
  limitBytes: number,
): QuotaCheck {
  const check = wouldUploadExceedQuota(usedBytes, addBytes, limitBytes);
  if (!check.withinQuota) {
    const usedMb = (check.usedBytes / (1024 * 1024)).toFixed(1);
    const limitMb = (check.limitBytes / (1024 * 1024)).toFixed(1);
    const addMb = (check.addBytes / (1024 * 1024)).toFixed(1);
    const overMb = (check.overageBytes / (1024 * 1024)).toFixed(1);
    throw new Error(
      `storage quota exceeded: currently ${usedMb} MB, ` +
      `this upload is ${addMb} MB, limit is ${limitMb} MB ` +
      `(over by ${overMb} MB).`,
    );
  }
  return check;
}

// ---- Composite that lives on top of computeEntitlement ----------------

/**
 * One-stop helper: given an entitlement, decide whether
 * `addBytes` would exceed the quota. Pure; used by tests and
 * by any Cloud Function that already has an entitlement object
 * in hand.
 */
export function checkUploadAgainstEntitlement(
  entitlement: EventEntitlement,
  usedBytes: number,
  addBytes: number,
): QuotaCheck {
  return wouldUploadExceedQuota(usedBytes, addBytes, resolveStorageQuota(entitlement));
}

// ---- Re-exports for convenience ----------------------------------------

export { computeEntitlement, type EventEntitlement };
